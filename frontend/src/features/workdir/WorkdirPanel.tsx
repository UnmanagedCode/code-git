import { useGraphSelection } from '@/state/graphSelection';
import { tabKey, type Tab } from '@/state/tabs';
import { ChangesDialog } from './ChangesButton';
import { ConfirmHost } from './ConfirmDialog';
import { changesInRightSlot } from './rightSlot';
import { useWorkdirKeys } from './useWorkdirKeys';
import { WorkdirContent } from './WorkdirContent';

/**
 * The right slot's Changes panel, shown while the graph selection is empty or a single WIP row (else the slot shows the
 * commit details: rightSlot.ts). It also mounts, whatever is shown, the one ConfirmHost, the narrow Changes dialog
 * (both portal to the body; the slot stays mounted when hidden below `lg`) and the panel's global keys.
 */
export function WorkdirPanel({ tab }: { tab: Tab | null }) {
  useWorkdirKeys(tab);
  return (
    <>
      {tab && <SlotContent key={tabKey(tab)} tab={tab} />}
      {tab && <ChangesDialog key={`dialog:${tabKey(tab)}`} tab={tab} />}
      <ConfirmHost />
    </>
  );
}

function SlotContent({ tab }: { tab: Tab }) {
  const sel = useGraphSelection(tab);
  return changesInRightSlot(sel.items) ? <WorkdirContent tab={tab} instance="slot" /> : null;
}
