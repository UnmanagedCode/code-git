import { Refusal } from '../../refusals.js';
import { parseRemotes } from '../parse/graph.js';
import { hasUrl, legacyRemoteFile } from './tracking.js';

// Reading a remote's config (`remote.<name>.*` and the branches whose upstream it is), for remote.list and for the undo
// record of the ops that change or remove a remote.

const decoder = new TextDecoder('utf-8', { fatal: false });

/** `config -z --get-regexp` output → [[key, value]] (each record `key\nvalue\0`; a key alone when it has no value). */
export function parseConfigZ(out) {
  return out.split('\0').filter(Boolean).map((rec) => {
    const nl = rec.indexOf('\n');
    return nl === -1 ? [rec, ''] : [rec.slice(0, nl), rec.slice(nl + 1)];
  });
}

/** git's url list semantics (hasUrl): an empty value clears what came before it. */
const effective = (values) => values.slice(values.lastIndexOf('') + 1);

/** A url with any userinfo password masked: `https://u:***@h/r`. */
export const maskUrl = (url) => url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@:]*):[^/@]*@/, '$1:***@');

/**
 * Every remote's raw config: Map(name → {urls, pushUrls, fetch}) for `remotes` (`git remote`'s names), values as
 * configured (empty ones kept). A key's remote is the longest known name it starts with (`remote.<name>.<var>`; a name
 * may hold dots).
 */
async function rawConfigs(git, remotes) {
  const r = await git(['config', '-z', '--get-regexp', '^remote\\.'], { okExit: [0, 1] });
  const out = new Map(remotes.map((n) => [n, { urls: [], pushUrls: [], fetch: [] }]));
  const byLength = [...remotes].sort((a, b) => b.length - a.length);
  for (const [key, value] of parseConfigZ(decoder.decode(r.stdout))) {
    const name = byLength.find((n) => key.startsWith(`remote.${n}.`) && !key.slice(`remote.${n}.`.length).includes('.'));
    if (name === undefined) continue;
    const field = { url: 'urls', pushurl: 'pushUrls', fetch: 'fetch' }[key.slice(`remote.${name}.`.length).toLowerCase()];
    if (field) out.get(name)[field].push(value);
  }
  return out;
}

/** `git remote`'s names. */
export async function remoteNames(git) {
  return parseRemotes(decoder.decode((await git(['remote'])).stdout));
}

/**
 * Every remote: [{name, urls, pushUrls, fetch, displayUrl, displayPushUrl, legacy}] in `git remote` order. `urls` /
 * `pushUrls` as git counts them (after the last empty value); `fetch` as configured; `displayUrl` the first url (else
 * push url) and `displayPushUrl` the first push url, a password masked, or null; `legacy` true when git reads the remote from a legacy `.git/remotes` / `.git/branches` file
 * (no url in config and such a file exists).
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
    out.push({ name, urls, pushUrls, fetch: c.fetch, displayUrl: masked(urls[0] ?? pushUrls[0]), displayPushUrl: masked(pushUrls[0]), legacy });
  }
  return out;
}

/**
 * Local branches whose upstream remote (`branch.<b>.remote`) is `remote` → [{branch, merge}] (`merge` the first
 * `branch.<b>.merge`, or null), from config: git clears these keys on remove and rewrites them on rename.
 */
export async function upstreamsOf(git, remote) {
  const r = await git(['config', '-z', '--get-regexp', '^branch\\.'], { okExit: [0, 1] });
  const branches = new Map();
  for (const [key, value] of parseConfigZ(decoder.decode(r.stdout))) {
    const dot = key.lastIndexOf('.');
    const branch = key.slice('branch.'.length, dot);
    const v = key.slice(dot + 1).toLowerCase();
    if (v !== 'remote' && v !== 'merge') continue;
    const b = branches.get(branch) ?? { remote: null, merge: null };
    if (v === 'remote') b.remote = value;
    else b.merge ??= value;
    branches.set(branch, b);
  }
  return [...branches].filter(([, b]) => b.remote === remote).map(([branch, b]) => ({ branch, merge: b.merge }));
}

/**
 * One remote's config as an undo record keeps it: {urls, pushUrls, fetch, upstreams} (raw values: a restore writes them
 * back as they were). REMOTE_UNKNOWN when `name` is not one of `git remote`'s.
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
