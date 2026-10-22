import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { clip, FILE_RENDER_CAP } from '@/lib/clip';
import { settleConfirm, usePendingConfirm } from '@/lib/confirm';

/** Renders the pending confirm() (lib/confirm.ts), if any. Mounted once, by the Changes panel. Everything is text. */
export function ConfirmHost() {
  const pending = usePendingConfirm();
  const o = pending?.opts;
  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) settleConfirm(false); }}>
      {o && (
        <DialogContent className="sm:max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="break-words">{clip(o.title)}</DialogTitle>
            <DialogDescription>{clip(o.body)}</DialogDescription>
          </DialogHeader>
          {o.count !== undefined && <p className="text-sm">{o.count} {o.count === 1 ? 'file' : 'files'}</p>}
          {!!o.items?.length && (
            <ul aria-label="Affected files" className="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
              {o.items.slice(0, FILE_RENDER_CAP).map((it) => <li key={it} className="truncate" title={clip(it)}>{clip(it)}</li>)}
              {o.items.length > FILE_RENDER_CAP && <li className="text-muted-foreground">…and {o.items.length - FILE_RENDER_CAP} more</li>}
            </ul>
          )}
          {!!o.preview?.length && (
            <pre aria-label="Lines" className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre">{o.preview.map((l) => clip(l)).join('\n')}</pre>
          )}
          {o.irreversible && <p className="text-sm font-medium text-destructive">This cannot be undone.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => settleConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => settleConfirm(true)}>{o.confirmLabel}</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
