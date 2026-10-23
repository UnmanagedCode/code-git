import { Refusal } from '../../refusals.js';
import { readNoIndex, worktreeEntry } from '../diff/noIndex.js';
import { chunkPaths, filePath, paramsObject, pathList } from '../params.js';
import { parseUnmerged } from '../parse/unmerged.js';
import { CONFLICT_LIMITS } from '../sequence/limits.js';
import { STAGE_LIMITS } from '../stage/limits.js';
import { perChunk } from '../stage/paths.js';
import { assertFileTarget, assertNotBlocked } from '../stash/guard.js';
import { OID_RE } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// The conflict tool's ops (docs/merge.md → The conflict tool): read a conflicted path's three stages and its worktree
// file, save a resolution to the worktree only (the index keeps its stages until the user marks it resolved with
// stage.files), and take one side for several paths. Never `git apply --index`.

const decoder = new TextDecoder('utf-8', { fatal: false });
const REGULAR = new Set(['100644', '100755']);
const SYMLINK = '120000';
const GITLINK = '160000';
const TREE = '040000';
const SIDES = ['ours', 'theirs'];
/** git's own binary test: a NUL in the first 8000 bytes. */
const BINARY_PROBE = 8000;
const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The unmerged entries of `paths` (ls-files -u, chunked) → Map(path → conflict). */
async function unmergedOf(git, paths) {
  const recs = await perChunk(git, ['ls-files', '-u', '-z'], paths);
  // perChunk splits on NUL already: rebuild the records parseUnmerged reads.
  return new Map(parseUnmerged(recs.map((r) => `${r}\0`).join('')).map((c) => [c.path, c]));
}

async function conflictOf(git, path) {
  const c = (await unmergedOf(git, [path])).get(path);
  if (!c) throw new Refusal('NOT_CONFLICTED', `${path} has no conflict`);
  return c;
}

/** `cat-file --batch` output → Map(oid → bytes). */
function parseBatch(buf) {
  const out = new Map();
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i);
    if (nl === -1) break;
    const [oid, type, size] = buf.subarray(i, nl).toString('latin1').split(' ');
    if (type === 'missing' || size === undefined) { i = nl + 1; continue; }
    const n = Number(size);
    out.set(oid, buf.subarray(nl + 1, nl + 1 + n));
    i = nl + 1 + n + 1;
  }
  return out;
}

/** Each side's bytes when it is a regular file or a symlink within CONFLICT_LIMITS.sideMaxBytes; sizes of all. */
async function sideBytes(git, c) {
  const sides = [c.base, c.ours, c.theirs].filter((s) => s && s.mode !== GITLINK);
  if (!sides.length) return { bytes: new Map(), large: new Set() };
  const list = (oids) => oids.map((o) => `${o}\n`).join('');
  const checks = decoder.decode((await git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], { stdin: list(sides.map((s) => s.oid)) })).stdout).split('\n');
  const large = new Set();
  const small = [];
  for (const line of checks) {
    const [oid, size] = line.split(' ');
    if (!OID_RE.test(oid ?? '')) continue;
    if (Number(size) > CONFLICT_LIMITS.sideMaxBytes) large.add(oid); else small.push(oid);
  }
  const unique = [...new Set(small)];
  const bytes = unique.length ? parseBatch((await git(['cat-file', '--batch'], { stdin: list(unique) })).stdout) : new Map();
  return { bytes, large };
}

/** What the tool can do with this conflict: three-pane text, or a notice with the take buttons. */
function contentOf(c, { bytes, large }) {
  if (!c.ours && !c.theirs) return 'none';
  if (!c.ours || !c.theirs) return 'oneSided';
  const sides = [c.base, c.ours, c.theirs].filter(Boolean);
  if (sides.some((s) => s.mode === GITLINK)) return 'submodule';
  if (sides.some((s) => s.mode === SYMLINK)) return 'symlink';
  if (sides.some((s) => large.has(s.oid))) return 'large';
  if (sides.some((s) => bytes.get(s.oid)?.subarray(0, BINARY_PROBE).includes(0))) return 'binary';
  return 'text';
}

/** The worktree file's object id as git would hash it with no filters, or null when nothing (or no file) is there. */
async function worktreeOid(git, path) {
  const entry = await worktreeEntry(git, path);
  if (entry.kind !== 'file') return { entry, oid: null };
  const r = await git(['hash-object', '--no-filters', '--', path]);
  return { entry, oid: decoder.decode(r.stdout).trim() };
}

/** A one-file tree holding `blob` (`mode`) at `path`, built level by level with `mktree -z`. */
async function oneFileTree(git, path, mode, blob) {
  const segs = path.split('/');
  let entry = `${mode} blob ${blob}\t${segs.at(-1)}\0`;
  let tree = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (i < segs.length - 1) entry = `${TREE} tree ${tree}\t${segs[i]}\0`;
    tree = decoder.decode((await git(['mktree', '-z'], { stdin: entry })).stdout).trim();
  }
  return tree;
}

const b64 = (bytes) => (bytes ? Buffer.from(bytes).toString('base64') : null);

