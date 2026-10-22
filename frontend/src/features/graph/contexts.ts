import type { Target } from '@/lib/endpoints';
import type { Tab } from '@/state/tabs';
import type { CommitFile, CommitItem, GitWorktree, GraphRow, Ref, RowId, Stash } from './types';

// The graph's context-menu contexts and the ctx each one's actions receive: the public surface later cards register
// actions on (docs/architecture.md → Extension points).

export interface CommitCtx { tab: Tab; commit: CommitItem; refs: Ref[]; selection: RowId[] }
/** Two or more selected rows, top to bottom. */
export interface CommitsCtx { tab: Tab; rows: GraphRow[] }
export interface WipCtx { tab: Tab; checkout: Target; name: string; isOwn: boolean }
/** 'branch' (local or remote: check ref.kind) and 'tag'. */
export interface RefCtx { tab: Tab; ref: Ref }
export interface StashCtx { tab: Tab; stash: Stash }
export interface RemoteCtx { tab: Tab; remote: string }
export interface WorktreeCtx { tab: Tab; worktree: GitWorktree; ccCheckout: Target | null }
export interface FileCtx { tab: Tab; commit: string; parent: string | null; file: CommitFile }
/** A branch chip dropped on another (drag.ts). */
export interface DragRef { name: string; kind: 'local' | 'remote'; short: string; remote: string | null; oid: string | null }
export interface BranchDropCtx { tab: Tab; source: DragRef; target: DragRef }

export const CONTEXT = {
  commit: 'commit', commits: 'commits', wip: 'wip', branch: 'branch', tag: 'tag', stash: 'stash', remote: 'remote',
  worktree: 'worktree', file: 'file', branchDrop: 'branch-drop',
} as const;
