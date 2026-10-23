import type { UndoRecord } from '@/features/branches/api';
import { runOp, type Target } from '@/lib/endpoints';

// The merge, rebase and conflict ops' wire shapes (docs/protocol.md → Merge, rebase and conflict ops) and thin runOp
// wrappers. commit.state's `operation` and `conflicts` are typed here; state/workdir.ts reads them.

export type OperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert';
export type SkippableKind = Exclude<OperationKind, 'merge'>;
export interface Incoming { oid: string; subject: string }
export interface RebaseProgress { branch: string | null; onto: string | null; step: number | null; total: number | null }
/** What is in progress in a checkout (commit.state). */
export interface Operation { kind: OperationKind; incoming: Incoming | null; rebase: RebaseProgress | null }
export interface Side { mode: string; oid: string }
export type ConflictKind = 'bothModified' | 'bothAdded' | 'deletedByThem' | 'deletedByUs' | 'addedByUs' | 'addedByThem' | 'bothDeleted';
/** An unmerged path and its stages: base 1, ours ("Current") 2, theirs ("Incoming") 3. */
export interface Conflict { path: string; kind: ConflictKind; base: Side | null; ours: Side | null; theirs: Side | null }

export type ResumeOutcome = 'done' | 'conflicts' | 'stopped';
export interface ResumeResult { outcome: ResumeOutcome; files: string[]; oid: string | null; undo: UndoRecord }

export const continueOp = (t: Target, which: OperationKind) => runOp<ResumeResult>('head.continue', t, { which });
export const skipOp = (t: Target, which: SkippableKind) => runOp<ResumeResult>('head.skip', t, { which });
export const abortOp = (t: Target, which: OperationKind) => runOp<{ undo: UndoRecord }>('head.abort', t, { which });

export type MergeMode = 'ff' | 'noFf' | 'squash';
export type MergeOutcome = 'upToDate' | 'fastForward' | 'merged' | 'squashed' | 'conflicts';
/** `message`: a squash's prepared message (SQUASH_MSG), null otherwise. */
export interface MergeResult { outcome: MergeOutcome; files: string[]; oid: string; message: string | null; undo: UndoRecord }
export type RebaseOutcome = 'done' | 'upToDate' | 'conflicts' | 'stopped';
export interface RebaseResult { outcome: RebaseOutcome; files: string[]; oid: string | null; undo: UndoRecord }

/** `ccOwned: true` only when the user confirmed the code-conductor/* warning; otherwise the key is not sent. */
const ack = (ccOwned?: boolean) => (ccOwned ? { ccOwned: true } : {});

/** `ref`: the full refname the user picked (it names the merge commit), null for a bare commit. */
export const mergeStart = (t: Target, p: { ref: string | null; oid: string; mode: MergeMode; expect: string }) =>
  runOp<MergeResult>('merge.start', t, { ref: p.ref, oid: p.oid, mode: p.mode, expect: p.expect });
/** Replays `upstream..HEAD` onto `onto`. */
export const rebaseStart = (t: Target, p: { onto: string; upstream: string; expect: string; ccOwned?: boolean }) =>
  runOp<RebaseResult>('rebase.start', t, { onto: p.onto, upstream: p.upstream, expect: p.expect, ...ack(p.ccOwned) });
