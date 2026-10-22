import type { Ref } from '@/features/graph/types';
import type { ResetMode } from '@/features/branches/api';
import { createStore, useStore } from './store';
import type { Tab } from './tabs';

// The one pending branch/tag dialog (features/branches/RefDialogHost.tsx renders it). Opening another replaces it.

/** A commit a dialog acts on, with how the user sees it ("feature/a", "3f2a91c"). */
export interface Point { oid: string; label: string }

export type RefDialog =
  | { kind: 'createBranch'; tab: Tab; from: Point | null }
  | { kind: 'renameBranch'; tab: Tab; name: string }
  | { kind: 'deleteBranches'; tab: Tab; refs: Ref[] }
  | { kind: 'createTag'; tab: Tab; at: Point }
  | { kind: 'deleteTags'; tab: Tab; names: string[]; remote: string | null }
  | { kind: 'setUpstream'; tab: Tab; branch: string }
  /** Every mode the user confirms (hard); `branch`: HEAD's branch (short) or null when detached; `expect`: HEAD now. */
  | { kind: 'reset'; tab: Tab; to: Point; mode: ResetMode; branch: string | null; expect: string }
  /** Moving a code-conductor/* HEAD by an action that has no dialog of its own; `run` gets the acknowledgement. */
  | { kind: 'ccHeadMove'; tab: Tab; branch: string; action: 'checkout' | 'reset'; label: string; run: (ccOwned: true) => Promise<unknown> }
  /** Force-move a branch that is not checked out. */
  | { kind: 'moveBranch'; tab: Tab; name: string; from: string; to: Point };

export const refDialogStore = createStore<RefDialog | null>(null);
export const openRefDialog = (d: RefDialog): void => refDialogStore.set(d);
export const closeRefDialog = (): void => refDialogStore.set(null);
export const resetRefDialog = closeRefDialog;
export const useRefDialog = (): RefDialog | null => useStore(refDialogStore);
