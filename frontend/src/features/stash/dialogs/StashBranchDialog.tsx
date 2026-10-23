import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Stash } from '@/features/graph/types';
import type { ApiError } from '@/lib/api';
import { clip } from '@/lib/clip';
import { confirm } from '@/lib/confirm';
import { closeStashDialog, type StashDialog } from '@/state/stashDialog';
import type { Tab } from '@/state/tabs';
import { stashBranch, type BranchResult } from '../api';
import { appliedToast, runStashOp } from '../run';
import type { ToastText } from '../toast';
import { dialogError, ErrorBlock, type DialogError } from './shared';

type BranchDialog = Extract<StashDialog, { kind: 'branch' }>;

/** C5's warning before moving a code-conductor/* HEAD (features/branches/refInfo.ts → ccHeadWarning, same words). */
const ccHeadWarning = (branch: string): string =>
  `This checkout is code-conductor's worktree on ${branch}. Switching away leaves cc's worktree record, and its sync and merge, on a branch or commit the agent did not make.`;

/** The HEAD branch a CC_OWNED_BRANCH refusal about this checkout names, or null for any other error. */
function ccHeadOf(e: ApiError): string | null {
  const body = e.body as { head?: unknown; branches?: unknown } | undefined;
  if (e.code !== 'CC_OWNED_BRANCH' || body?.head !== true) return null;
  return Array.isArray(body.branches) && typeof body.branches[0] === 'string' ? body.branches[0] : '';
}

const branchDone = (stash: Stash, name: string) => (r: BranchResult): string | ToastText => {
  if (r.conflicts.length) return appliedToast('', stash.selector, r.conflicts, true);
  if (!r.dropped) return { tone: 'warning', title: `Created ${name}; ${stash.selector} was not dropped`, description: 'The stash list changed meanwhile: drop it yourself once you have checked it.' };
  return `Created ${name} from ${stash.selector}`;
};

/** Sends the request again with the acknowledgement once the user confirms moving the code-conductor/* HEAD. */
async function confirmAndRetry(tab: Tab, stash: Stash, name: string, branch: string): Promise<void> {
  const ok = await confirm({ title: `Switching to ${name}?`, body: ccHeadWarning(branch), confirmLabel: 'Switch anyway' });
  if (!ok) return;
  await runStashOp(tab, { running: `Creating ${name}…`, done: branchDone(stash, name) }, () => stashBranch(tab, stash.oid, name, true));
}

function BranchContent({ dialog: { tab, stash } }: { dialog: BranchDialog }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DialogError | null>(null);
  const ready = !busy && !!name.trim();
  const submit = async () => {
    if (!ready) return;
    const n = name.trim();
    setBusy(true);
    setError(null);
    const r = await runStashOp(tab, { running: `Creating ${n}…`, toastRunning: false, done: branchDone(stash, n) }, () => stashBranch(tab, stash.oid, n));
    setBusy(false);
    if (r.ok) { closeStashDialog(); return; }
    const cc = ccHeadOf(r.error);
    if (cc === null) { setError(dialogError(r.error)); return; }
    // One modal at a time: the confirmation replaces this dialog.
    closeStashDialog();
    await confirmAndRetry(tab, stash, n, cc);
  };
  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <DialogHeader>
        <DialogTitle>Create branch from {stash.selector}</DialogTitle>
        <DialogDescription className="break-words">
          A new branch at the commit the stash was made on, checked out, with the stash applied (and dropped when it applies cleanly). {clip(stash.subject)}
        </DialogDescription>
      </DialogHeader>
      <Input aria-label="Branch name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <ErrorBlock error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeStashDialog}>Cancel</Button>
        <Button type="submit" disabled={!ready}>Create branch</Button>
      </DialogFooter>
    </form>
  );
}

export function StashBranchDialog({ dialog }: { dialog: BranchDialog | null }) {
  return (
    <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) closeStashDialog(); }}>
      {dialog && <DialogContent className="sm:max-w-lg"><BranchContent dialog={dialog} /></DialogContent>}
    </Dialog>
  );
}
