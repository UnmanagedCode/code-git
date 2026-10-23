import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { bad, nulPaths, optBool, paramsObject, pathList } from '../params.js';
import { parseRecords } from '../parse/graph.js';
import { STAGE_LIMITS } from '../stage/limits.js';
import { assertNoUnmerged, assertNotBlocked } from '../stash/guard.js';
import { checkMessage, reMessage } from '../stash/message.js';
import { dropVerified, namesOf, resolveStash } from '../stash/resolve.js';
import { stashUndo } from '../stash/undo.js';
import { assertGitAtLeast } from '../stash/version.js';
import { assertOid } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Stash: save, apply, drop, rename (docs/protocol.md → Stash ops). Every op is a non-cancellable write: an aborted
// stash or apply can leave index.lock, a half-applied merge or a half-restored set of untracked files. A stash is named
// by its full oid (src/git/stash/resolve.js).

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);
const FROM_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul'];

/** refs/stash's oid, or null when there is no stash. */
async function stashTip(git) {
  const r = await git(['rev-parse', '-q', '--verify', 'refs/stash'], { okExit: [0, 1] });
  return r.exitCode === 0 ? text(r).trim() : null;
}

async function assertBornHead(git) {
  const head = await commitOid(git, 'HEAD');
  if (!head) throw new Refusal('NO_HEAD', 'there is no commit yet: a stash needs one to be based on');
  return head;
}

/** The paths a save would take out of the worktree: the named ones, the staged ones, or every changed tracked one. */
function savedPaths(git, p) {
  if (p.paths) return p.paths;
  if (p.staged) return namesOf(git, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--no-relative', '--no-ext-diff', '--no-textconv']);
  return namesOf(git, ['diff-index', '-z', '--name-only', '--no-renames', 'HEAD']);
}

/** `{oid}` alone, the full oid of a stash's W commit. */
const oidParams = (raw, op, keys = ['oid']) => {
  const p = paramsObject(raw, keys, op);
  return { ...p, oid: assertOid(p.oid) };
};

export const ops = [
  {
    name: 'stash.push',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['message', 'paths', 'includeUntracked', 'keepIndex', 'staged'], 'stash.push');
      const out = {
        message: checkMessage(p.message),
        paths: p.paths === undefined ? null : pathList(p.paths, 'paths', { max: STAGE_LIMITS.maxPaths }),
        includeUntracked: optBool(p.includeUntracked, 'includeUntracked'),
        keepIndex: optBool(p.keepIndex, 'keepIndex'),
        staged: optBool(p.staged, 'staged'),
      };
      if (out.staged && (out.includeUntracked || out.keepIndex)) throw bad('staged cannot be combined with includeUntracked or keepIndex');
      return out;
    },
    async run(git, p) {
      await assertWorktree(git);
      await assertBornHead(git);
      await assertNoUnmerged(git);
      if (p.staged) await assertGitAtLeast(git, [2, 35], 'stash push --staged');
      await assertNotBlocked(git, await savedPaths(git, p));
      const before = await stashTip(git);
      const args = ['stash', 'push', '-q'];
      if (p.staged) args.push('--staged');
      if (p.keepIndex) args.push('--keep-index');
      if (p.includeUntracked) args.push('--include-untracked');
      if (p.message) args.push(`--message=${p.message}`);
      // Without paths, git's own `-u` cleanup and `--keep-index` checkout name `:/`, which GIT_LITERAL_PATHSPECS=1 (BASE_ENV)
      // turns into a literal path matching nothing: `-u` would leave the untracked files in place, `--keep-index` fail.
      // `.` (the root: commands run there) is what `:/` means.
      const paths = p.paths ?? (p.includeUntracked || p.keepIndex ? ['.'] : null);
      if (paths) await git([...args, ...FROM_STDIN], { stdin: nulPaths(paths) });
      else await git(args);
      const after = await stashTip(git);
      if (after === before) throw new Refusal('NOTHING_TO_STASH', 'there are no local changes to stash');
      const { message } = await resolveStash(git, after);
      return { oid: after, selector: 'stash@{0}', undo: stashUndo({ stashes: [{ oid: after, old: null, new: { message }, restore: 'pop' }] }) };
    },
  },
  {
    name: 'stash.drop',
    kind: 'write',
    params: (raw) => oidParams(raw, 'stash.drop'),
    async run(git, p) {
      const s = await dropVerified(git, p.oid);
      return { oid: p.oid, undo: stashUndo({ stashes: [{ oid: p.oid, old: { message: s.message }, new: null, restore: 'store' }] }) };
    },
  },
  {
    // A stash's message is its W commit's subject and its reflog entry's: rename re-commits W with the new subject
    // (same tree, parents, author, committer and dates), stores that, and only then drops the original.
    name: 'stash.rename',
    kind: 'write',
    params(raw) {
      const p = oidParams(raw, 'stash.rename', ['oid', 'message']);
      const message = checkMessage(p.message);
      if (!message) throw bad('message must not be empty');
      return { oid: p.oid, message };
    },
    async run(git, p) {
      const s = await resolveStash(git, p.oid);
      const subject = reMessage(s.message, p.message);
      if (subject === s.message) throw bad('the stash already has this message');
      const r = await git(['log', '-1', '--no-show-signature', '--date=raw', '--format=%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd', '--end-of-options', p.oid]);
      const [[an, ae, ad, cn, ce, cd]] = parseRecords(text(r), 6);
      const env = {
        GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad, GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce, GIT_COMMITTER_DATE: cd,
      };
      const parents = s.parents.flatMap((x) => ['-p', x]);
      const created = text(await git(['commit-tree', '--no-gpg-sign', ...parents, '-F', '-', `${p.oid}^{tree}`], { stdin: `${subject}\n`, env })).trim();
      await git(['stash', 'store', `--message=${subject}`, created]);
      try {
        await dropVerified(git, p.oid);
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        // Both entries exist: the renamed copy at stash@{0} and the original.
        throw new Refusal(e.code, `the renamed stash was stored, but the original was not dropped: ${e.message}`, { ...e.extra, step: 'dropOriginal', newOid: created });
      }
      return {
        oid: created,
        previous: p.oid,
        undo: stashUndo({ stashes: [
          { oid: created, old: null, new: { message: subject }, restore: 'drop' },
          { oid: p.oid, old: { message: s.message }, new: null, restore: 'store' },
        ] }),
      };
    },
  },
];
