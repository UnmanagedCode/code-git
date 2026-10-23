import { Refusal } from '../../refusals.js';
import { joinMessage, messageParams } from '../commit/message.js';
import { bad, optBool, paramsObject } from '../params.js';
import { netRun } from '../submodule/copied/net.js';
import { submoduleFailure } from '../submodule/failure.js';
import {
  assertDeclaredUrls, assertDefaultRemoteUrl, assertGitmodulesWritable, assertNoRepoProtocolConfig, assertResolvedUrls,
  knownEntries, orphanCount, resolvedUrls,
} from '../submodule/gates.js';
import { SUBMODULE_LIMITS } from '../submodule/limits.js';
import { listSubmodules, readGitmodules, urlProblem } from '../submodule/list.js';
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
      // Config only: no network.
      await run(git, ['submodule', 'init', '--', ...p.paths]);
      const urls = await resolvedUrls(git, entries);
      return { submodules: entries.map((e, i) => ({ path: e.path, resolvedUrl: urls[i].url, urlProblem: urlProblem(urls[i].url) })) };
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
      const [e] = await knownEntries(git, [p.path]);
      if (!p.discard) {
        const orphaned = e.populated ? await orphanCount(git, e.path, e.recorded) : 0;
        // A pointer staged but not committed (an added submodule, a moved one): `git rm` would need -f.
        const staged = e.recorded !== e.committed;
        if ((e.populated && (e.modified || e.untracked)) || orphaned > 0 || staged) {
          throw new Refusal('SUBMODULE_DIRTY', `${p.path} has work removing it would throw away`, {
            path: p.path, modified: e.populated && e.modified, untracked: e.populated && e.untracked, orphaned, staged,
          });
        }
      }
      const force = p.discard ? ['-f'] : [];
      if (e.initialized || e.populated) await run(git, ['submodule', 'deinit', ...force, '--', p.path]);
      // Removes the gitlink, the directory and the .gitmodules section, and stages .gitmodules. .git/modules/<name> stays.
      await run(git, ['rm', '-q', ...force, '--', p.path]);
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
      if (e.head === e.committed) throw new Refusal('NOTHING_TO_COMMIT', `${p.path} already points at its commit`);
      // --only: the gitlink alone is committed; whatever else is staged stays staged.
      await git(['commit', '--only', '-F', '-', '--', p.path], { stdin: joinMessage(p.summary, p.description) });
      const oid = decoder.decode((await git(['rev-parse', '--verify', 'HEAD'])).stdout).trim();
      return { oid };
    },
  },
];
