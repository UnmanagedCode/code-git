import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ApiError } from '@/lib/api';
import { clip } from '@/lib/clip';
import { stderrOf } from '@/lib/opToast';
import { closeRefDialog } from '@/state/refDialog';
import type { Tab } from '@/state/tabs';
import { runRefOp, type RefOpLabels } from '../run';

// The frame every branch/tag dialog shares: a form whose submit runs one op, stays open (busy) until it answers,
// closes with a success toast, or shows the refusal inline.

export function useRefOp() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  /** Runs `fn` as a dialog's op; on success `then(result)` (default: close the dialog). */
  async function run<T>(tab: Tab, labels: RefOpLabels<T>, fn: () => Promise<T>, then: (r: T) => void = () => closeRefDialog()) {
    setBusy(true);
    setError(null);
    const r = await runRefOp(tab, { ...labels, toastRunning: false }, fn);
    setBusy(false);
    if (r.ok) then(r.result);
    else setError(r.error);
  }
  return { busy, error, run };
}

/** A warning about a code-conductor/* branch, shown before the user confirms. */
export function CcWarning({ children }: { children: ReactNode }) {
  return <p role="note" className="rounded-md border border-warning/60 bg-warning/10 p-2 text-sm">{children}</p>;
}

export function RefDialogFrame({ title, description, submit, busyLabel, busy, error, destructive = false, canSubmit = true, onSubmit, extraButton, children }: {
  title: string;
  description?: ReactNode;
  submit: string;
  busyLabel: string;
  busy: boolean;
  error: ApiError | null;
  destructive?: boolean;
  canSubmit?: boolean;
  onSubmit: () => void;
  extraButton?: ReactNode;
  children?: ReactNode;
}) {
  const stderr = error ? stderrOf(error) : undefined;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) closeRefDialog(); }}>
      <DialogContent onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }} onInteractOutside={(e) => { if (busy) e.preventDefault(); }}>
        <form className="grid gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!busy && canSubmit) onSubmit(); }}>
          <DialogHeader>
            <DialogTitle className="break-words">{clip(title)}</DialogTitle>
            {description !== undefined && <DialogDescription className="break-words">{description}</DialogDescription>}
          </DialogHeader>
          {children}
          {error && (
            <div role="alert" className="grid gap-1 text-sm text-destructive">
              <p className="break-words">{clip(error.message)}</p>
              {stderr && <p className="font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">{clip(stderr, 600)}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => closeRefDialog()}>Cancel</Button>
            {extraButton}
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || !canSubmit}>{busy ? busyLabel : submit}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const fieldClass = 'grid gap-1.5 text-sm';
