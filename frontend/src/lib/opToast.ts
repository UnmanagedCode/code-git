import { toast } from 'sonner';
import { ApiError } from './api';
import { clip } from './clip';

// A long or one-click op's progress and outcome as a toast: "Pushing v1…" turning into its success or its error in
// place. Generic: any feature's op can be tracked (docs/architecture.md → Extension points).

export interface ToastAction { label: string; onClick: () => void }
/** A toast's content. `tone` warning: the op succeeded with something to act on (a conflict). */
export interface ToastText { title: string; description?: string; action?: ToastAction; tone?: 'success' | 'warning' }
export type Tracked<T> = { ok: true; result: T } | { ok: false; error: ApiError };

export interface TrackOptions<T> {
  /** Shown while the op runs. */
  running: string;
  /** null: nothing to say (the caller goes on to ask something); the running toast is dismissed. */
  done: (result: T) => string | ToastText | null;
  /** Overrides for the error toast; by default the error's message, with git's stderr as the description. */
  failed?: (error: ApiError) => Partial<ToastText>;
  /**
   * false: no running toast and no error toast — the caller shows both (a dialog with its own busy state and inline
   * error); only success is toasted. Default true.
   */
  toastRunning?: boolean;
}

const ERROR_MS = 10_000;
const DESCRIPTION_MAX = 600;

const asApiError = (e: unknown): ApiError => (e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : String(e)));
/** The backend's git stderr on a refusal (GIT_FAILED, CHECKOUT_CONFLICT, the push refusals), when it sent one. */
export const stderrOf = (e: ApiError): string | undefined => {
  const s = (e.body as { stderr?: unknown } | undefined)?.stderr;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
};

const opts = (t: Partial<ToastText>, id: string | number | undefined, duration?: number) => ({
  id,
  description: t.description === undefined ? undefined : clip(t.description, DESCRIPTION_MAX),
  action: t.action ? { label: clip(t.action.label), onClick: t.action.onClick } : undefined,
  duration,
});

/** Runs `fn`, toasting its progress and outcome; never throws. */
export async function trackOp<T>(fn: () => Promise<T>, o: TrackOptions<T>): Promise<Tracked<T>> {
  const loud = o.toastRunning ?? true;
  const id = loud ? toast.loading(clip(o.running)) : undefined;
  try {
    const result = await fn();
    const d = o.done(result);
    if (d === null) {
      if (id !== undefined) toast.dismiss(id);
      return { ok: true, result };
    }
    const t: ToastText = typeof d === 'string' ? { title: d } : d;
    if (t.tone === 'warning') toast.warning(clip(t.title), opts(t, id, ERROR_MS));
    else toast.success(clip(t.title), opts(t, id));
    return { ok: true, result };
  } catch (e) {
    const error = asApiError(e);
    if (loud) {
      const t: ToastText = { title: error.message, description: stderrOf(error), ...o.failed?.(error) };
      toast.error(clip(t.title), opts(t, id, ERROR_MS));
    }
    return { ok: false, error };
  }
}
