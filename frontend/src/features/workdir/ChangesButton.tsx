import { FileDiffIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import { useRepoSummary } from '@/state/useRepoSummary';
import { setDialogOpen, workdirOf, workdirStore } from '@/state/workdir';
import { WorkdirContent } from './WorkdirContent';

/**
 * Below `lg` the right slot is hidden: this button, beside the graph toolbar's Refs and Compare, opens the Changes
 * dialog. n = staged + unstaged + untracked.
 */
export function ChangesButton({ tab }: { tab: Tab }) {
  const { summary } = useRepoSummary(tab);
  const c = summary?.counts;
  const n = c ? c.staged + c.unstaged + c.untracked : null;
  return (
    <Button variant="outline" size="sm" className="h-7 gap-1 px-2" onClick={() => setDialogOpen(tab, true)}>
      <FileDiffIcon /> Changes{n !== null ? ` (${n})` : ''}
    </Button>
  );
}

/**
 * The Changes content as a dialog, for narrow screens (`openWorkingTree`, the Changes button). Mounted by the always
 * mounted WorkdirPanel (it portals to the body), so it opens even while a diff has replaced the graph.
 */
export function ChangesDialog({ tab }: { tab: Tab }) {
  useStore(workdirStore);
  const open = workdirOf(tab).dialogOpen;
  return (
    <Dialog open={open} onOpenChange={(o) => setDialogOpen(tab, o)}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Changes</DialogTitle>
        <DialogDescription className="sr-only">Stage, unstage, discard and commit</DialogDescription>
        {open && <WorkdirContent tab={tab} instance="dialog" />}
      </DialogContent>
    </Dialog>
  );
}
