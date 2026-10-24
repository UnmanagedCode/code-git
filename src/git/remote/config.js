import { isDeepStrictEqual } from 'node:util';
import { maskUrl } from '../../mask.js';
import { Refusal } from '../../refusals.js';
import { parseRemotes } from '../parse/graph.js';
import { hasUrl, legacyRemoteFile, trackingRefsOf } from './tracking.js';

// A remote's config (`remote.<name>.*` and the branches whose upstream or push remote it is): read for remote.list and
// for the undo record of the ops that change or remove a remote, written back by their undo (docs/undo.md → Steps).

const REMOTES = 'refs/remotes/';

const decoder = new TextDecoder('utf-8', { fatal: false });

/** `config -z --get-regexp` output → [[key, value]] (each record `key\nvalue\0`; a key alone when it has no value). */
export function parseConfigZ(out) {
  return out.split('\0').filter(Boolean).map((rec) => {
    const nl = rec.indexOf('\n');
    return nl === -1 ? [rec, ''] : [rec.slice(0, nl), rec.slice(nl + 1)];
  });
}

/** A raw url list `remote set-url` cannot replace as one value (an empty reset counts): remote.edit refuses it. */
export const multiValued = (values) => values.length > 1;

/** git's url list semantics (hasUrl): an empty value clears what came before it. */
const effective = (values) => values.slice(values.lastIndexOf('') + 1);


/** The url, push url and fetch lists' config variables. */
const LIST_VARS = { urls: 'url', pushUrls: 'pushurl', fetch: 'fetch' };

/**
 * Every remote's raw config: Map(name → {urls, pushUrls, fetch, extra}) for `remotes` (`git remote`'s names), values as
 * configured (empty ones kept); `extra` every other `remote.<name>.<var>` as [[var, value]] in config order (`var` as
 * git prints it: lower case). A key's remote is the longest known name it starts with (`remote.<name>.<var>`; a name
 * may hold dots).
 */
async function rawConfigs(git, remotes) {
  const r = await git(['config', '-z', '--get-regexp', '^remote\\.'], { okExit: [0, 1] });
  const out = new Map(remotes.map((n) => [n, { urls: [], pushUrls: [], fetch: [], extra: [] }]));
  const byLength = [...remotes].sort((a, b) => b.length - a.length);
  const fieldOf = Object.fromEntries(Object.entries(LIST_VARS).map(([field, v]) => [v, field]));
  for (const [key, value] of parseConfigZ(decoder.decode(r.stdout))) {
    const name = byLength.find((n) => key.startsWith(`remote.${n}.`) && !key.slice(`remote.${n}.`.length).includes('.'));
    if (name === undefined) continue;
    const v = key.slice(`remote.${name}.`.length).toLowerCase();
    if (fieldOf[v]) out.get(name)[fieldOf[v]].push(value);
    else out.get(name).extra.push([v, value]);
  }
  return out;
}

/** `git remote`'s names. */
export async function remoteNames(git) {
  return parseRemotes(decoder.decode((await git(['remote'])).stdout));
}

/**
 * Every remote: [{name, urls, pushUrls, fetch, displayUrl, displayPushUrl, legacy, multiUrl, multiPushUrl}] in `git remote`
 * order, every url's password masked (maskUrl: this reaches the browser). `urls` / `pushUrls` as git counts them (after
 * the last empty value); `fetch` as configured; `displayUrl` the first url (else push url) and `displayPushUrl` the first
 * push url, or null; `legacy` true when git reads the remote from a legacy `.git/remotes` / `.git/branches` file (no url
 * in config and such a file exists); `multiUrl` / `multiPushUrl` when that raw list holds more than one value
 * (remote.edit refuses to replace it).
 */
export async function listRemotes(git) {
  const names = await remoteNames(git);
  const raw = await rawConfigs(git, names);
  const out = [];
  for (const name of names) {
    const c = raw.get(name);
    const urls = effective(c.urls).map(maskUrl);
    const pushUrls = effective(c.pushUrls).map(maskUrl);
    const legacy = !hasUrl(c.urls) && (await legacyRemoteFile(git, name)) !== null;
    out.push({
      name, urls, pushUrls, fetch: c.fetch, displayUrl: urls[0] ?? pushUrls[0] ?? null, displayPushUrl: pushUrls[0] ?? null, legacy,
      // What remote.edit's single-value check counts: raw config values, an empty reset included.
      multiUrl: multiValued(c.urls), multiPushUrl: multiValued(c.pushUrls),
    });
  }
  return out;
}

/** The `branch.<b>.<var>` variables naming a remote that `git remote remove` clears. */
const BRANCH_VARS = new Set(['remote', 'merge', 'pushremote']);
/** `branch.<b>.<var>` → {branch, v} (`v` lower case). */
const branchKey = (key) => ({ branch: key.slice('branch.'.length, key.lastIndexOf('.')), v: key.slice(key.lastIndexOf('.') + 1).toLowerCase() });

