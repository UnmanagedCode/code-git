import { useRefDialog, type RefDialog } from '@/state/refDialog';
import { CreateBranchDialog, DeleteBranchesDialog, MoveBranchDialog, RenameBranchDialog, SetUpstreamDialog } from './dialogs/BranchDialogs';
import { ResetDialog } from './dialogs/HeadDialogs';
import { CreateTagDialog, DeleteTagsDialog } from './dialogs/TagDialogs';

const ids = new WeakMap<RefDialog, number>();
let next = 0;
/** One id per opened dialog: a new dialog, even of the same kind, starts from fresh state. */
const idOf = (d: RefDialog) => {
  if (!ids.has(d)) ids.set(d, ++next);
  return ids.get(d)!;
};

/** Renders the pending branch/tag dialog (state/refDialog.ts), mounted once by the shell. */
export function RefDialogHost() {
  const d = useRefDialog();
  if (!d) return null;
  const key = idOf(d);
  switch (d.kind) {
    case 'createBranch': return <CreateBranchDialog key={key} d={d} />;
    case 'renameBranch': return <RenameBranchDialog key={key} d={d} />;
    case 'deleteBranches': return <DeleteBranchesDialog key={key} d={d} />;
    case 'createTag': return <CreateTagDialog key={key} d={d} />;
    case 'deleteTags': return <DeleteTagsDialog key={key} d={d} />;
    case 'setUpstream': return <SetUpstreamDialog key={key} d={d} />;
    case 'reset': return <ResetDialog key={key} d={d} />;
    case 'moveBranch': return <MoveBranchDialog key={key} d={d} />;
  }
}
