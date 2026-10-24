import { useLfsDialog } from '@/state/lfsDialog';
import { LfsDialog } from './LfsDialog';

/** Renders the open LFS dialog (state/lfsDialog.ts). Mounted once, by the Shell. */
export function LfsHost() {
  const d = useLfsDialog();
  return d ? <LfsDialog d={d} /> : null;
}
