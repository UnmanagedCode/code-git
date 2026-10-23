import { Refusal } from '../../refusals.js';

// Parsers for the graph.* ops. Pure: each takes a command's decoded stdout. Record grammars are fixed by the
// --format strings in src/git/ops/graph.js; a record that does not fit is a parser bug, thrown as INTERNAL.

const bad = (what) => new Refusal('INTERNAL', `graph parser: ${what}`);
const nonEmpty = (s) => (s === '' ? null : s);
const splitParents = (s) => (s === '' ? [] : s.split(' '));

/**
 * Records of `n` fields: the first n-1 NUL-terminated, the last newline-terminated. Reading by NUL count, not by
 * line, keeps a newline inside an earlier field (a crafted ident) from splitting a record; the last field (`%s`,
 * a joined subject, or a refname) never holds one.
 */
export function parseRecords(out, n) {
  const records = [];
  let i = 0;
  while (i < out.length) {
    const rec = [];
    for (let f = 0; f < n - 1; f++) {
      const j = out.indexOf('\0', i);
      if (j === -1) throw bad(`record ${records.length} has ${f + 1} of ${n} fields`);
      rec.push(out.slice(i, j));
      i = j + 1;
    }
    let j = out.indexOf('\n', i);
    if (j === -1) j = out.length;
    const last = out.slice(i, j);
    if (last.includes('\0')) throw bad(`record ${records.length} has more than ${n} fields`);
    rec.push(last);
    records.push(rec);
    i = j + 1;
  }
  return records;
}

/** `git remote` → names. */
export const parseRemotes = (out) => out.split('\n').filter(Boolean);

/** The remote a `refs/remotes/<path>` belongs to: the longest remote name prefixing `<path>/`, else its first segment. */
export function remoteOf(path, remotes) {
  let best = null;
  for (const r of remotes) if (path.startsWith(`${r}/`) && (!best || r.length > best.length)) best = r;
  return best ?? path.split('/')[0];
}

/** `refs/remotes/<path>` → {remote, branch}: the remote by `remoteOf`, the branch the rest of the path. */
export function splitRemoteRef(refname, remotes) {
  const path = refname.slice('refs/remotes/'.length);
  const remote = remoteOf(path, remotes);
  return { remote, branch: path.slice(remote.length + 1) };
}

/**
 * `for-each-ref --format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(HEAD)%00%(symref)`
 * over refs/heads, refs/remotes, refs/tags → Ref[]. `oid` is the commit a ref names (an annotated tag peeled once), or
 * null when that is not a commit. Remote HEAD symrefs are skipped.
 */
export function parseRefs(out, remotes) {
  const refs = [];
  for (const [name, objectname, objecttype, peeled, peeledType, head, symref] of parseRecords(out, 7)) {
    let kind;
    let short;
    let remote = null;
    if (name.startsWith('refs/heads/')) {
      kind = 'local';
      short = name.slice('refs/heads/'.length);
    } else if (name.startsWith('refs/remotes/')) {
      if (symref) continue;
      kind = 'remote';
      short = name.slice('refs/remotes/'.length);
      ({ remote } = splitRemoteRef(name, remotes));
    } else if (name.startsWith('refs/tags/')) {
      kind = 'tag';
      short = name.slice('refs/tags/'.length);
    } else {
      continue;
    }
    const oid = objecttype === 'commit' ? objectname : objecttype === 'tag' && peeledType === 'commit' ? peeled : null;
    refs.push({ name, kind, short, remote, oid, isHead: head === '*' });
  }
  return refs;
}

/** `stash list --format=%H%x00%P%x00%gd%x00%at%x00%s` → Stash[], newest first. */
export const parseStashes = (out) => parseRecords(out, 5).map(([oid, parents, selector, time, subject]) => ({
  oid, parents: splitParents(parents), selector, time: Number(time), subject,
}));

