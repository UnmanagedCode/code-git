import { useStashDialog } from '@/state/stashDialog';
import { RenameStashDialog } from './dialogs/RenameStashDialog';
import { StashBranchDialog } from './dialogs/StashBranchDialog';
import { StashSaveDialog } from './dialogs/StashSaveDialog';

/** Renders the open stash dialog (state/stashDialog.ts). Mounted once, by the Shell; each Dialog root stays mounted. */
export function StashDialogHost() {
  const d = useStashDialog();
  return (
    <>
      <StashSaveDialog dialog={d?.kind === 'save' ? d : null} />
      <RenameStashDialog dialog={d?.kind === 'rename' ? d : null} />
      <StashBranchDialog dialog={d?.kind === 'branch' ? d : null} />
    </>
  );
}
