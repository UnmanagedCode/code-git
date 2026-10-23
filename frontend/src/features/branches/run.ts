import type { ApiError } from '@/lib/api';
import { trackOp, type ToastText, type Tracked } from '@/lib/opToast';
import { refreshGraph } from '@/state/graph';
import type { Tab } from '@/state/tabs';
import { refreshWorkdirIfShown } from '@/state/workdir';
import { abortApply, type ApplyResult, type Rejected } from './api';

// Every branch/tag/HEAD op from the UI runs through runRefOp: its toast (lib/opToast.ts), then a graph refresh for the
// tab whatever the outcome, which also refreshes every checkout's summary (the header), and the Changes panel's lists and
// operation banner when it has loaded.

/** Files shown in a CHECKOUT_CONFLICT toast; the rest is counted. */
export const CONFLICT_FILES_SHOWN = 5;

export interface RefOpLabels<T> {
  running: string;
  done: (result: T) => string | ToastText | null;
  failed?: (error: ApiError) => Partial<ToastText> | undefined;
  toastRunning?: boolean;
}

/** "a.txt, b.txt and 3 more" */
export function fileList(files: string[], max = CONFLICT_FILES_SHOWN): string {
  const shown = files.slice(0, max).join(', ');
  return files.length > max ? `${shown} and ${files.length - max} more` : shown;
}

/** "refs/tags/v1: already exists" per rejected ref. */
export const rejectedLines = (rejected: Rejected[]): string[] => rejected.map((r) => `${r.ref}: ${r.reason}`);

/** The rejected refs a PUSH_REJECTED refusal carries ([] for any other error). */
export function rejectedOf(e: ApiError): Rejected[] {
  const list = (e.body as { rejected?: unknown } | undefined)?.rejected;
  return Array.isArray(list) ? list.filter((r): r is Rejected => typeof r?.ref === 'string' && typeof r?.reason === 'string') : [];
}

/** The toast for a push the remote refused entirely: each ref and why. */
function rejectedToast(e: ApiError): Partial<ToastText> | undefined {
  const lines = rejectedLines(rejectedOf(e));
  return e.code === 'PUSH_REJECTED' && lines.length ? { title: 'The remote rejected the push', description: lines.join('\n') } : undefined;
}

/** The toast for a refusal every ref op can meet: local changes in the way. */
export function conflictToast(e: ApiError): Partial<ToastText> | undefined {
  if (e.code !== 'CHECKOUT_CONFLICT') return undefined;
  const files = (e.body as { files?: unknown } | undefined)?.files;
  const list = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : [];
  return {
    title: 'Local changes would be overwritten',
    description: `${list.length ? `${fileList(list)}. ` : ''}Commit, stash or discard these changes first.`,
  };
}

export async function runRefOp<T>(tab: Tab, labels: RefOpLabels<T>, fn: () => Promise<T>): Promise<Tracked<T>> {
  const r = await trackOp(fn, {
    running: labels.running, done: labels.done, toastRunning: labels.toastRunning,
    failed: (e) => ({ ...conflictToast(e), ...rejectedToast(e), ...labels.failed?.(e) }),
  });
  void refreshGraph(tab, 'write');
  refreshWorkdirIfShown(tab);
  return r;
}

/** The outcome toast of a revert or cherry-pick: a conflict is a warning offering Abort. */
export function applyToast(tab: Tab, which: 'revert' | 'cherry-pick', done: string): (r: ApplyResult) => string | ToastText {
  return (r) => {
    if (!r.conflicts) return done;
    return {
      tone: 'warning',
      title: `${which === 'revert' ? 'Revert' : 'Cherry-pick'} stopped on conflicts`,
      description: `Conflicts in ${fileList(r.files)}. Resolve them and commit, or abort.`,
      action: {
        label: 'Abort',
        onClick: () => void runRefOp(tab, { running: `Aborting the ${which}…`, done: () => `${which === 'revert' ? 'Revert' : 'Cherry-pick'} aborted` }, () => abortApply(tab, which)),
      },
    };
  };
}
