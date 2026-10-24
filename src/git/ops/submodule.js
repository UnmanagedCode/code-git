import { maskUrl } from '../../mask.js';
import { Refusal } from '../../refusals.js';
import { joinMessage, messageParams } from '../commit/message.js';
import { worktreeEntry } from '../diff/noIndex.js';
import { commitOid } from '../diff/source.js';
import { bad, optBool, paramsObject } from '../params.js';
import { netRun } from '../remote/net.js';
import { operationState } from '../sequence/state.js';
import { submoduleFailure } from '../submodule/failure.js';
import {
  assertDeclaredUrls, assertDefaultRemoteUrl, assertGitmodulesWritable, assertNoRepoProtocolConfig, assertResolvedUrls,
  knownEntries, orphanCount, resolvedUrls,
} from '../submodule/gates.js';
import { SUBMODULE_LIMITS } from '../submodule/limits.js';
import { isTypeChanged, listSubmodules, parseIndexRecord, readGitmodules, urlProblem } from '../submodule/list.js';
import { isRelativeUrl, submoduleUrl } from '../submodule/url.js';
import { submoduleName, submodulePath } from '../submodule/validate.js';
import { assertOid, assertRefName } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Submodules of the op's repo — the checkout, or a submodule named by target.sub (docs/submodules.md). Every write is
// non-cancellable: a killed clone leaves a half-populated `.git/modules/<name>`, a killed deinit or rm a half-removed
// submodule. Paths are relative to the op's repo and always follow `--`.

const decoder = new TextDecoder('utf-8', { fatal: false });
const CLONE = { timeoutMs: SUBMODULE_LIMITS.cloneTimeoutMs, maxOutputBytes: SUBMODULE_LIMITS.cloneMaxOutputBytes, okExit: [0, 1, 128] };

const noParams = (op) => (raw) => {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) throw bad(`${op} takes no params`);
  return {};
};

/** 1…SUBMODULE_LIMITS.maxListed submodulePath entries, duplicates dropped. */
function submodulePaths(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > SUBMODULE_LIMITS.maxListed) throw bad(`paths must list 1…${SUBMODULE_LIMITS.maxListed} submodule paths`);
  return [...new Set(v.map(submodulePath))];
}

/** Runs a clone/update `args` under NET_CONFIG and the clone caps; a failure is submoduleFailure's refusal. */
async function cloneRun(git, args) {
  const r = await netRun(git, args, CLONE);
  if (r.exitCode !== 0) throw submoduleFailure(r, args.slice(0, 2).join(' '));
  return r;
}

/** A plain write whose failure is submoduleFailure's refusal. */
async function run(git, args) {
  const r = await git(args, { okExit: [0, 1, 128] });
  if (r.exitCode !== 0) throw submoduleFailure(r, args.slice(0, 2).join(' '));
  return r;
}

const nulFields = (r) => decoder.decode(r.stdout).split('\0').filter(Boolean);

/** Removes the gitlink a failed removal put back from HEAD — only while the index still holds exactly that entry. */
async function takeBack(git, path, oid) {
  const now = nulFields(await git(['ls-files', '-s', '-z', '--', path])).map(parseIndexRecord);
  if (now.length === 1 && now[0].path === path && now[0].mode === '160000' && now[0].oid === oid && now[0].stage === '0') {
    await git(['update-index', '--force-remove', '--', path]);
  }
}

/** SUBMODULE_DIRTY with the facts the UI lists: what removing the submodule would throw away or stage. */
const dirtyRefusal = (path, e, orphaned, staged, gitmodules) => new Refusal('SUBMODULE_DIRTY', `${path} has work removing it would throw away`, {
  path, modified: e.populated && e.modified, untracked: e.populated && e.untracked, orphaned, staged, gitmodules,
});

/** Refuses SUBMODULE_NOT_RECORDED for entries whose gitlink is not in the index (declared only): git's submodule commands
 * address submodules through the index. A conflicted gitlink is not "not recorded". */
function assertRecorded(entries) {
  const missing = entries.filter((e) => e.recorded === null && !e.conflicted).map((e) => e.path);
  if (missing.length) {
    throw new Refusal('SUBMODULE_NOT_RECORDED', `${missing.join(', ')}: .gitmodules declares it but its gitlink is not in the index — add the submodule again, or remove the declaration`, { paths: missing });
  }
}

