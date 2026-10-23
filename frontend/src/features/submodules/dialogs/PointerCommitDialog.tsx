import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { dialogError, ErrorBlock, type DialogError } from '@/features/stash/dialogs/shared';
import { tabLabel } from '@/features/tabs/actions';
import { closeSubmoduleDialog, type SubmoduleDialog } from '@/state/submoduleDialog';
import { commitPointer } from '../api';
import { subTab } from '../actions';
import { offerPointerCommit } from '../exit';
import { runSubmoduleOp } from '../run';

type PointerDialog = Extract<SubmoduleDialog, { kind: 'pointer' }>;
const short = (oid: string | null) => oid?.slice(0, 7) ?? 'none';

function PointerContent({ dialog: { tab, entry } }: { dialog: PointerDialog }) {
  const [summary, setSummary] = useState(`Update submodule ${entry.path}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DialogError | null>(null);
  const ready = !busy && !!summary.trim();
  const submit = async () => {
    if (!ready || !entry.head) return;
    setBusy(true);
    setError(null);
    const r = await runSubmoduleOp(tab, {
      running: 'Committing the pointer…', toastRunning: false, done: (x) => `Committed ${entry.path} at ${short(entry.head)} (${x.oid.slice(0, 7)})`,
    }, () => commitPointer(tab, { path: entry.path, expect: entry.head!, summary: summary.trim() }));
    setBusy(false);
    if (r.ok) { closeSubmoduleDialog(); return; }
    // The submodule moved since the check: check again (a new dialog with its new HEAD, or none).
    if (r.error.code === 'SUBMODULE_POINTER_MOVED') { closeSubmoduleDialog(); void offerPointerCommit(subTab(tab, entry)); return; }
    setError(dialogError(r.error));
  };
  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <DialogHeader>
        <DialogTitle>Commit the new pointer for {entry.path} in {tabLabel(tab)}?</DialogTitle>
        <DialogDescription>
          {entry.path} is at {short(entry.head)}; {tabLabel(tab)} has committed {short(entry.committed)}. Only the pointer is committed: whatever else is staged stays staged.
        </DialogDescription>
      </DialogHeader>
      <Input aria-label="Commit message" value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
      <ErrorBlock error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeSubmoduleDialog}>Not now</Button>
        <Button type="submit" disabled={!ready}>Commit pointer</Button>
      </DialogFooter>
    </form>
  );
}

export function PointerCommitDialog({ dialog }: { dialog: PointerDialog | null }) {
  return (
    <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) closeSubmoduleDialog(); }}>
      {dialog && <DialogContent className="sm:max-w-lg"><PointerContent key={`${dialog.entry.path}\0${dialog.entry.head}`} dialog={dialog} /></DialogContent>}
    </Dialog>
  );
}
