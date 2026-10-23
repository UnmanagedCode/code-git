import type { SelectionRequest } from '@/features/workdir/api';
import { runOp, type Target } from '@/lib/endpoints';

// The stash ops' wire shapes (docs/protocol.md → Stash ops) and runOp wrappers. A stash is always sent as its full oid.

export interface StashUndoEntry { oid: string; old: { message: string } | null; new: { message: string } | null; restore: 'store' | 'pop' | 'drop' }
export interface StashUndo {
  refs: { ref: string; old: string | null; new: string | null }[];
  remoteRefs: unknown[];
  head: { old: { branch: string | null; oid: string | null }; new: { branch: string | null; oid: string | null } } | null;
  worktreeSnapshot: string | null;
  stashes: StashUndoEntry[];
  worktreePatch: string | null;
}
export interface PushParams { message?: string; paths?: string[]; includeUntracked?: boolean; keepIndex?: boolean; staged?: boolean }
export interface PushResult { oid: string; selector: string; undo: StashUndo }
export interface ApplyResult { conflicts: string[]; undo: StashUndo }
export interface PopResult extends ApplyResult { dropped: boolean; dropError?: 'STASH_MOVED' }
export interface BranchResult { ref: string; base: string; conflicts: string[]; dropped: boolean; dropError?: 'STASH_MOVED'; undo: StashUndo }

export const stashPush = (t: Target, p: PushParams) => runOp<PushResult>('stash.push', t, p);
export const stashPushLines = (t: Target, r: SelectionRequest & { message?: string }) => runOp<PushResult>('stash.pushLines', t, r);
export const stashApply = (t: Target, oid: string, index = false) => runOp<ApplyResult>('stash.apply', t, { oid, ...(index ? { index: true } : {}) });
export const stashPop = (t: Target, oid: string) => runOp<PopResult>('stash.pop', t, { oid });
export const stashApplyFile = (t: Target, oid: string, path: string) =>
  runOp<{ oid: string; path: string; part: 'tracked' | 'untracked'; undo: StashUndo }>('stash.applyFile', t, { oid, path });
export const stashDrop = (t: Target, oid: string) => runOp<{ oid: string; undo: StashUndo }>('stash.drop', t, { oid });
export const stashRename = (t: Target, oid: string, message: string) => runOp<{ oid: string; previous: string; undo: StashUndo }>('stash.rename', t, { oid, message });
export const stashBranch = (t: Target, oid: string, name: string, ccOwned?: true) =>
  runOp<BranchResult>('stash.branch', t, { oid, name, ...(ccOwned ? { ccOwned } : {}) });
