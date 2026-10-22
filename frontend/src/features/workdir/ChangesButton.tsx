import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import { useRepoSummary } from '@/state/useRepoSummary';
import { setDialogOpen, workdirOf, workdirStore } from '@/state/workdir';
import { WorkdirContent } from './WorkdirContent';

/** Below `lg` the right slot is hidden: this header button opens the same Changes content in a dialog. */
export function ChangesButton({ tab }: { tab: Tab }) {
  useStore(workdirStore);
  const { summary } = useRepoSummary(tab);
  const open = workdirOf(tab).dialogOpen;
  const c = summary?.counts;
  const n = c ? c.staged + c.unstaged + c.untracked : null;
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs lg:hidden" onClick={() => setDialogOpen(tab, true)}>
        Changes{n !== null ? ` (${n})` : ''}
      </Button>
      <Dialog open={open} onOpenChange={(o) => setDialogOpen(tab, o)}>
        <DialogContent className="gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
          <DialogTitle className="sr-only">Changes</DialogTitle>
          <DialogDescription className="sr-only">Stage, unstage, discard and commit</DialogDescription>
          {open && <WorkdirContent tab={tab} instance="dialog" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
