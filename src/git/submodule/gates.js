import { Refusal } from '../../refusals.js';
import { worktreeEntry } from '../diff/noIndex.js';
import { OID_RE } from '../validate.js';
import { remoteUrl } from '../remote/url.js';
import { entryAt, listSubmodules, parseSubmoduleConfig } from './list.js';

// What a submodule write checks before git runs: the entries it names, the repo's own config, the urls git would clone
// and the commits a checkout would leave behind. Each refuses with the facts the UI shows.

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);

/** The listed, unblocked entries at `paths`, in order: SUBMODULE_UNKNOWN for a path no entry declares, SUBMODULE_UNSAFE for a blocked one. */
export async function knownEntries(git, paths) {
  const list = await listSubmodules(git);
  return paths.map((p) => {
    const e = entryAt(list, p);
    if (!e) throw new Refusal('SUBMODULE_UNKNOWN', `${p} is not a submodule of this repository`, { path: p });
    if (e.blocked) throw new Refusal('SUBMODULE_UNSAFE', `${p} is not acted on: ${BLOCKED[e.blocked]}`, { reason: e.blocked, path: p });
    return e;
  });
}

const BLOCKED = {
  name: 'its name in .gitmodules is not a safe name',
  path: 'its path in .gitmodules is not a safe path',
  duplicate: '.gitmodules declares its name at another path, or its path under another name',
  escapes: 'its directory resolves outside the checkout (a symbolic link)',
};

/**
 * Refuses SUBMODULE_UNSAFE `{reason: 'config', keys}` when the repository's own config (scope local or worktree) sets any
 * `protocol.*` key: a repo could allow a transport the System did not. The System's global and system config are its user's.
 */
export async function assertNoRepoProtocolConfig(git) {
  const r = await git(['config', '--show-scope', '-z', '--get-regexp', '^protocol\\.'], { okExit: [0, 1] });
  const f = text(r).split('\0');
  const keys = [];
  for (let i = 0; i + 1 < f.length; i += 2) {
    if (f[i] === 'local' || f[i] === 'worktree') keys.push(f[i + 1].split('\n', 1)[0]);
  }
  if (keys.length) {
    throw new Refusal('SUBMODULE_UNSAFE', `the repository's own config sets ${keys.join(', ')}: code-git does not clone under a repository's transport policy`, { reason: 'config', keys });
  }
}

/** Refuses SUBMODULE_UNSAFE `{reason: 'url', names}` unless every url passes remoteUrl. `urls`: [{name, url}]. */
function assertUrls(urls) {
  const names = urls.filter(({ url }) => {
    try { remoteUrl(url ?? ''); return false; } catch { return true; }
  }).map(({ name }) => name);
  if (names.length) {
    throw new Refusal('SUBMODULE_UNSAFE', `the url of ${names.join(', ')} is not one code-git clones from (a <transport>:: helper, an option, or an unknown shape)`, { reason: 'url', names });
  }
}

/** The urls git resolved into the repo's local config for `entries`: [{name, url | null}]. */
export async function resolvedUrls(git, entries) {
  const r = await git(['config', '--local', '-z', '--get-regexp', '^submodule\\..*\\.url$'], { okExit: [0, 1] });
  const by = new Map(r.exitCode === 0 ? parseSubmoduleConfig(text(r)).map((x) => [x.name, x.value]) : []);
  return entries.map((e) => ({ name: e.name, url: by.get(e.name) ?? null }));
}

/** Every resolved url of `entries` passes remoteUrl (after `submodule init`), else SUBMODULE_UNSAFE `{reason: 'url'}`. */
export async function assertResolvedUrls(git, entries) {
  assertUrls(await resolvedUrls(git, entries));
}

/** Every `.gitmodules` url of `entries` that is not relative passes remoteUrl, else SUBMODULE_UNSAFE `{reason: 'url'}`. */
export const assertDeclaredUrls = (entries, isRelative) => assertUrls(entries.filter((e) => !isRelative(e.url ?? '')).map((e) => ({ name: e.name, url: e.url })));

