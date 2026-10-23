import { runOp, type Target } from '@/lib/endpoints';
import type { UndoRecord, Unrequested } from '@/features/branches/api';

// The remote ops' wire shapes (docs/protocol.md → Remote ops) and thin runOp wrappers.

/** `displayUrl` (the first url, else push url) and `displayPushUrl`, any password shown as ***: the only urls the UI renders. */
export interface RemoteInfo {
  name: string; urls: string[]; pushUrls: string[]; fetch: string[]; displayUrl: string | null; displayPushUrl: string | null; legacy: boolean;
  /** The raw url / push url list holds several values (an empty reset counts): remote.edit refuses to replace it. */
  multiUrl: boolean; multiPushUrl: boolean;
}
export interface RefMove { ref: string; old: string | null; new: string | null }
export interface FetchedRemote { remote: string; changes: RefMove[]; pruned: string[]; symrefsResolved: { ref: string; target: string }[]; partial: string | null }
export interface FetchError { remote: string; error: { code: string; message: string; reason?: string; stderr: string | null } }
export interface FetchResult { remotes: (FetchedRemote | FetchError)[]; undo: UndoRecord }
export interface PeekResult { oid: string | null; tracking: { ref: string; oid: string } | null; stale: boolean }
export type PullMode = 'ff' | 'ffOnly' | 'rebase';
export type PullOutcome = 'upToDate' | 'fastForward' | 'merged' | 'rebased' | 'conflicts';
export interface PullResult { mode: PullMode; upstream: string; outcome: PullOutcome; files: string[]; oid: string; fetch: FetchedRemote; undo: UndoRecord }
export interface BranchPushResult {
  remote: string; branch: string; to: string; created: boolean; forced: boolean; upToDate: boolean; upstreamSet: boolean; unrequested: Unrequested[]; undo: UndoRecord;
}
/** What a branch push sends; no `remote`: the branch's upstream. */
export interface PushRequest { branch: string; remote?: string; to?: string; setUpstream?: boolean; expect?: string | null; ccOwned?: boolean }

export const isFetchError = (r: FetchedRemote | FetchError): r is FetchError => 'error' in r;

const ack = (ccOwned?: boolean) => (ccOwned ? { ccOwned: true } : {});

export const listRemotes = (t: Target) => runOp<{ remotes: RemoteInfo[] }>('remote.list', t).then((r) => r.remotes);
export const addRemote = (t: Target, name: string, url: string, pushUrl?: string) =>
  runOp<{ name: string; undo: UndoRecord }>('remote.add', t, { name, url, ...(pushUrl ? { pushUrl } : {}) });
/** Only the fields given are sent (an unchanged one is left out); `pushUrl: null` removes the push url. */
export const editRemote = (t: Target, name: string, change: { url?: string; pushUrl?: string | null }) =>
  runOp<{ name: string; undo: UndoRecord }>('remote.edit', t, { name, ...change });
export const renameRemote = (t: Target, name: string, newName: string) => runOp<{ name: string; undo: UndoRecord }>('remote.rename', t, { name, newName });
export const removeRemote = (t: Target, name: string) =>
  runOp<{ name: string; deletedRefs: string[]; clearedUpstreams: { branch: string; merge: string | null }[]; undo: UndoRecord }>('remote.remove', t, { name });
/** `remote` null: every remote. */
export const fetchRemotes = (t: Target, remote: string | null, prune = false) => runOp<FetchResult>('remote.fetch', t, { remote, ...(prune ? { prune: true } : {}) });
export const peekBranch = (t: Target, remote: string, branch: string) => runOp<PeekResult>('remote.peek', t, { remote, branch });
export const pullHead = (t: Target, mode: PullMode, ccOwned?: boolean) => runOp<PullResult>('remote.pull', t, { mode, ...ack(ccOwned) });
export const pushBranch = (t: Target, p: PushRequest) => runOp<BranchPushResult>('remote.push', t, {
  branch: p.branch,
  ...(p.remote ? { remote: p.remote } : {}),
  ...(p.remote && p.to ? { to: p.to } : {}),
  ...(p.setUpstream ? { setUpstream: true } : {}),
  ...(p.expect !== undefined ? { forceWithLease: { expect: p.expect } } : {}),
  ...ack(p.ccOwned),
});
export const abortMerge = (t: Target) => runOp<{ undo: UndoRecord }>('head.abort', t, { which: 'merge' });
