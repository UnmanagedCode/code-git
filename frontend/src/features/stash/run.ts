import { conflictToast, fileList } from '@/features/branches/run';
import type { ApiError } from '@/lib/api';
import { trackOp, type ToastText, type Tracked } from '@/lib/opToast';
import { refreshGraph } from '@/state/graph';
import type { Tab } from '@/state/tabs';
import { refreshAfterWrite } from '@/state/workdir';

// Every stash op from the UI runs through runStashOp: its toast (CHECKOUT_CONFLICT worded as the ref ops word it), then
// the Changes lists, the header summary, an open unstaged/staged diff and the graph refreshed whatever the outcome.

export interface StashOpLabels<T> {
  running: string;
  done: (result: T) => string | ToastText | null;
  failed?: (error: ApiError) => Partial<ToastText> | undefined;
  /** false: the caller (a dialog) shows the running state and the error; only success is toasted. */
  toastRunning?: boolean;
}

export async function runStashOp<T>(tab: Tab, labels: StashOpLabels<T>, fn: () => Promise<T>): Promise<Tracked<T>> {
  const r = await trackOp(fn, {
    running: labels.running, done: labels.done, toastRunning: labels.toastRunning,
    failed: (e) => ({ ...conflictToast(e), ...labels.failed?.(e) }),
  });
  await Promise.all([refreshAfterWrite(tab), refreshGraph(tab, 'write')]);
  return r;
}

/** The outcome of an apply that may have stopped on conflicts: a warning naming them, `kept` added for pop and branch. */
export function appliedToast(done: string, label: string, conflicts: string[], kept: boolean): string | ToastText {
  if (!conflicts.length) return done;
  return {
    tone: 'warning',
    title: `Applied ${label} with conflicts in ${conflicts.length} ${conflicts.length === 1 ? 'file' : 'files'}`,
    description: `${fileList(conflicts)}.${kept ? ' The stash was kept.' : ''} Resolve the conflicts in the Changes panel.`,
  };
}
