import { useId } from 'react';
import { Redo2Icon, Undo2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { shortcutLabel } from '@/shell/shortcuts';
import { useStore } from '@/state/store';
import type { Tab } from '@/state/tabs';
import { useUndo } from '@/state/undo';
import { workdirStore } from '@/state/workdir';
import type { UndoDir, UndoSlot } from './api';
import { blockedReason, undoFlow } from './flows';
import { REDO_KEY, UNDO_KEY } from './keys';

// The repo header's Undo and Redo: the touch path to the journal. Each is disabled with its reason as its description.

const LABEL: Record<UndoDir, string> = { undo: 'Undo', redo: 'Redo' };

function UndoButton({ tab, dir, slot, blocked }: { tab: Tab; dir: UndoDir; slot: UndoSlot | null; blocked: string | null }) {
  const descId = useId();
  const key = shortcutLabel(dir === 'undo' ? UNDO_KEY : REDO_KEY);
  const reason = blocked ?? (slot ? null : `Nothing to ${dir}`);
  const title = slot ? `${LABEL[dir]} ${slot.label} (${key})` : `${LABEL[dir]} (${key})`;
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={LABEL[dir]} aria-describedby={descId} title={reason ?? title}
        disabled={!!reason} onClick={() => void undoFlow(tab, dir)}>
        {dir === 'undo' ? <Undo2Icon /> : <Redo2Icon />}
      </Button>
      <span id={descId} className="sr-only">{reason ?? title}</span>
    </>
  );
}

export function UndoButtons({ tab }: { tab: Tab }) {
  const { data } = useUndo(tab);
  // Re-rendered when what is in progress changes (the Changes panel's state).
  useStore(workdirStore);
  const blocked = blockedReason(tab);
  return (
    <>
      <UndoButton tab={tab} dir="undo" slot={data?.undo ?? null} blocked={blocked} />
      <UndoButton tab={tab} dir="redo" slot={data?.redo ?? null} blocked={blocked} />
    </>
  );
}
