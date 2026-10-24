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
 * order. `urls` / `pushUrls` as git counts them (after the last empty value); `fetch` as configured; `displayUrl` the first url (else
 * push url) and `displayPushUrl` the first push url, a password masked, or null; `legacy` true when git reads the remote from a legacy `.git/remotes` / `.git/branches` file
 * (no url in config and such a file exists); `multiUrl` / `multiPushUrl` when that raw list holds more than one value
 * (remote.edit refuses to replace it).
 */
export async function listRemotes(git) {
  const names = await remoteNames(git);
  const raw = await rawConfigs(git, names);
  const out = [];
  for (const name of names) {
    const c = raw.get(name);
    const urls = effective(c.urls);
    const pushUrls = effective(c.pushUrls);
    const legacy = !hasUrl(c.urls) && (await legacyRemoteFile(git, name)) !== null;
    const masked = (u) => (u === undefined ? null : maskUrl(u));
    out.push({
      name, urls, pushUrls, fetch: c.fetch, displayUrl: masked(urls[0] ?? pushUrls[0]), displayPushUrl: masked(pushUrls[0]), legacy,
      // What remote.edit's single-value check counts: raw config values, an empty reset included.
      multiUrl: multiValued(c.urls), multiPushUrl: multiValued(c.pushUrls),
    });
  }
  return out;
}

/** Every branch's remote keys from config: Map(branch → {remote, merge (the first), pushRemote}), each null when unset. */
export async function branchRemotes(git) {
  const r = await git(['config', '-z', '--get-regexp', '^branch\\.'], { okExit: [0, 1] });
  const branches = new Map();
  const field = { remote: 'remote', merge: 'merge', pushremote: 'pushRemote' };
  for (const [key, value] of parseConfigZ(decoder.decode(r.stdout))) {
    const dot = key.lastIndexOf('.');
    const f = field[key.slice(dot + 1).toLowerCase()];
    if (!f) continue;
    const branch = key.slice('branch.'.length, dot);
    const b = branches.get(branch) ?? { remote: null, merge: null, pushRemote: null };
    if (f === 'merge') b.merge ??= value;
    else b[f] = value;
    branches.set(branch, b);
  }
  return branches;
}

/**
 * Local branches whose upstream remote (`branch.<b>.remote`) is `remote` → [{branch, merge}] (`merge` the first
 * `branch.<b>.merge`, or null), from config: git clears these keys on remove and rewrites them on rename.
 */
export async function upstreamsOf(git, remote) {
  return [...await branchRemotes(git)].filter(([, b]) => b.remote === remote).map(([branch, b]) => ({ branch, merge: b.merge }));
}

/** `remote.pushDefault`, or null. */
async function pushDefaultOf(git) {
  const r = await git(['config', '--get', 'remote.pushDefault'], { okExit: [0, 1] });
  return r.exitCode === 0 ? decoder.decode(r.stdout).replace(/\n$/, '') : null;
}

/** What else names `remote` for pushing: {pushRemotes: the branches whose `branch.<b>.pushRemote` it is, pushDefault: whether `remote.pushDefault` is}. */
export async function pushRemotesOf(git, remote) {
  const pushRemotes = [...await branchRemotes(git)].filter(([, b]) => b.pushRemote === remote).map(([branch]) => branch);
  return { pushRemotes, pushDefault: await pushDefaultOf(git) === remote };
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
 * - `to` null: the section removed, then the branch keys and pushDefault `from` holds unset (exit 5 tolerated).
 * - `from` null: each list added in order — urls, fetch refspecs, push urls (`remote add` then `set-url --push` order),
 *   the extra keys — then each upstream's `branch.<b>.remote` / `.merge`, each `branch.<b>.pushRemote`, pushDefault.
 * - both: each list or extra variable that differs set to `to`'s values.
 */
export async function writeRemoteConfig(git, name, from, to) {
  const key = (v) => `remote.${name}.${v}`;
  if (to === null) {
    await git(['config', '--remove-section', `remote.${name}`]);
    const unset = (k) => git(['config', '--unset-all', k], { okExit: [0, 5] });
    for (const { branch } of from.upstreams) {
      await unset(`branch.${branch}.remote`);
      await unset(`branch.${branch}.merge`);
    }
    for (const branch of from.pushRemotes ?? []) await unset(`branch.${branch}.pushRemote`);
    if (from.pushDefault) await unset('remote.pushDefault');
    return;
  }
  if (from === null) {
    const add = (k, v) => git(['config', '--add', k, v]);
    for (const field of ['urls', 'fetch', 'pushUrls']) for (const v of to[field]) await add(key(LIST_VARS[field]), v);
    for (const [v, value] of to.extra) await add(key(v), value);
    for (const { branch, merge } of to.upstreams) {
      await add(`branch.${branch}.remote`, name);
      if (merge !== null) await add(`branch.${branch}.merge`, merge);
    }
    for (const branch of to.pushRemotes ?? []) await add(`branch.${branch}.pushRemote`, name);
    if (to.pushDefault) await add('remote.pushDefault', name);
    return;
  }
  for (const field of ['urls', 'fetch', 'pushUrls']) if (!isDeepStrictEqual(from[field], to[field])) await setList(git, key(LIST_VARS[field]), to[field]);
  const [was, now] = [byVar(from.extra), byVar(to.extra)];
  for (const v of new Set([...was.keys(), ...now.keys()])) if (!isDeepStrictEqual(was.get(v), now.get(v))) await setList(git, key(v), now.get(v) ?? []);
}
