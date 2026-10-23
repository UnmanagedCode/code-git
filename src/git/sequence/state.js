import { readNoIndex, worktreeEntry } from '../diff/noIndex.js';
import { parseUnmerged } from '../parse/unmerged.js';
import { assertRefName, OID_RE } from '../validate.js';

// What is in progress in this checkout (docs/merge.md → State detection): a merge, rebase, cherry-pick or revert, read
// from git's own state so it survives a reload, and the unmerged index entries. Reads only.

const decoder = new TextDecoder('utf-8', { fatal: false });
const PSEUDO = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD'];
const KIND_OF = { MERGE_HEAD: 'merge', CHERRY_PICK_HEAD: 'cherry-pick', REVERT_HEAD: 'revert', REBASE_HEAD: 'rebase' };
/** Precedence when several are present: a rebase replays picks, so its stop may leave other pseudo-refs too. */
const ORDER = ['REBASE_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
/** A rebase state file read here is a ref name, an oid or a count. */
const STATE_FILE_MAX = 4096;
const HEADS = 'refs/heads/';

/** `cat-file --batch-check` answers per pseudo-ref: `<oid> commit <size>` or `<name> missing` → name → commit oid. */
function presentOf(out) {
  const lines = out.split('\n');
  const present = {};
  PSEUDO.forEach((name, i) => {
    const m = /^([0-9a-f]{40}|[0-9a-f]{64}) commit \d+$/.exec(lines[i] ?? '');
    if (m) present[name] = m[1];
  });
  return present;
}

/** A state file's first line, or null when it is absent, not a regular file or larger than any value it holds. */
async function stateLine(git, path) {
  const r = await readNoIndex(git, path, { maxBytes: STATE_FILE_MAX });
  return r.kind === 'file' ? r.bytes.toString('utf8').split('\n')[0] : null;
}

const oidOrNull = (s) => (s !== null && OID_RE.test(s) ? s : null);
const countOrNull = (s) => (s !== null && /^\d{1,9}$/.test(s) ? Number(s) : null);
function branchOrNull(s) {
  if (s === null || !s.startsWith(HEADS)) return null;
  try { assertRefName(s.slice(HEADS.length)); } catch { return null; }
  return s;
}

/**
 * The rebase in progress, from its state directory (`rebase-merge/`, or `rebase-apply/` holding `rebasing`; `git am`'s
 * `rebase-apply/` is not one), or null. Every value is validated and becomes null when it does not fit: the files are the
 * repository's, never trusted. `orig`: the branch's tip before the rebase (its undo).
 */
export async function readRebase(git) {
  // Both directories sit beside each other in this checkout's git dir; one path, no output split (a path may hold a newline).
  const merge = decoder.decode((await git(['rev-parse', '--git-path', 'rebase-merge'])).stdout).replace(/\n$/, '');
  const dir = merge.slice(0, -'rebase-merge'.length);
  let backend = null;
  if ((await worktreeEntry(git, merge)).kind === 'other') backend = { dir: merge, step: 'msgnum', total: 'end' };
  else if ((await worktreeEntry(git, `${dir}rebase-apply/rebasing`)).kind === 'file') backend = { dir: `${dir}rebase-apply`, step: 'next', total: 'last' };
  if (!backend) return null;
  const [branch, onto, step, total, orig] = await Promise.all(
    ['head-name', 'onto', backend.step, backend.total, 'orig-head'].map((name) => stateLine(git, `${backend.dir}/${name}`)),
  );
  return { branch: branchOrNull(branch), onto: oidOrNull(onto), step: countOrNull(step), total: countOrNull(total), orig: oidOrNull(orig) };
}

/**
 * `{operation, conflicts, merging}`: `operation` null or {kind: 'merge'|'rebase'|'cherry-pick'|'revert', incoming:
 * {oid, subject} | null, rebase: {branch, onto, step, total} | null}; `conflicts` the unmerged entries (parseUnmerged),
 * whatever is in progress (a squash merge or a stash apply leaves some with no operation); `merging`: MERGE_HEAD exists.
 * Three commands when HEAD is on a branch and no REBASE_HEAD exists.
 */
export async function operationState(git) {
  const [batch, sym, unmerged] = await Promise.all([
    git(['cat-file', '--batch-check'], { stdin: PSEUDO.map((n) => `${n}\n`).join('') }),
    git(['symbolic-ref', '-q', 'HEAD'], { okExit: [0, 1] }),
    git(['ls-files', '-u', '-z']),
  ]);
  const present = presentOf(decoder.decode(batch.stdout));
  const conflicts = parseUnmerged(decoder.decode(unmerged.stdout));
  // A rebase detaches HEAD for its whole run; REBASE_HEAD alone (a rebase's leftover) is not one without its directory.
  const rebase = sym.exitCode !== 0 || present.REBASE_HEAD ? await readRebase(git) : null;
  const name = rebase ? 'REBASE_HEAD' : ORDER.find((n) => n !== 'REBASE_HEAD' && present[n]);
  if (!name) return { operation: null, conflicts, merging: !!present.MERGE_HEAD };
  const oid = present[name] ?? null;
  let incoming = null;
  if (oid) {
    const r = await git(['log', '--no-walk=unsorted', '-z', '--no-show-signature', '--format=%H%x00%s', '--stdin'], { stdin: `${oid}\n` });
    const [, subject = ''] = decoder.decode(r.stdout).split('\0');
    incoming = { oid, subject };
  }
  const { orig: _orig, ...shown } = rebase ?? {};
  return { operation: { kind: KIND_OF[name], incoming, rebase: rebase ? shown : null }, conflicts, merging: !!present.MERGE_HEAD };
}
