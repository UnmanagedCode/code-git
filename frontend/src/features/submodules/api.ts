import { runOp, type Target } from '@/lib/endpoints';

// The submodule ops' wire types (docs/protocol.md → Submodule ops). Paths are relative to the target's repo.

export type Blocked = 'name' | 'path' | 'escapes';

export interface SubmoduleEntry {
  name: string;
  path: string;
  /** As .gitmodules declares it (relative urls unresolved). */
  url: string | null;
  /** What `submodule init` resolved into the repo's config; null when not initialized. */
  resolvedUrl: string | null;
  branch: string | null;
  initialized: boolean;
  populated: boolean;
  /** The gitlink in the index, in HEAD, and the submodule's own HEAD. */
  recorded: string | null;
  committed: string | null;
  head: string | null;
  outOfSync: boolean;
  modified: boolean;
  untracked: boolean;
  added: boolean;
  conflicted: boolean;
  /** The index holds a file or a directory where HEAD has the gitlink: Remove is refused until that is unstaged. */
  typeChanged: boolean;
  /** Not acted on: an unsafe name or path, or a directory resolving outside the checkout. */
  blocked: Blocked | null;
  /** Why the url git would clone is refused, or null. */
  urlProblem: string | null;
}

export interface SubmoduleList { submodules: SubmoduleEntry[]; truncated: boolean }
export interface InitResult { submodules: { path: string; resolvedUrl: string | null; urlProblem: string | null }[] }
export interface AddParams { url: string; path: string; name?: string; branch?: string }

export const listSubmodules = (t: Target, signal?: AbortSignal) => runOp<SubmoduleList>('submodule.list', t, undefined, { signal });
export const addSubmodule = (t: Target, p: AddParams) => runOp<{ path: string; name: string }>('submodule.add', t, p);
export const initSubmodules = (t: Target, paths: string[]) => runOp<InitResult>('submodule.init', t, { paths });
export const updateSubmodules = (t: Target, paths: string[], discardCommits?: boolean) =>
  runOp<{ paths: string[] }>('submodule.update', t, { paths, ...(discardCommits ? { discardCommits: true } : {}) });
export const syncSubmodules = (t: Target, paths: string[]) => runOp<{ paths: string[] }>('submodule.sync', t, { paths });
export const setSubmoduleUrl = (t: Target, path: string, url: string) => runOp<{ path: string; url: string }>('submodule.setUrl', t, { path, url });
export const removeSubmodule = (t: Target, path: string, discard?: boolean) =>
  runOp<{ path: string; name: string }>('submodule.remove', t, { path, ...(discard ? { discard: true } : {}) });
export const commitPointer = (t: Target, p: { path: string; expect: string; summary: string; description?: string }) =>
  runOp<{ oid: string }>('submodule.commitPointer', t, p);
