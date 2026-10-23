import { useEffect } from 'react';
import { GitBranchPlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isTextEntry } from '@/lib/textEntry';
import { matches, shortcutLabel } from '@/shell/shortcuts';
import { useGraphData } from '@/state/graph';
import { openRefDialog, refDialogStore } from '@/state/refDialog';
import type { Tab } from '@/state/tabs';
import { CREATE_BRANCH_KEY } from './keys';

/** The graph toolbar's Branch button (a branch from HEAD), and Ctrl/⌘+B while focus is in the frame and not in a text field. */
export function CreateBranchButton({ tab }: { tab: Tab }) {
  const born = !!useGraphData(tab).refs?.head.oid;
  useEffect(() => {
    if (!born) return;
    const onKey = (e: KeyboardEvent) => {
      if (!matches(e, CREATE_BRANCH_KEY)) return;
      if (isTextEntry(document.activeElement) || refDialogStore.get()) return;
      e.preventDefault();
      openRefDialog({ kind: 'createBranch', tab, from: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, born]);
  return (
    <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={!born} title={`Create a branch from HEAD (${shortcutLabel(CREATE_BRANCH_KEY)})`}
      onClick={() => openRefDialog({ kind: 'createBranch', tab, from: null })}>
      <GitBranchPlusIcon /> Branch
    </Button>
  );
}
