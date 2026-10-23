import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { clip } from '@/lib/clip';
import { closeStashDialog, type StashDialog } from '@/state/stashDialog';
import { stashRename } from '../api';
import { runStashOp } from '../run';
import { messageOf } from '../views';
import { dialogError, ErrorBlock, type DialogError } from './shared';

type RenameDialog = Extract<StashDialog, { kind: 'rename' }>;

function RenameContent({ dialog: { tab, stash } }: { dialog: RenameDialog }) {
  const current = messageOf(stash.subject);
  const [message, setMessage] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DialogError | null>(null);
  const ready = !busy && !!message.trim() && message.trim() !== current;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const r = await runStashOp(tab, { running: 'Renaming…', toastRunning: false, done: () => 'Renamed the stash: it is now stash@{0}' }, () => stashRename(tab, stash.oid, message.trim()));
    setBusy(false);
    if (r.ok) closeStashDialog(); else setError(dialogError(r.error));
  };
  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <DialogHeader>
        <DialogTitle>Rename {stash.selector}</DialogTitle>
        <DialogDescription className="break-words">{clip(stash.subject)}</DialogDescription>
      </DialogHeader>
      <Input aria-label="Stash message" value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
      <p className="text-sm text-muted-foreground">A renamed stash moves to the top (stash@{'{'}0{'}'}).</p>
      <ErrorBlock error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeStashDialog}>Cancel</Button>
        <Button type="submit" disabled={!ready}>Rename</Button>
      </DialogFooter>
    </form>
  );
}

export function RenameStashDialog({ dialog }: { dialog: RenameDialog | null }) {
  return (
    <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) closeStashDialog(); }}>
      {dialog && <DialogContent className="sm:max-w-lg"><RenameContent dialog={dialog} /></DialogContent>}
    </Dialog>
  );
}
