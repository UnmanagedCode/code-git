import { Refusal } from '../../refusals.js';
import { DIFF_LIMITS } from '../diff/limits.js';
import { commitOid, DIFF_CONFIG, DIFF_FLAGS, emptyTree } from '../diff/source.js';
import { bad, filePath, nulPaths, optBool, paramsObject, pathList } from '../params.js';
import { parseRecords } from '../parse/graph.js';
import { STAGE_LIMITS } from '../stage/limits.js';
import { assertCcHeadAck, guardOverwrite, ownHead, parseConflictFiles, shortBranch } from '../stash/branch.js';
import { assertNoUnmerged, assertNotBlocked, assertNoUntrackedCollision } from '../stash/guard.js';
import { checkMessage, reMessage } from '../stash/message.js';
import { dropVerified, namesOf, resolveStash, stashPaths } from '../stash/resolve.js';
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

/**
 * The gates before anything writes a stash into the worktree: a resolved index, no leading directory of the stash's
 * paths blocked by an untracked symlink or file, none of its untracked files already there.
 */
async function assertCanApply(git, s) {
  await assertNoUnmerged(git);
  const { tracked, untracked } = await stashPaths(git, s);
  await assertNotBlocked(git, [...tracked, ...untracked]);
  await assertNoUntrackedCollision(git, untracked);
}

/**
 * `stash apply [--index] <oid>`: clean → {conflicts: []}; merge conflicts (unmerged entries afterwards) → {conflicts}; git
 * refusing to overwrite local changes → CHECKOUT_CONFLICT; any other failure → GIT_FAILED.
 */
async function applyStash(git, oid, index) {
  const r = await git(['stash', 'apply', '-q', ...(index ? ['--index'] : []), oid], { okExit: [0, 1] });
  if (r.exitCode === 0) return { conflicts: [] };
  const unmerged = (await namesOf(git, ['ls-files', '-u', '-z'])).map((f) => f.slice(f.indexOf('\t') + 1));
  if (unmerged.length) return { conflicts: [...new Set(unmerged)] };
  const stderr = decoder.decode(r.stderr);
  const files = parseConflictFiles(stderr);
  if (files.length) throw new Refusal('CHECKOUT_CONFLICT', 'local changes would be overwritten', { files, stderr });
  throw new Refusal('GIT_FAILED', `git stash apply exited with ${r.exitCode}`, { exitCode: r.exitCode, stderr });
}

/** Drops a stash just applied cleanly; a concurrent change to the list (STASH_MOVED) keeps it and is reported, not thrown. */
async function dropApplied(git, s) {
  try {
    await dropVerified(git, s.oid);
    return { dropped: true, stashes: [{ oid: s.oid, old: { message: s.message }, new: null, restore: 'store' }] };
  } catch (e) {
    if (e.code !== 'STASH_MOVED') throw e;
    return { dropped: false, dropError: 'STASH_MOVED', stashes: [] };
  }
}

/** `{oid}` alone, the full oid of a stash's W commit. */
const oidParams = (raw, op, keys = ['oid']) => {
  const p = paramsObject(raw, keys, op);
  return { ...p, oid: assertOid(p.oid) };
};

const applyParams = (raw, op) => {
  const p = oidParams(raw, op, ['oid', 'index']);
  return { oid: p.oid, index: optBool(p.index, 'index') };
};