/**
 * The url git resolves a relative submodule url against — the current branch's remote, else `origin`, as git expands it
 * (`ls-remote --get-url` applies insteadOf, no network) — passes remoteUrl, else SUBMODULE_UNSAFE `{reason: 'url'}`.
 */
export async function assertDefaultRemoteUrl(git) {
  const branch = await git(['symbolic-ref', '-q', '--short', 'HEAD'], { okExit: [0, 1] });
  let remote = 'origin';
  if (branch.exitCode === 0) {
    const r = await git(['config', '--get', `branch.${text(branch).replace(/\n$/, '')}.remote`], { okExit: [0, 1] });
    if (r.exitCode === 0) remote = text(r).replace(/\n$/, '');
  }
  const refuse = () => new Refusal('SUBMODULE_UNSAFE', `a relative url resolves against the remote ${JSON.stringify(remote)}, whose url is missing or not one code-git clones from`, { reason: 'url', names: [remote] });
  if (remote.startsWith('-') || remote === '') throw refuse();
  const url = text(await git(['ls-remote', '--get-url', remote])).replace(/\n$/, '');
  // An unknown remote expands to its own name.
  if (url === remote) throw refuse();
  try { remoteUrl(url); } catch { throw refuse(); }
}

/**
 * Commits reachable from a populated submodule's detached HEAD and from no branch, tag, remote branch or `keep` (the
 * pointer the checkout moves to): a checkout would leave them only in the reflog. 0 when HEAD is on a branch.
 */
export async function orphanCount(git, path, keep) {
  const sub = ['-C', path, '--git-dir=.git'];
  if ((await git([...sub, 'symbolic-ref', '-q', 'HEAD'], { okExit: [0, 1] })).exitCode === 0) return 0;
  const count = (extra) => git([...sub, 'rev-list', '--count', 'HEAD', '--not', '--branches', '--tags', '--remotes', '--end-of-options', ...extra, '--'], { okExit: [0, 128] });
  let r = keep && OID_RE.test(keep) ? await count([keep]) : null;
  // `keep` not in the submodule's objects yet (a pointer to fetch): count without it.
  if (!r || r.exitCode !== 0) r = await count([]);
  return r.exitCode === 0 ? Number(text(r).trim()) : 0;
}

/** Refuses SUBMODULE_UNSAFE `{reason: 'gitmodules'}` when `.gitmodules` is a symbolic link: git writes through it. */
export async function assertGitmodulesWritable(git) {
  if ((await worktreeEntry(git, '.gitmodules')).kind === 'symlink') {
    throw new Refusal('SUBMODULE_UNSAFE', '.gitmodules is a symbolic link: git would write through it', { reason: 'gitmodules' });
  }
}

/** The pseudo-ref each stopped operation leaves. */
const STOPPED = [['merge', 'MERGE_HEAD'], ['cherry-pick', 'CHERRY_PICK_HEAD'], ['revert', 'REVERT_HEAD']];

/**
 * Refuses OPERATION_IN_PROGRESS `{operation}` while the repo has a merge, cherry-pick or revert stopped (its pseudo-ref)
 * or a rebase going (`rebase-merge` / `rebase-apply` under the git dir, resolved with `rev-parse --git-path`): a commit
 * made now would conclude it, or be made in its middle.
 */
export async function assertNoOperationInProgress(git) {
  for (const [operation, ref] of STOPPED) {
    if ((await git(['rev-parse', '-q', '--verify', ref], { okExit: [0, 1] })).exitCode === 0) throw inProgress(operation);
  }
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    const at = text(await git(['rev-parse', '--git-path', dir])).replace(/\n$/, '');
    if ((await worktreeEntry(git, at)).kind !== 'absent') throw inProgress('rebase');
  }
}

const inProgress = (operation) => new Refusal('OPERATION_IN_PROGRESS', `a ${operation} is in progress in this repository: finish or abort it first`, { operation });
