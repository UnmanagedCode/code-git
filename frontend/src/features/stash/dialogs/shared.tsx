import type { ApiError } from '@/lib/api';
import { stderrOf } from '../toast';

export interface DialogError { message: string; stderr: string | null }
export const dialogError = (e: ApiError): DialogError => ({ message: e.message, stderr: stderrOf(e) ?? null });

/** A dialog's inline error: the message, and git's stderr when it sent one. Text only. */
export function ErrorBlock({ error }: { error: DialogError | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="text-xs">
      <p className="break-words text-destructive">{error.message}</p>
      {error.stderr && <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap">{error.stderr}</pre>}
    </div>
  );
}
