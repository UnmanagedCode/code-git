import { createStore, useStore } from '@/state/store';

// One confirmation at a time, rendered by <ConfirmHost/> (features/workdir/ConfirmDialog.tsx). Destructive actions ask
// through confirm() and send nothing until it resolves true.

export interface ConfirmOptions {
  title: string;
  body: string;
  /** Listed by name (as text), e.g. the untracked files a discard deletes. */
  items?: string[];
  /** Shown as "N files" beside the items. */
  count?: number;
  /** Adds "This cannot be undone." */
  irreversible?: boolean;
  /** Lines shown in a monospace block, e.g. the lines a discard removes. */
  preview?: string[];
  confirmLabel: string;
}

interface Pending { opts: ConfirmOptions; resolve: (ok: boolean) => void }

export const confirmStore = createStore<Pending | null>(null);

/** Asks the user; resolves true on Confirm, false on Cancel, Esc, or when another confirmation replaces it. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  confirmStore.get()?.resolve(false);
  return new Promise((resolve) => confirmStore.set({ opts, resolve }));
}

export function settleConfirm(ok: boolean): void {
  const p = confirmStore.get();
  if (!p) return;
  confirmStore.set(null);
  p.resolve(ok);
}

export const resetConfirm = (): void => settleConfirm(false);
export const usePendingConfirm = () => useStore(confirmStore);
