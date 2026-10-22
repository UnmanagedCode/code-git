import { runOp, type Target } from '@/lib/endpoints';

// The branch, tag and HEAD ops' wire shapes (docs/protocol.md → Branch, tag and HEAD ops) and thin runOp wrappers.

/** Mirrors the backend's REF_LIMITS.namesMax (src/git/refs/limits.js); a test pins them equal. */
export const NAMES_MAX = 100;

export interface RefChange { ref: string; old: string | null; new: string | null; upstream?: string | null }
export interface RemoteRefChange { remote: string; ref: string; old: string | null; new: string | null }
export interface HeadState { branch: string | null; oid: string | null }
/** What an op created, moved or deleted (docs/refs.md → Undo record). */
export interface UndoRecord {
  refs: RefChange[];
  remoteRefs: RemoteRefChange[];
  head: { old: HeadState; new: HeadState } | null;
  worktreeSnapshot: string | null;
}
export interface Rejected { ref: string; reason: string }

export interface Tracking { upstream: string | null; ahead: number; behind: number; gone: boolean }
export interface TrackingResult { remotes: string[]; branches: Record<string, Tracking> }
export interface CreateResult { ref: string; oid: string; checkedOut: boolean; undo: UndoRecord }
export interface CheckoutResult { branch: string; created: boolean; localExisted: boolean; fastForwarded: boolean; ffBlocked: string[] | null; undo: UndoRecord }
export interface DeleteResult { deleted: string[]; notMerged: string[]; undo: UndoRecord }
export interface RemoteDeleteResult { deleted: string[]; rejected: Rejected[]; undo: UndoRecord }
export interface PushResult { pushed: string[]; upToDate: string[]; rejected: Rejected[]; undo: UndoRecord }
export interface ApplyResult { conflicts: boolean; files: string[]; oid: string | null; undo: UndoRecord }
export type ResetMode = 'soft' | 'mixed' | 'hard';

/** `ccOwned: true` only when the user confirmed a code-conductor/* warning; otherwise the key is not sent. */
const ack = (ccOwned?: boolean) => (ccOwned ? { ccOwned: true } : {});

export const loadTracking = (t: Target) => runOp<TrackingResult>('branch.tracking', t);
export const createBranch = (t: Target, p: { name: string; from?: string; checkout: boolean; ccOwned?: boolean }) =>
  runOp<CreateResult>('branch.create', t, { name: p.name, ...(p.from ? { from: p.from } : {}), checkout: p.checkout, ...ack(p.ccOwned) });
export const checkoutBranch = (t: Target, ref: string, ccOwned?: boolean) => runOp<CheckoutResult>('branch.checkout', t, { ref, ...ack(ccOwned) });
export const renameBranch = (t: Target, name: string, newName: string, ccOwned?: boolean) =>
  runOp<{ ref: string; undo: UndoRecord }>('branch.rename', t, { name, newName, ...ack(ccOwned) });
export const deleteBranches = (t: Target, names: string[], force: boolean, ccOwned?: boolean) =>
  runOp<DeleteResult>('branch.delete', t, { names, ...(force ? { force: true } : {}), ...ack(ccOwned) });
export const deleteRemoteBranches = (t: Target, remote: string, branches: string[], ccOwned?: boolean) =>
  runOp<RemoteDeleteResult>('branch.deleteRemote', t, { remote, branches, ...ack(ccOwned) });
export const setUpstream = (t: Target, name: string, upstream: string | null) =>
  runOp<{ name: string; upstream: string | null; previous: string | null }>('branch.setUpstream', t, { name, upstream });
export const fastForward = (t: Target, name: string, to: string, expect: string) =>
  runOp<{ upToDate: boolean; undo: UndoRecord }>('branch.fastForward', t, { name, to, expect });
export const moveBranch = (t: Target, name: string, to: string, expect: string, ccOwned?: boolean) =>
  runOp<{ undo: UndoRecord }>('branch.move', t, { name, to, expect, ...ack(ccOwned) });
export const createTag = (t: Target, name: string, oid: string, message: string) =>
  runOp<{ ref: string; oid: string; undo: UndoRecord }>('tag.create', t, { name, oid, ...(message.trim() ? { message } : {}) });
export const deleteTags = (t: Target, names: string[]) => runOp<{ deleted: string[]; undo: UndoRecord }>('tag.delete', t, { names });
export const pushTags = (t: Target, remote: string, names: string[]) => runOp<PushResult>('tag.push', t, { remote, names });
export const deleteRemoteTags = (t: Target, remote: string, names: string[]) => runOp<RemoteDeleteResult>('tag.deleteRemote', t, { remote, names });
export const resetHead = (t: Target, p: { to: string; mode: ResetMode; expect: string; ccOwned?: boolean }) =>
  runOp<{ undo: UndoRecord }>('head.reset', t, { to: p.to, mode: p.mode, expect: p.expect, ...ack(p.ccOwned) });
export const revertCommit = (t: Target, oid: string, mainline?: number) => runOp<ApplyResult>('head.revert', t, { oid, ...(mainline ? { mainline } : {}) });
export const cherryPick = (t: Target, oid: string, mainline?: number) => runOp<ApplyResult>('head.cherryPick', t, { oid, ...(mainline ? { mainline } : {}) });
export const abortApply = (t: Target, which: 'revert' | 'cherry-pick') => runOp<{ undo: UndoRecord }>('head.abort', t, { which });
