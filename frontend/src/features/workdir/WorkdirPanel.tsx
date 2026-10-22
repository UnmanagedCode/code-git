import { tabKey, type Tab } from '@/state/tabs';
import { ConfirmHost } from './ConfirmDialog';
import { useWorkdirKeys } from './useWorkdirKeys';
import { WorkdirContent } from './WorkdirContent';

/**
 * The right slot's Changes panel. It also mounts the one ConfirmHost (the slot stays mounted when hidden below `lg`;
 * the dialog portals to the body) and the panel's global keys.
 */
export function WorkdirPanel({ tab }: { tab: Tab | null }) {
  useWorkdirKeys(tab);
  return (
    <>
      {tab && <WorkdirContent key={tabKey(tab)} tab={tab} instance="slot" />}
      <ConfirmHost />
    </>
  );
}
