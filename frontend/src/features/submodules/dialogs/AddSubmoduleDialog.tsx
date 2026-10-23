import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { dialogError, ErrorBlock, type DialogError } from '@/features/stash/dialogs/shared';
import { closeSubmoduleDialog, type SubmoduleDialog } from '@/state/submoduleDialog';
import { addSubmodule } from '../api';
import { runSubmoduleOp } from '../run';

type AddDialog = Extract<SubmoduleDialog, { kind: 'add' }>;

/** The last path segment of a url, minus `.git`: the path a new submodule defaults to. */
export const defaultPath = (url: string): string => url.trim().replace(/\/+$/, '').split(/[/:]/).at(-1)?.replace(/\.git$/, '') ?? '';

function AddContent({ dialog: { tab } }: { dialog: AddDialog }) {
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DialogError | null>(null);
  const shownPath = path || defaultPath(url);
  const ready = !busy && !!url.trim() && !!shownPath;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const p = { url: url.trim(), path: shownPath, ...(name.trim() ? { name: name.trim() } : {}), ...(branch.trim() ? { branch: branch.trim() } : {}) };
    const r = await runSubmoduleOp(tab, {
      running: `Adding ${p.path}…`, toastRunning: false,
      done: (x) => ({ title: `Added the submodule ${x.path}`, description: 'It and .gitmodules are staged: commit them in the Changes panel.' }),
    }, () => addSubmodule(tab, p));
    setBusy(false);
    if (r.ok) closeSubmoduleDialog(); else setError(dialogError(r.error));
  };
  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <DialogHeader>
        <DialogTitle>Add a submodule</DialogTitle>
        <DialogDescription>git clones it into the path and stages it with .gitmodules.</DialogDescription>
      </DialogHeader>
      <label className="flex flex-col gap-1 text-sm">Url
        <Input aria-label="Url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or ../sibling.git" autoFocus />
      </label>
      <label className="flex flex-col gap-1 text-sm">Path
        <Input aria-label="Path" value={path} onChange={(e) => setPath(e.target.value)} placeholder={defaultPath(url) || 'libs/name'} />
      </label>
      <label className="flex flex-col gap-1 text-sm">Name (optional)
        <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={shownPath} />
      </label>
      <label className="flex flex-col gap-1 text-sm">Branch to track (optional)
        <Input aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
      </label>
      {busy && <p className="text-sm text-muted-foreground" role="status">Cloning {shownPath}…</p>}
      <ErrorBlock error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeSubmoduleDialog}>Cancel</Button>
        <Button type="submit" disabled={!ready}>Add submodule</Button>
      </DialogFooter>
    </form>
  );
}

export function AddSubmoduleDialog({ dialog }: { dialog: AddDialog | null }) {
  return (
    <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) closeSubmoduleDialog(); }}>
      {dialog && <DialogContent className="sm:max-w-lg"><AddContent dialog={dialog} /></DialogContent>}
    </Dialog>
  );
}
