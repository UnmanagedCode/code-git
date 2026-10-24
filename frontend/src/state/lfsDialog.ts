import { createStore, useStore } from './store';
import type { Tab } from './tabs';

// The LFS dialog, rendered by <LfsHost/>: its main view, or Prune's confirmation step (a kind of its own, so the step
// replaces the view instead of opening a second modal). `listed`: the user listed the files in this dialog session, so
// the list is read again after each LFS op (listing may write: docs/lfs.md).

export type LfsDialog = { kind: 'main' | 'prune'; tab: Tab; listed: boolean };

export const lfsDialogStore = createStore<LfsDialog | null>(null);
export const openLfsDialog = (tab: Tab): void => lfsDialogStore.set({ kind: 'main', tab, listed: false });
export const setLfsDialog = (d: LfsDialog): void => lfsDialogStore.set(d);
export const closeLfsDialog = (): void => lfsDialogStore.set(null);
export const resetLfsDialog = closeLfsDialog;
export const useLfsDialog = () => useStore(lfsDialogStore);
