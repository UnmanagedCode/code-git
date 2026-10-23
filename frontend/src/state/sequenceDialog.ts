import { createStore, useStore } from './store';
import type { Tab } from './tabs';

// The one open merge/rebase dialog (features/sequence/SequenceDialogHost.tsx renders it). Opening another replaces it.

/** Rebase the `count` newest commits of HEAD's branch (`upstream..expect`) onto a branch the dialog picks. */
export type SequenceDialog = { kind: 'rebaseOnto'; tab: Tab; count: number; upstream: string; expect: string };

export const sequenceDialogStore = createStore<SequenceDialog | null>(null);
export const openSequenceDialog = (d: SequenceDialog): void => sequenceDialogStore.set(d);
export const closeSequenceDialog = (): void => sequenceDialogStore.set(null);
export const resetSequenceDialog = closeSequenceDialog;
export const useSequenceDialog = (): SequenceDialog | null => useStore(sequenceDialogStore);
