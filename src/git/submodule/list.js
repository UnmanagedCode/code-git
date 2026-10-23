import { commitOid } from '../diff/source.js';
import { perChunk } from '../stage/paths.js';
import { OID_RE } from '../validate.js';
import { remoteUrl } from './copied/url.js';
import { SUBMODULE_LIMITS } from './limits.js';
import { isRelativeUrl } from './url.js';
import { submoduleName, submodulePath } from './validate.js';

// The submodules of the op's repo and the state of each: what `.gitmodules` declares, what the repo's own config, index,
// HEAD and status say, and one probe of each submodule's directory. Reads only.

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);
const GITLINK = '160000';
const HEX_HEAD = new RegExp(`^${OID_RE.source.slice(1, -1)}\n$`);

/**
 * `config -z --get-regexp` output (`key\nvalue\0`, a value-less key alone) → [{name, key, value}] for `submodule.<name>.<key>`
 * keys. The key is split at its first `\n` only (a value may hold newlines); the name is everything between
 * `submodule.` and the last `.` (a name may hold dots).
 */
export function parseSubmoduleConfig(out) {
  const rows = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const nl = rec.indexOf('\n');
    const full = nl === -1 ? rec : rec.slice(0, nl);
    const value = nl === -1 ? null : rec.slice(nl + 1);
    const dot = full.lastIndexOf('.');
    if (!full.startsWith('submodule.') || dot <= 'submodule.'.length) continue;
    rows.push({ name: full.slice('submodule.'.length, dot), key: full.slice(dot + 1), value });
  }
  return rows;
}

/** `config <where> -z --get-regexp <re>` → parseSubmoduleConfig rows; none when nothing matches (exit 1, or no file). */
async function configRows(git, where, re) {
  const r = await git(['config', ...where, '-z', '--get-regexp', re], { okExit: [0, 1] });
  return r.exitCode === 0 ? parseSubmoduleConfig(text(r)) : [];
}

/** `.gitmodules` (the working tree's file, as git reads it) → [{name, path, url, branch}], entries without a path dropped. */
export async function readGitmodules(git) {
  const by = new Map();
  for (const { name, key, value } of await configRows(git, ['-f', '.gitmodules'], '^submodule\\..*\\.(path|url|branch)$')) {
    if (!by.has(name)) by.set(name, { name, path: null, url: null, branch: null });
    by.get(name)[key] = value;
  }
  return [...by.values()].filter((e) => typeof e.path === 'string' && e.path !== '');
}

/** Why an entry may not be acted on: its name or path fails the checks, or another entry declares the same path. */
function blockedBy(e, dupPaths) {
  try { submoduleName(e.name); } catch { return 'name'; }
  try { submodulePath(e.path); } catch { return 'path'; }
  return dupPaths.has(e.path) ? 'path' : null;
}

/** `remoteUrl`'s refusal message for the url git would clone, or null (fine, absent, or relative and not resolved yet). */
function urlProblem(url) {
  if (url === null || isRelativeUrl(url)) return null;
  try {
    remoteUrl(url);
    return null;
  } catch (e) {
    return e.message;
  }
}

/** `ls-files -s -z` → path → {recorded: the stage-0 gitlink oid, conflicted}. */
async function indexState(git, paths) {
  const out = new Map(paths.map((p) => [p, { recorded: null, conflicted: false }]));
  for (const f of await perChunk(git, ['ls-files', '-s', '-z'], paths)) {
    const tab = f.indexOf('\t');
    const [mode, oid, stage] = f.slice(0, tab).split(' ');
    const s = out.get(f.slice(tab + 1));
    if (!s) continue;
    if (stage !== '0') s.conflicted = true;
    else if (mode === GITLINK) s.recorded = oid;
  }
  return out;
}

/** `ls-tree -z HEAD` → path → the committed gitlink oid; empty with an unborn HEAD. */
async function committedState(git, paths) {
  const out = new Map();
  if (!await commitOid(git, 'HEAD')) return out;
  for (const f of await perChunk(git, ['ls-tree', '-z', 'HEAD'], paths)) {
    const tab = f.indexOf('\t');
    const [mode, , oid] = f.slice(0, tab).split(' ');
    if (mode === GITLINK) out.set(f.slice(tab + 1), oid);
  }
  return out;
}

/** The path of a porcelain v2 entry: after `n` space-separated fields. */
const afterFields = (f, n) => {
  let i = -1;
  for (let k = 0; k < n; k++) i = f.indexOf(' ', i + 1);
  return f.slice(i + 1);
};

