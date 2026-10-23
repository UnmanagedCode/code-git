import type { SubmoduleEntry } from '@/features/submodules/api';
import { createStore, useStore } from './store';
import type { Tab } from './tabs';

// The one open submodule dialog (add, edit url, commit a moved pointer), rendered by <SubmoduleDialogHost/>. `tab` is the
// repo the dialog acts on: for the pointer, the parent of the submodule tab that closed.

export type SubmoduleDialog =
  | { kind: 'add'; tab: Tab }
  | { kind: 'editUrl'; tab: Tab; entry: SubmoduleEntry }
  | { kind: 'pointer'; tab: Tab; entry: SubmoduleEntry };

export const submoduleDialogStore = createStore<SubmoduleDialog | null>(null);
export const openSubmoduleDialog = (d: SubmoduleDialog): void => submoduleDialogStore.set(d);
export const closeSubmoduleDialog = (): void => submoduleDialogStore.set(null);
export const resetSubmoduleDialog = closeSubmoduleDialog;
export const useSubmoduleDialog = () => useStore(submoduleDialogStore);
