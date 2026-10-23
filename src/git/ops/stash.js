import { Refusal } from '../../refusals.js';
import { DIFF_LIMITS } from '../diff/limits.js';
import { commitOid, DIFF_CONFIG, DIFF_FLAGS, emptyTree } from '../diff/source.js';
import { bad, filePath, FROM_STDIN, nulPaths, optBool, paramsObject, pathList } from '../params.js';
import { parseRecords } from '../parse/graph.js';
import { parseConflictFiles } from '../parse/refs.js';
import { shortBranch } from '../refs/check.js';
import { assertCcHeadAck, ownHead } from '../refs/heads.js';
import { assertNoSymref } from '../refs/resolve.js';
import { undoRecord } from '../refs/undo.js';
import { guardOverwrite } from '../refs/write.js';
import { STAGE_LIMITS } from '../stage/limits.js';
import { perChunk } from '../stage/paths.js';
import { readSelectionPatch, selectionParams } from '../stage/readSelection.js';
import { assertFileTarget, assertNoUnmerged, assertNotBlocked, assertNoUntrackedCollision } from '../stash/guard.js';
import { identEnv } from '../stash/ident.js';
import { STASH_LIMITS } from '../stash/limits.js';
import { branchLabel, checkMessage, reMessage, wMessage } from '../stash/message.js';
import { dropVerified, listStashes, namesOf, resolveStash, stashPaths } from '../stash/resolve.js';
import { assertGitAtLeast } from '../stash/version.js';
import { assertOid } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Stash: save, apply, drop, rename (docs/protocol.md → Stash ops). Every op is a non-cancellable write: an aborted
// stash or apply can leave index.lock, a half-applied merge or a half-restored set of untracked files. A stash is named
// by its full oid (src/git/stash/resolve.js).

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);

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

const CAP = { maxOutputBytes: STASH_LIMITS.pathsMaxOutputBytes };

/**
 * The paths a save takes out of the worktree, for the guard: the named ones and what they expand to (a directory names
 * its changed files, and its untracked ones with includeUntracked), the staged ones, or every changed tracked one (plus
 * every untracked one with includeUntracked).
 */