/** Which part of stash `s` holds `path`: 'tracked' (W differs from the base there) or 'untracked' (U has it); else PATH_NOT_IN_COMMIT. */
async function partOf(git, s, path) {
  const [base, , u] = s.parents;
  const tracked = await namesOf(git, ['diff-tree', '-r', '-z', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', base, s.oid, '--', path]);
  if (tracked.length === 1 && tracked[0] === path) return { part: 'tracked', from: base, to: s.oid };
  if (u) {
    const r = await git(['cat-file', '-t', `${u}:${path}`], { okExit: [0, 128] });
    if (r.exitCode === 0 && decoder.decode(r.stdout).trim() === 'blob') return { part: 'untracked', from: await emptyTree(git), to: u };
  }
  throw new Refusal('PATH_NOT_IN_COMMIT', `${path} is not a file this stash changes`);
}

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
  {
    name: 'stash.apply',
    kind: 'write',
    params: (raw) => applyParams(raw, 'stash.apply'),
    async run(git, p) {
      await assertWorktree(git);
      const s = await resolveStash(git, p.oid);
      await assertCanApply(git, s);
      // No confirmation is needed: git refuses (CHECKOUT_CONFLICT) rather than overwrite a local change, and a conflict
      // only adds markers to files that were clean. The worktree merge has no undo.
      return { ...await applyStash(git, s.oid, p.index), undo: stashUndo() };
    },
  },
  {
    name: 'stash.pop',
    kind: 'write',
    params: (raw) => applyParams(raw, 'stash.pop'),
    async run(git, p) {
      await assertWorktree(git);
      const s = await resolveStash(git, p.oid);
      await assertCanApply(git, s);
      const { conflicts } = await applyStash(git, s.oid, p.index);
      // As git does: a stash that applied with conflicts is kept.
      if (conflicts.length) return { conflicts, dropped: false, undo: stashUndo() };
      const { stashes, ...drop } = await dropApplied(git, s);
      return { conflicts, ...drop, undo: stashUndo({ stashes }) };
    },
  },
  {
    // One file of a stash into the worktree only, as a patch: atomic, and a file that differs from the stash's base is
    // refused (PATCH_DOES_NOT_APPLY), never overwritten. Never --index or --3way (wiki: gotchas/staging-patches).
    name: 'stash.applyFile',
    kind: 'write',
    params(raw) {
      const p = oidParams(raw, 'stash.applyFile', ['oid', 'path']);
      return { oid: p.oid, path: filePath(p.path) };
    },
    async run(git, p) {
      await assertWorktree(git);
      const s = await resolveStash(git, p.oid);
      const { part, from, to } = await partOf(git, s, p.path);
      const mode = decoder.decode((await git(['ls-tree', '-z', '--full-tree', to, '--', p.path])).stdout).split(' ')[0];
      if (mode === '160000') throw new Refusal('PARTIAL_UNSUPPORTED', `${p.path} is a submodule: apply the whole stash`);
      await assertNotBlocked(git, [p.path]);
      const diff = await git([...DIFF_CONFIG, 'diff', ...DIFF_FLAGS, '--binary', '--end-of-options', from, to, '--', p.path], { maxOutputBytes: DIFF_LIMITS.patchMaxOutputBytes });
      const r = await git(['apply', '--whitespace=nowarn', '--no-ignore-whitespace', '-'], { stdin: diff.stdout, okExit: [0, 1, 128] });
      if (r.exitCode !== 0) {
        const stderr = decoder.decode(r.stderr);
        throw new Refusal('PATCH_DOES_NOT_APPLY', `${p.path} does not apply: ${stderr.trim().split('\n').at(-1) ?? ''}`, { exitCode: r.exitCode, stderr });
      }
      return { oid: s.oid, path: p.path, part, undo: stashUndo({ worktreePatch: diff.stdout.toString('base64') }) };
    },
  },
  {
    // `git stash branch`, step by step: a new branch at the stash's base, switched to, the stash applied with its index,
    // then dropped when that was clean.
    name: 'stash.branch',
    kind: 'write',
    params(raw) {
      const p = oidParams(raw, 'stash.branch', ['oid', 'name', 'ccOwned']);
      return { oid: p.oid, name: shortBranch(p.name), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, p) {
      await assertWorktree(git);
      const s = await resolveStash(git, p.oid);
      const ref = `refs/heads/${p.name}`;
      if ((await git(['rev-parse', '-q', '--verify', ref], { okExit: [0, 1] })).exitCode === 0) throw new Refusal('REF_EXISTS', `branch ${p.name} already exists`);
      const own = await ownHead(git);
      assertCcHeadAck(own, p.ccOwned);
      await assertCanApply(git, s);
      const [base] = s.parents;
      await guardOverwrite(git, ['switch', '--no-guess', '--no-track', '-c', p.name, '--end-of-options', base]);
      const created = { refs: [{ ref, old: null, new: base }], head: { old: { branch: own.branch, oid: own.oid }, new: { branch: ref, oid: base } } };
      let conflicts;
      try {
        ({ conflicts } = await applyStash(git, s.oid, true));
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        // The branch exists and is checked out; the stash is untouched.
        throw new Refusal(e.code, `${p.name} was created, but the stash did not apply: ${e.message}`, { ...e.extra, step: 'apply', ref, undo: stashUndo(created) });
      }
      if (conflicts.length) return { ref, base, conflicts, dropped: false, undo: stashUndo(created) };
      const { stashes, ...drop } = await dropApplied(git, s);
      return { ref, base, conflicts, ...drop, undo: stashUndo({ ...created, stashes }) };
    },
  },
];
