import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { dialogError, ErrorBlock, type DialogError } from '@/features/stash/dialogs/shared';
import { closeSubmoduleDialog, type SubmoduleDialog } from '@/state/submoduleDialog';
import { setSubmoduleUrl } from '../api';
import { runSubmoduleOp } from '../run';

type EditDialog = Extract<SubmoduleDialog, { kind: 'editUrl' }>;

function EditContent({ dialog: { tab, entry } }: { dialog: EditDialog }) {
  const current = entry.url ?? '';
  const [url, setUrl] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DialogError | null>(null);
  const ready = !busy && !!url.trim() && url.trim() !== current;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const r = await runSubmoduleOp(tab, {
      running: `Setting ${entry.path}'s url…`, toastRunning: false,
      done: () => ({ title: `Set ${entry.path}'s url`, description: '.gitmodules changed: commit it in the Changes panel.' }),
    }, () => setSubmoduleUrl(tab, entry.path, url.trim()));
    setBusy(false);
    if (r.ok) closeSubmoduleDialog(); else setError(dialogError(r.error));
  };
  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <DialogHeader>
        <DialogTitle>Edit the url of {entry.path}</DialogTitle>
        <DialogDescription>Written to .gitmodules; an initialized submodule is synced to it.</DialogDescription>
      </DialogHeader>
      <Input aria-label="Url" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
      <ErrorBlock error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeSubmoduleDialog}>Cancel</Button>
        <Button type="submit" disabled={!ready}>Save url</Button>
      </DialogFooter>
    </form>
  );
}

export function EditUrlDialog({ dialog }: { dialog: EditDialog | null }) {
  return (
    <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) closeSubmoduleDialog(); }}>
      {dialog && <DialogContent className="sm:max-w-lg"><EditContent dialog={dialog} /></DialogContent>}
    </Dialog>
  );
}
