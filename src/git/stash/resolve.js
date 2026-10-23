import { Refusal } from '../../refusals.js';
import { parseRecords } from '../parse/graph.js';
import { assertOid } from '../validate.js';
import { STASH_LIMITS } from './limits.js';

// Stashes are addressed by their W commit's full oid, never by `stash@{n}` from a client: every checkout of a project
// and every other session share one stash stack, so an index read earlier may name another stash by now.

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);
const LOG_SAFE = ['--no-show-signature', '--no-ext-diff', '--no-textconv'];
const DROPPED_RE = /^Dropped (stash@\{\d+\}) \(([0-9a-f]{40}|[0-9a-f]{64})\)$/m;

/** Every stash, newest first: [{oid, parents, n, selector, message}] — `message` is the reflog subject `stash store` takes back. */
export async function listStashes(git) {
  const r = await git(['stash', 'list', ...LOG_SAFE, '--format=%H%x00%P%x00%gs']);
  return parseRecords(text(r), 3).map(([oid, parents, message], n) => ({
    oid, parents: parents ? parents.split(' ') : [], n, selector: `stash@{${n}}`, message,
  }));
}

/** The stash whose W commit is `oid`, as listStashes gives it; STASH_UNKNOWN when there is none. */
export async function resolveStash(git, oid) {
  assertOid(oid);
  const s = (await listStashes(git)).find((x) => x.oid === oid);
  if (!s) throw new Refusal('STASH_UNKNOWN', `${oid.slice(0, 10)} is not a stash in this repository`);
  return s;
}

/** A commit's subject. */
export async function subjectOf(git, oid) {
  return text(await git(['log', '-1', ...LOG_SAFE, '--format=%s', '--end-of-options', oid])).replace(/\n$/, '');
}

/**
 * Drops the stash `oid` by its current index (`stash drop` takes no oid). git names the entry it dropped; when that is
 * another stash, a concurrent push or drop moved the indices between the lookup and the drop: that entry is stored
 * back at once (at the top) and STASH_MOVED refuses. Resolves the dropped stash.
 */
export async function dropVerified(git, oid) {
  const s = await resolveStash(git, oid);
  const r = await git(['stash', 'drop', s.selector]);
  const m = DROPPED_RE.exec(text(r));
  if (!m) throw new Refusal('GIT_FAILED', 'git stash drop did not say which stash it dropped', { stderr: decoder.decode(r.stderr) });
  if (m[2] !== oid) {
    await git(['stash', 'store', `--message=${await subjectOf(git, m[2])}`, m[2]]);
    throw new Refusal('STASH_MOVED', 'the stash list changed while dropping: nothing was lost, try again', { oid, restored: m[2] });
  }
  return s;
}

/** A `-z --name-only` listing's paths, its output capped at STASH_LIMITS.pathsMaxOutputBytes (OUTPUT_TOO_LARGE past it). */
export async function namesOf(git, args) {
  const r = await git(args, { maxOutputBytes: STASH_LIMITS.pathsMaxOutputBytes });
  return decoder.decode(r.stdout).split('\0').filter(Boolean);
}

/**
 * The paths applying stash `s` writes: `tracked` (base → W and base → I, so a staged change undone in the worktree
 * counts) and `untracked` (the U commit's tree, when there is one).
 */
export async function stashPaths(git, s) {
  const [base, index, untracked] = s.parents;
  const diff = (to) => namesOf(git, ['diff-tree', '-r', '-z', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', base, to]);
  const [w, i, u] = await Promise.all([
    diff(s.oid), diff(index), untracked ? namesOf(git, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', untracked]) : [],
  ]);
  return { tracked: [...new Set([...w, ...i])], untracked: u };
}