/** Refuses SUBMODULE_CONFLICTED for a conflicted gitlink: git skips it ("Skipping unmerged submodule") and exits 0. */
function assertNotConflicted(entries) {
  const conflicted = entries.filter((e) => e.conflicted).map((e) => e.path);
  if (conflicted.length) {
    throw new Refusal('SUBMODULE_CONFLICTED', `${conflicted.join(', ')}: the pointer is in conflict — resolve it (pick a commit and stage it) before updating`, { paths: conflicted });
  }
}

/** Refuses SUBMODULE_COMMITS_AT_RISK `{paths: [{path, count}]}` when updating `entries` would leave commits behind. */
async function assertNoCommitsAtRisk(git, entries) {
  const at = [];
  for (const e of entries.filter((x) => x.populated)) {
    const count = await orphanCount(git, e.path, e.recorded);
    if (count > 0) at.push({ path: e.path, count });
  }
  if (at.length) {
    throw new Refusal('SUBMODULE_COMMITS_AT_RISK', `${at.map((x) => x.path).join(', ')}: the checkout would leave commits on no branch (only the reflog keeps them)`, { paths: at });
  }
}

export const ops = [
  {
    name: 'submodule.list',
    kind: 'read',
    params: noParams('submodule.list'),
    run: (git) => listSubmodules(git),
  },
  {
    name: 'submodule.add',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['url', 'path', 'name', 'branch'], 'submodule.add');
      return {
        url: submoduleUrl(p.url), path: submodulePath(p.path),
        name: p.name === undefined ? null : submoduleName(p.name), branch: p.branch === undefined ? null : assertRefName(p.branch),
      };
    },
    async run(git, p) {
      await assertWorktree(git);
      await assertGitmodulesWritable(git);
      const name = p.name ?? p.path;
      const inIndex = await git(['ls-files', '-s', '-z', '--', p.path]);
      const declared = await readGitmodules(git);
      if (inIndex.stdout.length || declared.some((e) => e.path === p.path || e.name === name)) {
        throw new Refusal('SUBMODULE_EXISTS', `${p.path} or the name ${name} is already in use`, { reason: 'exists', path: p.path, name });
      }
      // git would adopt whatever is there instead of cloning (an existing repository, or the one a `.git` gitfile names).
      if ((await worktreeEntry(git, p.path)).kind !== 'absent') {
        throw new Refusal('SUBMODULE_EXISTS', `${p.path} already exists in the working tree: choose an empty path`, { reason: 'exists', path: p.path, name });
      }
      await assertNoRepoProtocolConfig(git);
      if (isRelativeUrl(p.url)) await assertDefaultRemoteUrl(git);
      const args = ['submodule', 'add', ...(p.name ? ['--name', p.name] : []), ...(p.branch ? ['-b', p.branch] : []), '--', p.url, p.path];
      const r = await netRun(git, args, CLONE);
      if (r.exitCode !== 0) {
        const stderr = decoder.decode(r.stderr);
        if (stderr.includes('A git directory for')) {
          throw new Refusal('SUBMODULE_EXISTS', `a removed submodule named ${name} kept its repository in .git/modules: choose another name`, { reason: 'gitdir', path: p.path, name, stderr });
        }
        throw submoduleFailure(r, 'submodule add');
      }
      return { path: p.path, name };
    },
  },
  {
    name: 'submodule.init',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['paths'], 'submodule.init');
      return { paths: submodulePaths(p.paths) };
    },
    async run(git, p) {
      await assertWorktree(git);
      const entries = await knownEntries(git, p.paths);
      assertRecorded(entries);
      // Config only: no network.
      await run(git, ['submodule', 'init', '--', ...p.paths]);
      const urls = await resolvedUrls(git, entries);
      // A relative url resolves against the default remote's url, its password too: answered masked.
      return { submodules: entries.map((e, i) => ({ path: e.path, resolvedUrl: urls[i].url === null ? null : maskUrl(urls[i].url), urlProblem: urlProblem(urls[i].url) })) };
    },
  },
  {
    name: 'submodule.update',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['paths', 'discardCommits'], 'submodule.update');
      return { paths: submodulePaths(p.paths), discardCommits: optBool(p.discardCommits, 'discardCommits') };
    },
    async run(git, p) {
      await assertWorktree(git);
      const entries = await knownEntries(git, p.paths);
      assertRecorded(entries);
      assertNotConflicted(entries);
      await assertNoRepoProtocolConfig(git);
      // init resolves relative urls into the local config; what git will clone is checked after it.
      await run(git, ['submodule', 'init', '--', ...p.paths]);
      await assertResolvedUrls(git, entries);
      if (!p.discardCommits) await assertNoCommitsAtRisk(git, entries);
      // --checkout overrides a configured submodule.<name>.update (`!command`, rebase, merge), here and under --recursive.
      // Never --force: a checkout over local changes fails (SUBMODULE_DIRTY) and nothing is discarded.
      await cloneRun(git, ['submodule', 'update', '--checkout', '--init', '--recursive', '--', ...p.paths]);
      return { paths: p.paths };
    },
  },
  {
    name: 'submodule.sync',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['paths'], 'submodule.sync');
      return { paths: submodulePaths(p.paths) };
    },
    async run(git, p) {
      await assertWorktree(git);
      const entries = await knownEntries(git, p.paths);
      assertRecorded(entries);
      assertDeclaredUrls(entries, isRelativeUrl);
      await run(git, ['submodule', 'sync', '--recursive', '--', ...p.paths]);
      return { paths: p.paths };
    },
  },
  {
    name: 'submodule.setUrl',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['path', 'url'], 'submodule.setUrl');
      return { path: submodulePath(p.path), url: submoduleUrl(p.url) };
    },
    async run(git, p) {
      await assertWorktree(git);
      await assertGitmodulesWritable(git);
      const [e] = await knownEntries(git, [p.path]);
      await git(['config', '--file', '.gitmodules', `submodule.${e.name}.url`, p.url]);
      if (e.initialized) await run(git, ['submodule', 'sync', '--', p.path]);
      return { path: p.path, url: p.url };
    },
  },
  {
    name: 'submodule.remove',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['path', 'discard'], 'submodule.remove');
      return { path: submodulePath(p.path), discard: optBool(p.discard, 'discard') };
    },
    async run(git, p) {
      await assertWorktree(git);
      await assertGitmodulesWritable(git);
      let [e] = await knownEntries(git, [p.path]);
      // git rm refuses while .gitmodules has unstaged changes: it stages the whole file with the removal.
      const gitmodules = (await git(['diff', '--quiet', '--no-ext-diff', '--', '.gitmodules'], { okExit: [0, 1] })).exitCode === 1;
      const records = nulFields(await git(['ls-files', '-s', '-z', '--', p.path])).map(parseIndexRecord);
      if (isTypeChanged(records, p.path)) {
        throw new Refusal('SUBMODULE_NOT_RECORDED', `${p.path} is staged as something other than a submodule (a file or a directory): unstage that first, then remove it`, { paths: [p.path], reason: 'typechange' });
      }
      // The oid of the gitlink code-git put back from HEAD, taken out again whenever the removal does not complete.
      let restored = null;
      if (!records.length) {
        if (e.committed) {
          // In HEAD, absent from the index at every stage (`git rm --cached`): put the entry back from HEAD, so the
          // removal below runs gated as for any submodule and ends with the same staged deletion.
          restored = e.committed;
          await git(['update-index', '--add', '--cacheinfo', `160000,${restored},${e.path}`]);
          [e] = await knownEntries(git, [p.path]);
        } else if (e.populated) {
          throw new Refusal('SUBMODULE_NOT_RECORDED', `${p.path} is cloned but its gitlink is in neither the index nor HEAD: add it back (git add ${p.path}) or delete its directory, then remove it`, { paths: [p.path] });
        } else {
          // Declared only: its .gitmodules section (and the config init wrote) is all there is.
          if (gitmodules && !p.discard) throw dirtyRefusal(p.path, e, 0, false, gitmodules);
          await git(['config', '-f', '.gitmodules', '--remove-section', `submodule.${e.name}`]);
          if (e.initialized) await git(['config', '--remove-section', `submodule.${e.name}`], { okExit: [0, 128] });
          await git(['add', '--', '.gitmodules']);
          return { path: p.path, name: e.name };
        }
      }
      try {
        if (!p.discard) {
          const orphaned = e.populated ? await orphanCount(git, e.path, e.recorded) : 0;
          // A pointer staged but not committed (an added submodule, a moved one): `git rm` would need -f.
          const staged = e.recorded !== e.committed;
          if ((e.populated && (e.modified || e.untracked)) || orphaned > 0 || staged || gitmodules) throw dirtyRefusal(p.path, e, orphaned, staged, gitmodules);
        }
        const force = p.discard ? ['-f'] : [];
        if (gitmodules) await git(['add', '--', '.gitmodules']);
        if (e.initialized || e.populated) await run(git, ['submodule', 'deinit', ...force, '--', p.path]);
        // Removes the gitlink, the directory and the .gitmodules section, and stages .gitmodules. .git/modules/<name> stays.
        await run(git, ['rm', '-q', ...force, '--', p.path]);
      } catch (err) {
        // The oid captured at the restore: `e` was re-read since, and HEAD may have moved meanwhile.
        if (restored) await takeBack(git, p.path, restored);
        throw err;
      }
      return { path: p.path, name: e.name };
    },
  },
  {
    name: 'submodule.commitPointer',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['path', 'expect', 'summary', 'description'], 'submodule.commitPointer');
      return { path: submodulePath(p.path), expect: assertOid(p.expect), ...messageParams(p) };
    },
    async run(git, p) {
      await assertWorktree(git);
      const [e] = await knownEntries(git, [p.path]);
      if (!e.populated) throw new Refusal('SUBMODULE_NOT_POPULATED', `${p.path} is not cloned`, { path: p.path });
      if (e.head !== p.expect) throw new Refusal('SUBMODULE_POINTER_MOVED', `${p.path} is no longer at the commit shown: check again`, { path: p.path, head: e.head });
      if (p.expect === e.committed) throw new Refusal('NOTHING_TO_COMMIT', `${p.path} already points at its commit`);
      // A temporary-index commit would conclude a stopped merge (or commit in a pick's or rebase's middle) with HEAD's
      // tree: refused while operationState (the one reader of what is in progress) names one. Unmerged entries elsewhere
      // with no operation (a squash merge, a stash apply) are left alone, as git's own `commit --only -- <path>` allows;
      // the pointer's own gitlink in conflict is refused, since setting its index entry would resolve that conflict.
      const { operation } = await operationState(git);
      if (operation) throw new Refusal('OPERATION_IN_PROGRESS', `a ${operation.kind} is in progress: continue or abort it first`, { operation: operation.kind });
      if (e.conflicted) throw new Refusal('SUBMODULE_CONFLICTED', `${p.path}: the pointer is in conflict — resolve it (pick a commit and stage it) first`, { paths: [p.path] });
      // The commit holds exactly `expect`, whatever the submodule's HEAD is by now (`commit --only -- <path>` would re-read
      // it): a temporary index of HEAD's tree with only that gitlink changed, committed (hooks run); then the real
      // index's entry set to it, as --only leaves it. Whatever else is staged stays staged.
      const head = await commitOid(git, 'HEAD');
      const index = decoder.decode((await git(['rev-parse', '--git-path', 'code-git-pointer-index'])).stdout).replace(/\n$/, '');
      const tmp = { env: { GIT_INDEX_FILE: index } };
      const gitlink = ['update-index', '--add', '--cacheinfo', `160000,${p.expect},${p.path}`];
      try {
        await git(head ? ['read-tree', head] : ['read-tree', '--empty'], tmp);
        await git(gitlink, tmp);
        await git(['commit', '-F', '-'], { ...tmp, stdin: joinMessage(p.summary, p.description) });
      } finally {
        // git cannot delete the file (no fs access here: docs/architecture.md → Temporary indexes); emptied, nothing of
        // the tree lingers. A failure to empty it does not hide the op's own outcome.
        await git(['read-tree', '--empty'], { ...tmp, okExit: [0, 128] });
      }
      await git(gitlink);
      const oid = decoder.decode((await git(['rev-parse', '--verify', 'HEAD'])).stdout).trim();
      return { oid };
    },
  },
];
