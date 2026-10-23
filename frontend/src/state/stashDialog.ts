import type { Stash } from '@/features/graph/types';
import type { SelectionRequest } from '@/features/workdir/api';
import { createStore, useStore } from './store';
import type { Tab } from './tabs';

// The one open stash dialog (save, rename, create branch), rendered by <StashDialogHost/>.

export type SaveMode = 'all' | 'files' | 'staged';
export type SavePreset = { mode: SaveMode; paths?: string[] } | { mode: 'lines'; request: SelectionRequest; count: number };
export type StashDialog =
  | { kind: 'save'; tab: Tab; preset: SavePreset }
  | { kind: 'rename'; tab: Tab; stash: Stash }
  | { kind: 'branch'; tab: Tab; stash: Stash };

export const stashDialogStore = createStore<StashDialog | null>(null);
export const openStashDialog = (d: StashDialog): void => stashDialogStore.set(d);
export const closeStashDialog = (): void => stashDialogStore.set(null);
export const resetStashDialog = closeStashDialog;
export const useStashDialog = () => useStore(stashDialogStore);