/** The BRANCH_VARS keys as [[key, value]] in config order: the repo's own file (`--local`, includes not followed), or every scope. */
async function branchKeysIn(git, { local }) {
  const r = await git(['config', ...(local ? ['--local'] : []), '-z', '--get-regexp', '^branch\\.'], { okExit: [0, 1] });
  return parseConfigZ(decoder.decode(r.stdout)).filter(([key]) => BRANCH_VARS.has(branchKey(key).v));
}

/**
 * The repo's own `branch.<b>.remote` / `.merge` / `.pushRemote` keys as [[key, value]], in config order (`--local`: the
 * file `git remote remove` and `rename` edit; a key in another file is not one they clear, nor one an undo writes back).
 */
export const localBranchKeys = (git) => branchKeysIn(git, { local: true });

/**
 * Every branch's remote keys in the repo's own config: Map(branch → {remote, merge (the first), pushRemote}), each null
 * when unset.
 */
export async function branchRemotes(git) {
  const branches = new Map();
  const field = { remote: 'remote', merge: 'merge', pushremote: 'pushRemote' };
  for (const [key, value] of await localBranchKeys(git)) {
    const { branch, v } = branchKey(key);
    const b = branches.get(branch) ?? { remote: null, merge: null, pushRemote: null };
    if (v === 'merge') b.merge ??= value;
    else b[field[v]] = value;
    branches.set(branch, b);
  }
  return branches;
}

/**
 * The local keys `git remote remove <remote>` would unset now, as [[key, value]] in config order: it picks the branches
 * by their effective `branch.<b>.remote` / `.pushRemote` (every scope, the last value wins) and unsets `.remote` and
 * `.merge` (resp. `.pushRemote`) in the repo's own file — each key that has exactly one value there: git refuses to
 * unset a multi-valued key ("has multiple values") and leaves it, per key.
 */
export async function clearableKeys(git, remote) {
  const effective = new Map();
  for (const [key, value] of await branchKeysIn(git, { local: false })) {
    const { branch, v } = branchKey(key);
    if (v !== 'merge') effective.set(`${branch}\0${v}`, value);
  }
  const names = (branch, v) => effective.get(`${branch}\0${v}`) === remote;
  const local = await localBranchKeys(git);
  const count = local.reduce((m, [key]) => m.set(key, (m.get(key) ?? 0) + 1), new Map());
  return local.filter(([key]) => {
    const { branch, v } = branchKey(key);
    return count.get(key) === 1 && (v === 'pushremote' ? names(branch, 'pushremote') : names(branch, 'remote'));
  });
}

/** The upstreams a list of cleared branch keys held → [{branch, merge (the first, or null)}], in key order. */
export function upstreamsIn(keys) {
  const out = new Map();
  for (const [key, value] of keys) {
    const { branch, v } = branchKey(key);
    if (v === 'pushremote') continue;
    const u = out.get(branch) ?? { branch, merge: null };
    if (v === 'merge') u.merge ??= value;
    out.set(branch, u);
  }
  return [...out.values()];
}

/**
 * Local branches whose upstream remote (`branch.<b>.remote`) is `remote` → [{branch, merge}] (`merge` the first
 * `branch.<b>.merge`, or null), from the repo's own config: git clears these keys on remove and rewrites them on rename.
 */
export async function upstreamsOf(git, remote) {
  return [...await branchRemotes(git)].filter(([, b]) => b.remote === remote).map(([branch, b]) => ({ branch, merge: b.merge }));
}

/** `remote.pushDefault`'s values in the repo's own config (as branchRemotes), in order; [] when unset. */
async function pushDefaultsOf(git) {
  const r = await git(['config', '--local', '--get-all', 'remote.pushDefault'], { okExit: [0, 1] });
  return r.exitCode === 0 ? decoder.decode(r.stdout).replace(/\n$/, '').split('\n') : [];
}

/** `remote.pushDefault` in the repo's own config (its last value), or null. */
export async function pushDefaultOf(git) {
  return (await pushDefaultsOf(git)).at(-1) ?? null;
}

/** Whether `git remote remove <remote>` would clear `remote.pushDefault` now: one local value, the remote (git leaves a multi-valued key). */
export async function pushDefaultClearable(git, remote) {
  const values = await pushDefaultsOf(git);
  return values.length === 1 && values[0] === remote;
}


/**
 * One remote's config as an undo record keeps it: {urls, pushUrls, fetch, extra, upstreams} (raw values: a restore
 * writes them back as they were). REMOTE_UNKNOWN when `name` is not one of `git remote`'s.
 */
export async function remoteSnapshot(git, name) {
  const names = await remoteNames(git);
  if (!names.includes(name)) throw new Refusal('REMOTE_UNKNOWN', `no remote ${name}`);
  const c = (await rawConfigs(git, names)).get(name);
  return { ...c, upstreams: await upstreamsOf(git, name) };
}