/** `worktree list --porcelain -z`: attribute fields, each record ended by an empty field → GitWorktree[]. */
export function parseWorktrees(out) {
  const list = [];
  let cur = null;
  for (const f of out.split('\0')) {
    if (f === '') {
      if (cur) list.push(cur);
      cur = null;
      continue;
    }
    const sp = f.indexOf(' ');
    const key = sp === -1 ? f : f.slice(0, sp);
    const value = sp === -1 ? '' : f.slice(sp + 1);
    if (key === 'worktree') {
      if (cur) list.push(cur);
      cur = { path: value, head: null, branch: null, detached: false, bare: false, locked: false };
    } else if (!cur) {
      throw bad(`worktree attribute ${JSON.stringify(key)} before any worktree`);
    } else if (key === 'HEAD') {
      cur.head = /^0+$/.test(value) ? null : value;
    } else if (key === 'branch') {
      cur.branch = value;
    } else if (key === 'detached') {
      cur.detached = true;
    } else if (key === 'bare') {
      cur.bare = true;
    } else if (key === 'locked') {
      cur.locked = true;
    }
  }
  if (cur) list.push(cur);
  return list;
}

/** `log --format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%s` → CommitItem[]. */
export const parseCommits = (out) => parseRecords(out, 6).map(([oid, parents, name, email, time, subject]) => ({
  oid, parents: splitParents(parents), author: { name, email }, time: Number(time), subject,
}));

/** One oid per line. */
export const parseOids = (out) => out.split('\n').filter(Boolean);

const STAT_RE = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;

/**
 * `log --no-walk=unsorted --stdin --format=%x00%H%x00%P --shortstat` → {[oid]: {files, insertions, deletions} | null}.
 * A merge has no stat (null); a non-merge without a stat line changed nothing. The wording is stable under LC_ALL=C.
 */
export function parseShortstats(out) {
  const fields = out.split('\0');
  if (fields[0].trim() !== '') throw bad('shortstat output does not start with a record');
  const stats = {};
  for (let i = 1; i < fields.length; i += 2) {
    const oid = fields[i];
    const rest = fields[i + 1];
    if (rest === undefined) throw bad(`shortstat record ${oid} has no parents field`);
    const nl = rest.indexOf('\n');
    const parents = splitParents(nl === -1 ? rest : rest.slice(0, nl));
    if (parents.length > 1) { stats[oid] = null; continue; }
    const m = STAT_RE.exec(rest);
    stats[oid] = m ? { files: Number(m[1]), insertions: Number(m[2] ?? 0), deletions: Number(m[3] ?? 0) } : { files: 0, insertions: 0, deletions: 0 };
  }
  return stats;
}

const IDENT_RE = /^(.*?)\s*<([^<>]*)>$/;

/**
 * `log -1 --format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%cN%x00%cE%x00%ct%x00%G?%x00%GS%x00%GK%x00<co-author trailers>%x00%s%x00%b`.
 * The body is the last field. Co-author values that are not `Name <email>` are dropped (an older git prints its
 * unsupported trailers placeholder literally).
 */
export function parseCommitMeta(out) {
  const f = out.split('\0');
  if (f.length < 14) throw bad(`commit record has ${f.length} of 14 fields`);
  const [oid, parents, aN, aE, at, cN, cE, ct, gStatus, gSigner, gKey, trailers, subject] = f;
  const coAuthors = trailers.split('\x1e').map((s) => IDENT_RE.exec(s.trim())).filter(Boolean).map((m) => ({ name: m[1], email: m[2] }));
  return {
    oid, parents: splitParents(parents),
    author: { name: aN, email: aE, time: Number(at) },
    committer: { name: cN, email: cE, time: Number(ct) },
    subject, body: f.slice(13).join('\0').replace(/\s+$/, ''), coAuthors,
    signature: { status: gStatus || 'N', signer: nonEmpty(gSigner), key: nonEmpty(gKey) },
  };
}