export const ops = [
  {
    name: 'conflict.read',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['path'], 'conflict.read');
      return { path: filePath(p.path) };
    },
    async run(git, { path }) {
      const c = await conflictOf(git, path);
      const read = await sideBytes(git, c);
      const content = contentOf(c, read);
      // Text is sent only for the text case; the other cases need the oids alone (and a symlink its targets).
      const withBytes = content === 'text' || content === 'symlink';
      const side = (s) => (s ? { mode: s.mode, oid: s.oid, b64: withBytes && s.mode !== GITLINK ? b64(read.bytes.get(s.oid)) : null } : null);
      const { entry, oid } = await worktreeOid(git, path);
      let worktree = null;
      if (entry.kind === 'file') {
        const r = content === 'text' ? await readNoIndex(git, path, { maxBytes: CONFLICT_LIMITS.sideMaxBytes }) : null;
        worktree = { oid, b64: r?.kind === 'file' ? b64(r.bytes) : null };
      } else if (entry.kind !== 'absent') {
        worktree = { oid: null, b64: null };
      }
      return { path, kind: c.kind, content, base: side(c.base), ours: side(c.ours), theirs: side(c.theirs), worktree };
    },
  },
  {
    name: 'conflict.save',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['path', 'contentB64', 'expect'], 'conflict.save');
      const path = filePath(p.path);
      if (path.split('/').length > CONFLICT_LIMITS.pathDepthMax) throw new Refusal('BAD_PARAMS', `path is deeper than ${CONFLICT_LIMITS.pathDepthMax} levels`);
      if (typeof p.contentB64 !== 'string' || !B64_RE.test(p.contentB64)) throw new Refusal('BAD_PARAMS', 'contentB64 must be strict base64');
      const bytes = Buffer.from(p.contentB64, 'base64');
      if (bytes.length > CONFLICT_LIMITS.saveMaxBytes) throw new Refusal('BAD_PARAMS', `the content is over ${CONFLICT_LIMITS.saveMaxBytes} bytes`);
      if (p.expect !== null && (typeof p.expect !== 'string' || !OID_RE.test(p.expect))) throw new Refusal('BAD_PARAMS', 'expect must be an object id or null');
      return { path, bytes, expect: p.expect };
    },
    async run(git, { path, bytes, expect }) {
      await assertWorktree(git);
      const c = await conflictOf(git, path);
      const sides = [c.ours, c.theirs].filter(Boolean);
      if (!sides.length || [c.base, c.ours, c.theirs].some((s) => s && !REGULAR.has(s.mode))) {
        throw new Refusal('NOT_TEXT_CONFLICT', `${path} is not a conflict of two files: take a side instead`);
      }
      await assertNotBlocked(git, [path]);
      await assertFileTarget(git, path);
      const { oid: now } = await worktreeOid(git, path);
      if (now !== expect) throw new Refusal('FILE_CHANGED', `${path} changed since it was read: reload it`, { expect, actual: now });
      // The resolution as a blob (clean filters and eol as `git add` would), a tree holding only it, then written to
      // the worktree alone: restore --worktree reads the tree into an in-core index and leaves the index file's stages.
      const blob = decoder.decode((await git(['hash-object', '-w', '--stdin', `--path=${path}`], { stdin: bytes })).stdout).trim();
      const mode = (c.ours ?? c.theirs).mode;
      const tree = await oneFileTree(git, path, mode, blob);
      await git(['restore', `--source=${tree}`, '--worktree', '--', path]);
      return { oid: (await worktreeOid(git, path)).oid };
    },
  },
  {
    name: 'conflict.take',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['paths', 'side'], 'conflict.take');
      if (!SIDES.includes(p.side)) throw new Refusal('BAD_PARAMS', "side must be 'ours' or 'theirs'");
      return { paths: pathList(p.paths, 'paths', { max: CONFLICT_LIMITS.takeMax }).map(filePath), side: p.side };
    },
    async run(git, { paths, side }) {
      await assertWorktree(git);
      const conflicts = await unmergedOf(git, paths);
      const missing = paths.filter((p) => !conflicts.has(p));
      if (missing.length) throw new Refusal('NOT_CONFLICTED', `${missing[0]} has no conflict`, { paths: missing });
      // Every path, before any write: checkout, add and rm all follow an untracked symlinked leading directory (rm
      // unlinks the file outside), and a half-applied take would leave some paths resolved behind a refusal.
      await assertNotBlocked(git, paths);
      for (const p of paths) if (conflicts.get(p)[side]?.mode !== GITLINK) await assertFileTarget(git, p);
      const gitlinks = [];
      const files = [];
      const deleted = [];
      for (const p of paths) {
        const s = conflicts.get(p)[side];
        if (!s) deleted.push(p);
        else if (s.mode === GITLINK) gitlinks.push({ path: p, oid: s.oid });
        else files.push(p);
      }
      // A stage-0 entry replaces every unmerged stage of its path; the submodule's own worktree is not touched.
      if (gitlinks.length) await git(['update-index', '-z', '--index-info'], { stdin: gitlinks.map((g) => `${GITLINK} ${g.oid} 0\t${g.path}\0`).join('') });
      if (files.length) {
        for (const chunk of chunkPaths(files, STAGE_LIMITS.argvChunkBytes)) {
          await git(['checkout', `--${side}`, '--', ...chunk]);
          await git(['add', '--', ...chunk]);
        }
      }
      for (const chunk of chunkPaths(deleted, STAGE_LIMITS.argvChunkBytes)) await git(['rm', '-q', '-f', '--', ...chunk]);
      return { resolved: [...gitlinks.map((g) => g.path), ...files], deleted };
    },
  },
];