/** REMOTE_CONFIG_UNSUPPORTED when git reads `name` from a legacy remote file (its config is not what code-git edits). */
export async function assertNotLegacy(git, name, raw) {
  if (hasUrl(raw.urls)) return;
  const legacy = await legacyRemoteFile(git, name);
  if (legacy) throw new Refusal('REMOTE_CONFIG_UNSUPPORTED', `${name} is read from the legacy file ${legacy}, not from git config`, { remote: name, refspec: null });
}

/** REMOTE_EXISTS when `name` is already one of `git remote`'s. */
export async function assertNewRemote(git, name) {
  if ((await remoteNames(git)).includes(name)) throw new Refusal('REMOTE_EXISTS', `a remote ${name} already exists`);
}

/**
 * What renaming `name` to `newName` needs (remote.rename and its undo step): config git reads, a new name that is free,
 * the default fetch refspec (git rewrites only this shape; any other would keep fetching into the old namespace), and
 * tracking refs without a symbolic ref other than the HEAD alias. Resolves the remote's snapshot.
 */
export async function renameGates(git, name, newName) {
  const old = await remoteSnapshot(git, name);
  await assertNotLegacy(git, name, old);
  await assertNewRemote(git, newName);
  const standard = `+refs/heads/*:${REMOTES}${name}/*`;
  if (old.fetch.length !== 1 || old.fetch[0] !== standard) {
    throw new Refusal('REMOTE_CONFIG_UNSUPPORTED', `${name}'s fetch refspecs are not the default ${standard}: rename it with git`, { remote: name, refspec: old.fetch.join(' ') || null });
  }
  await trackingRefsOf(git, name);
  return old;
}

/** `git remote rename`: the config section, the tracking refs, and every branch.<b>.remote / pushRemote and remote.pushDefault naming it follow. */
export async function renameRemote(git, name, newName) {
  await git(['remote', 'rename', '--end-of-options', name, newName]);
}

/** Sets `key` to exactly `values`, in order: the first replaces the key in place (`--replace-all`), the rest are added; none unsets it (exit 5: was not set). */
async function setList(git, key, values) {
  if (!values.length) {
    await git(['config', '--unset-all', key], { okExit: [0, 5] });
    return;
  }
  await git(['config', '--replace-all', key, values[0]]);
  for (const v of values.slice(1)) await git(['config', '--add', key, v]);
}

/** `extra` grouped by variable: Map(var → values in order). */
const byVar = (extra) => extra.reduce((m, [v, value]) => m.set(v, [...(m.get(v) ?? []), value]), new Map());

/**
 * Writes remote `name`'s config from record side `from` to side `to` (docs/undo.md → Steps, `remote`). Each value is its
 * own argument after its key — never `key=value` nor `-c` — so a url is masked in the activity log and a leading `-` is
 * stored as given (git stops parsing options at the key).
 * - `to` null: the section removed, then the branch keys (`branchKeys`) and pushDefault `from` holds unset (exit 5
 *   tolerated). Only a remove's record holds them: an add's undo never touches a branch key.
 * - `from` null: each list added in order — urls, fetch refspecs, push urls (`remote add` then `set-url --push` order),
 *   the extra keys — then each of `to.branchKeys` (the local keys git cleared) and pushDefault.
 * - both: each list or extra variable that differs set to `to`'s values.
 */
export async function writeRemoteConfig(git, name, from, to) {
  const key = (v) => `remote.${name}.${v}`;
  if (to === null) {
    await git(['config', '--remove-section', `remote.${name}`]);
    const unset = (k) => git(['config', '--unset-all', k], { okExit: [0, 5] });
    for (const k of new Set((from.branchKeys ?? []).map(([k]) => k))) await unset(k);
    if (from.pushDefault) await unset('remote.pushDefault');
    return;
  }
  if (from === null) {
    const add = (k, v) => git(['config', '--add', k, v]);
    for (const field of ['urls', 'fetch', 'pushUrls']) for (const v of to[field]) await add(key(LIST_VARS[field]), v);
    for (const [v, value] of to.extra) await add(key(v), value);
    for (const [k, value] of to.branchKeys ?? []) await add(k, value);
    if (to.pushDefault) await add('remote.pushDefault', name);
    return;
  }
  for (const field of ['urls', 'fetch', 'pushUrls']) if (!isDeepStrictEqual(from[field], to[field])) await setList(git, key(LIST_VARS[field]), to[field]);
  const [was, now] = [byVar(from.extra), byVar(to.extra)];
  for (const v of new Set([...was.keys(), ...now.keys()])) if (!isDeepStrictEqual(was.get(v), now.get(v))) await setList(git, key(v), now.get(v) ?? []);
}
