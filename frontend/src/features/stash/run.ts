import type { ApiError } from '@/lib/api';
import { refreshGraph } from '@/state/graph';
import type { Tab } from '@/state/tabs';
import { refreshAfterWrite } from '@/state/workdir';
import { trackOp, type ToastText, type Tracked } from './toast';

// Every stash op from the UI runs through runStashOp: its toast, then the Changes lists, the header summary, an open
// unstaged/staged diff and the graph refreshed whatever the outcome.

/** Files named in a toast; the rest is counted. */
export const FILES_SHOWN = 5;

/** "a.txt, b.txt and 3 more" */
export function fileList(files: string[], max = FILES_SHOWN): string {
  const shown = files.slice(0, max).join(', ');
  return files.length > max ? `${shown} and ${files.length - max} more` : shown;
}

/** The toast for local changes in the way (CHECKOUT_CONFLICT), C5's wording. */
export function conflictToast(e: ApiError): Partial<ToastText> | undefined {
  if (e.code !== 'CHECKOUT_CONFLICT') return undefined;
  const files = (e.body as { files?: unknown } | undefined)?.files;
  const list = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : [];
  return {
    title: 'Local changes would be overwritten',
    description: `${list.length ? `${fileList(list)}. ` : ''}Commit, stash or discard these changes first.`,
  };
}

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