/** `status --porcelain=v2` → path → {modified, untracked}, from each submodule entry's `S<c><m><u>` field. */
async function statusState(git, paths) {
  const out = new Map();
  const fields = await perChunk(git, ['status', '--porcelain=v2', '-z', '--ignore-submodules=none', '-unormal'], paths);
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const n = { 1: 8, 2: 9, u: 10 }[f[0]];
    if (!n) continue;
    const sub = f.split(' ', 3)[2];
    if (sub.startsWith('S')) out.set(afterFields(f, n), { modified: sub[2] === 'M', untracked: sub[3] === 'U' });
    if (f[0] === '2') i++; // a rename entry is followed by its original path
  }
  return out;
}

/**
 * One submodule directory: `{populated, head, escapes}`. Populated when git, run in it with its own `.git`, reports it
 * as its own top level (`top/path`); `head` is its HEAD oid, null when unborn. A top level elsewhere (a symlink) escapes.
 */
async function probe(git, top, path) {
  const r = await git(['-C', path, '--git-dir=.git', 'rev-parse', '--show-toplevel', 'HEAD'], { okExit: [0, 128] });
  const out = text(r);
  const prefix = `${top}/${path}\n`;
  if (out.startsWith(prefix)) {
    const rest = out.slice(prefix.length);
    return { populated: true, head: HEX_HEAD.test(rest) ? rest.slice(0, -1) : null, escapes: false };
  }
  return { populated: false, head: null, escapes: out !== '' };
}

/** Runs `fn` over `items`, at most `n` at a time, in order. */
async function mapLimited(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * The repo's submodules, sorted by path: `{submodules, truncated}`, at most SUBMODULE_LIMITS.maxListed (no probe past it).
 * An entry: {name, path, url, resolvedUrl, branch, initialized, populated, recorded, committed, head, outOfSync,
 * modified, untracked, added, conflicted, blocked, urlProblem} (docs/submodules.md → Status).
 */
export async function listSubmodules(git) {
  const top = text(await git(['rev-parse', '--show-toplevel'])).replace(/\n$/, '');
  const declared = await readGitmodules(git);
  if (!declared.length) return { submodules: [], truncated: false };
  declared.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const truncated = declared.length > SUBMODULE_LIMITS.maxListed;
  const entries = declared.slice(0, SUBMODULE_LIMITS.maxListed);
  const seen = new Set();
  const dupPaths = new Set();
  for (const e of declared) (seen.has(e.path) ? dupPaths : seen).add(e.path);

  const local = new Map();
  for (const { name, key, value } of await configRows(git, ['--local'], '^submodule\\..*\\.(url|active)$')) {
    if (!local.has(name)) local.set(name, {});
    local.get(name)[key] = value;
  }
  for (const e of entries) e.blocked = blockedBy(e, dupPaths);
  const paths = entries.filter((e) => e.blocked !== 'path').map((e) => e.path);
  const [index, committed, status] = paths.length
    ? [await indexState(git, paths), await committedState(git, paths), await statusState(git, paths)]
    : [new Map(), new Map(), new Map()];
  const probes = await mapLimited(entries, SUBMODULE_LIMITS.probeConcurrency, (e) => (e.blocked === 'path' ? null : probe(git, top, e.path)));

  const submodules = entries.map((e, i) => {
    const p = probes[i] ?? { populated: false, head: null, escapes: false };
    const ix = index.get(e.path) ?? { recorded: null, conflicted: false };
    const st = status.get(e.path) ?? { modified: false, untracked: false };
    const resolvedUrl = local.get(e.name)?.url ?? null;
    const recorded = ix.recorded;
    const committedOid = committed.get(e.path) ?? null;
    return {
      name: e.name, path: e.path, url: e.url, resolvedUrl, branch: e.branch,
      initialized: resolvedUrl !== null,
      populated: p.populated, recorded, committed: committedOid, head: p.head,
      outOfSync: Boolean(p.populated && p.head && recorded && p.head !== recorded),
      modified: p.populated && st.modified, untracked: p.populated && st.untracked,
      added: Boolean(recorded && !committedOid), conflicted: ix.conflicted,
      blocked: e.blocked ?? (p.escapes ? 'escapes' : null),
      urlProblem: urlProblem(resolvedUrl ?? e.url),
    };
  });
  return { submodules, truncated };
}

/** The listed entry at `path`, or null. */
export const entryAt = (list, path) => list.submodules.find((e) => e.path === path) ?? null;
