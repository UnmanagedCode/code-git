import { createStore, useStore } from './store';
import type { Tab } from './tabs';

// The one open remote dialog (add, edit, push), rendered by features/remotes/RemotesHost.tsx.

export type RemoteDialog =
  | { kind: 'add'; tab: Tab }
  | { kind: 'edit'; tab: Tab; remote: string }
  /** Push `branch` (short) to a remote the user picks (`remote`: preselected), under a name they may change. */
  | { kind: 'push'; tab: Tab; branch: string; remote: string | null };

export const remoteDialogStore = createStore<RemoteDialog | null>(null);
export const openRemoteDialog = (d: RemoteDialog): void => remoteDialogStore.set(d);
export const closeRemoteDialog = (): void => remoteDialogStore.set(null);
export const resetRemoteDialog = closeRemoteDialog;
export const useRemoteDialog = (): RemoteDialog | null => useStore(remoteDialogStore);
