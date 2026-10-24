import { useFlowDialog } from '@/state/flowDialog';
import { FinishFlowDialog, InitFlowDialog, StartFlowDialog } from './FlowDialogs';

/** Renders the open git-flow dialog (state/flowDialog.ts). Mounted once, by the Shell. */
export function FlowHost() {
  const d = useFlowDialog();
  if (d?.kind === 'init') return <InitFlowDialog d={d} />;
  if (d?.kind === 'start') return <StartFlowDialog d={d} />;
  if (d?.kind === 'finish') return <FinishFlowDialog d={d} />;
  return null;
}
