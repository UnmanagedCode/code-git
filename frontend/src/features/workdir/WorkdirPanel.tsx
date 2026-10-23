import { tabKey, type Tab } from '@/state/tabs';
import { ChangesDialog } from './ChangesButton';
import { ConfirmHost } from './ConfirmDialog';
import { useRightSlot } from './rightSlot';
import { useWorkdirKeys } from './useWorkdirKeys';
import { WorkdirContent } from './WorkdirContent';

/**
 * The right slot's Changes panel, shown while the slot is Changes' (rightSlot.ts: no selection or a single WIP row, or
 * an unstaged or staged diff open). It also mounts, whatever is shown, the one ConfirmHost, the narrow Changes dialog
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
  return useRightSlot(tab) === 'changes' ? <WorkdirContent tab={tab} instance="slot" /> : null;
}
