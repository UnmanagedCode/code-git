import { useEffect } from 'react';
import { useSubmoduleDialog } from '@/state/submoduleDialog';
import { AddSubmoduleDialog } from './dialogs/AddSubmoduleDialog';
import { EditUrlDialog } from './dialogs/EditUrlDialog';
import { PointerCommitDialog } from './dialogs/PointerCommitDialog';
import { watchSubmoduleExits } from './exit';

/** Renders the open submodule dialog (state/submoduleDialog.ts) and offers pointer commits as submodule tabs close. Mounted once, by the Shell. */
export function SubmoduleDialogHost() {
  const d = useSubmoduleDialog();
  useEffect(() => watchSubmoduleExits(), []);
  return (
    <>
      <AddSubmoduleDialog dialog={d?.kind === 'add' ? d : null} />
      <EditUrlDialog dialog={d?.kind === 'editUrl' ? d : null} />
      <PointerCommitDialog dialog={d?.kind === 'pointer' ? d : null} />
    </>
  );
}