async function savedPaths(git, p) {
  const untracked = ['ls-files', '--others', '--exclude-standard', '-z'];
  if (p.paths) {
    const changed = await perChunk(git, ['diff-index', '-z', '--name-only', '--no-renames', 'HEAD'], p.paths, CAP);
    return [...p.paths, ...changed, ...(p.includeUntracked ? await perChunk(git, untracked, p.paths, CAP) : [])];
  }
  if (p.staged) return namesOf(git, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--no-relative', '--no-ext-diff', '--no-textconv']);
  const changed = await namesOf(git, ['diff-index', '-z', '--name-only', '--no-renames', 'HEAD']);
  return p.includeUntracked ? [...changed, ...await namesOf(git, untracked)] : changed;
}

/**
 * The stash this save stored, among the entries newer than `before` (refs/stash's oid before the push): the one whose
 * base is `head` and whose subject is the one git writes for this message on this branch. Another session can push
 * to the shared stack at the same moment, so the tip is not assumed to be ours; null when no entry, or more than one,
 * matches.
 */
async function ownNewStash(git, { before, head, branch, message }) {
  const fresh = [];
  const list = await listStashes(git);
  for (const s of list) {
    if (s.oid === before) break;
    fresh.push(s);
  }
  // The pre-push tip is gone (another session dropped it): which entries are new cannot be told.
  if (before !== null && fresh.length === list.length) return null;
  const ours = fresh.filter((s) => s.parents[0] === head && (message ? s.message === `On ${branch}: ${message}` : s.message.startsWith(`WIP on ${branch}: `)));
  return ours.length === 1 ? ours[0] : null;
}

const pushUndo = (s) => undoRecord({ stashes: [{ oid: s.oid, old: null, new: { message: s.message }, restore: 'pop' }] });
const NO_CHANGES_RE = /^No local changes to save$/m;

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
 * With `--index`, git resets the index to HEAD before its merge; when the merge then refuses to start ("Index was not
 * unstashed." and no unmerged entry) the user's staged changes are left unstaged. The index is saved first
 * (`write-tree`, only when something is staged) and read back in that case only. git prints the same line after a
 * conflicted merge, whose index (the unmerged entries and the user's other staging) git kept: that one is never touched.
 */
async function applyStash(git, oid, index) {
  const staged = index && (await git(['diff-index', '--cached', '--quiet', 'HEAD'], { okExit: [0, 1] })).exitCode === 1;
  const saved = staged ? text(await git(['write-tree'])).trim() : null;
  const r = await git(['stash', 'apply', '-q', ...(index ? ['--index'] : []), oid], { okExit: [0, 1] });
  if (r.exitCode === 0) return { conflicts: [] };
  const unmerged = (await namesOf(git, ['ls-files', '-u', '-z'])).map((f) => f.slice(f.indexOf('\t') + 1));
  if (unmerged.length) return { conflicts: [...new Set(unmerged)] };
  const stderr = decoder.decode(r.stderr);
  if (saved && stderr.includes('Index was not unstashed.')) await git(['read-tree', saved]);
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
      const head = await assertBornHead(git);
      await assertNoUnmerged(git);
      if (p.staged) await assertGitAtLeast(git, [2, 35], 'stash push --staged');
      await assertNotBlocked(git, await savedPaths(git, p));
      const mine = { before: await stashTip(git), head, branch: branchLabel(await ownHead(git)), message: p.message };
      // No -q: "No local changes to save" (LC_ALL=C) is how a save that stored nothing is told apart; comparing
      // refs/stash before and after would take another session's push for ours.
      const args = ['stash', 'push'];
      if (p.staged) args.push('--staged');
      if (p.keepIndex) args.push('--keep-index');
      if (p.includeUntracked) args.push('--include-untracked');
      if (p.message) args.push(`--message=${p.message}`);
      // Without paths, git's own `-u` cleanup and `--keep-index` checkout name `:/`, which GIT_LITERAL_PATHSPECS=1 (BASE_ENV)
      // turns into a literal path matching nothing: `-u` would leave the untracked files in place, `--keep-index` fail.
      // `.` (the root: commands run there) is what `:/` means.
      const paths = p.paths ?? (p.includeUntracked || p.keepIndex ? ['.'] : null);
      let r;
      try {
        r = paths ? await git([...args, ...FROM_STDIN], { stdin: nulPaths(paths) }) : await git(args);
      } catch (e) {
        if (e.code !== 'GIT_FAILED') throw e;
        // git can fail after storing the stash (`--staged` with a file staged and then changed again; `--keep-index`,
        // which may also have reset the index). The stash is kept, not dropped: it may be the only copy of what git
        // already took out of the index, so the refusal names it. No undo: the worktree and index may still hold the
        // same changes, and popping the stash would apply them twice.
        const s = await ownNewStash(git, mine);
        if (!s) throw e;
        throw new Refusal('GIT_FAILED', `${e.message} after storing ${s.selector}: the changes are in that stash`, { ...e.extra, oid: s.oid, selector: s.selector });
      }
      // stdout only: git prints the line there, and a reference-transaction hook's output goes to git's stderr.
      if (NO_CHANGES_RE.test(text(r))) throw new Refusal('NOTHING_TO_STASH', 'there are no local changes to stash');
      const s = await ownNewStash(git, mine);
      // Saved, but another session's stash at the same base with the same subject arrived at the same moment: which
      // entry is this save's cannot be told, so no undo claims one.
      if (!s) return { oid: null, selector: null, unverified: true, undo: undoRecord() };
      return { oid: s.oid, selector: s.selector, undo: pushUndo(s) };
    },
  },
  {
    // Selected lines of one file, as `git stash -p` does it: the stash is built on a temporary index (I = HEAD's tree,
    // W = HEAD + the selection), stored, and only then the lines are taken out of the worktree with `apply -R`. Never
    // `apply --index` (wiki: gotchas/staging-patches). The file's index entry must be HEAD's, so the selection read
    // index → worktree is the one HEAD → worktree would give. Two patches from one selection, both built before anything
    // is written: forward (fits HEAD: what stage.stageLines applies) and reverse (fits the worktree, which still has the
    // unselected changes: what stage.discardLines applies).
    name: 'stash.pushLines',
    kind: 'write',
    params(raw) {
      const { message, ...selection } = paramsObject(raw, ['message', 'path', 'context', 'hunks'], 'stash.pushLines');
      return { ...selectionParams(selection, 'stash.pushLines'), message: checkMessage(message) };
    },
    async run(git, p) {
      await assertWorktree(git);
      const head = await assertBornHead(git);
      const staged = await git(['diff', '--cached', '--quiet', '--no-ext-diff', '--no-textconv', '--end-of-options', head, '--', p.path], { okExit: [0, 1] });
      if (staged.exitCode === 1) throw new Refusal('PARTIAL_UNSUPPORTED', `${p.path} has staged changes: stash it whole`);
      await assertNotBlocked(git, [p.path]);
      await assertFileTarget(git, p.path);
      const patch = await readSelectionPatch(git, p, { revs: [], direction: 'forward' });
      const removal = await readSelectionPatch(git, p, { revs: [], direction: 'reverse' });
      const index = text(await git(['rev-parse', '--git-path', 'code-git-stash-index'])).replace(/\n$/, '');
      const tmp = { env: { GIT_INDEX_FILE: index } };
      await git(['read-tree', head], tmp);
      await git(['apply', '--cached', '--whitespace=nowarn', '--no-ignore-whitespace', '-'], { ...tmp, stdin: patch });
      const tree = text(await git(['write-tree'], tmp)).trim();
      const [[short, subject]] = parseRecords(text(await git(['log', '-1', '--no-show-signature', '--format=%h%x00%s', head])), 2);
      const branch = branchLabel(await ownHead(git));
      const env = await identEnv(git);
      const commit = async (args, msg) => text(await git(['commit-tree', '--no-gpg-sign', ...args, '-F', '-'], { stdin: `${msg}\n`, env })).trim();
      const i = await commit(['-p', head, `${head}^{tree}`], `index on ${branch}: ${short} ${subject}`);
      const message = wMessage(branch, p.message, `${short} ${subject}`);
      const w = await commit(['-p', head, '-p', i, tree], message);
      await git(['stash', 'store', `--message=${message}`, w]);
      const undo = undoRecord({ stashes: [{ oid: w, old: null, new: { message }, restore: 'pop' }] });
      try {
        await git(['apply', '-R', '--whitespace=nowarn', '--no-ignore-whitespace', '-'], { stdin: removal });
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        // The stash holds the lines; the worktree still has them too.
        throw new Refusal(e.code, `the lines were stashed but not taken out of ${p.path}: ${e.message}`, { ...e.extra, step: 'removeFromWorktree', oid: w, undo });
      }
      return { oid: w, selector: 'stash@{0}', undo };
    },
  },
  {
    name: 'stash.drop',
    kind: 'write',
    params: (raw) => oidParams(raw, 'stash.drop'),
    async run(git, p) {
      const s = await dropVerified(git, p.oid);
      return { oid: p.oid, undo: undoRecord({ stashes: [{ oid: p.oid, old: { message: s.message }, new: null, restore: 'store' }] }) };
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
        undo: undoRecord({ stashes: [
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
      return { ...await applyStash(git, s.oid, p.index), undo: undoRecord() };
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
      if (conflicts.length) return { conflicts, dropped: false, undo: undoRecord() };
      const { stashes, ...drop } = await dropApplied(git, s);
      return { conflicts, ...drop, undo: undoRecord({ stashes }) };
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
      await assertFileTarget(git, p.path);
      const diff = await git([...DIFF_CONFIG, 'diff', ...DIFF_FLAGS, '--binary', '--end-of-options', from, to, '--', p.path], { maxOutputBytes: DIFF_LIMITS.patchMaxOutputBytes });
      const r = await git(['apply', '--whitespace=nowarn', '--no-ignore-whitespace', '-'], { stdin: diff.stdout, okExit: [0, 1, 128] });
      if (r.exitCode !== 0) {
        const stderr = decoder.decode(r.stderr);
        throw new Refusal('PATCH_DOES_NOT_APPLY', `${p.path} does not apply: ${stderr.trim().split('\n').at(-1) ?? ''}`, { exitCode: r.exitCode, stderr });
      }
      return { oid: s.oid, path: p.path, part, undo: undoRecord({ worktreePatch: diff.stdout.toString('base64') }) };
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
      // A dangling symbolic ref resolves to nothing above, and `switch -c` would create its target under this name.
      await assertNoSymref(git, ref);
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
        throw new Refusal(e.code, `${p.name} was created, but the stash did not apply: ${e.message}`, { ...e.extra, step: 'apply', ref, undo: undoRecord(created) });
      }
      if (conflicts.length) return { ref, base, conflicts, dropped: false, undo: undoRecord(created) };
      const { stashes, ...drop } = await dropApplied(git, s);
      return { ref, base, conflicts, ...drop, undo: undoRecord({ ...created, stashes }) };
    },
  },
];
