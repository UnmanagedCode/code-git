import type { Command } from '@/shell/commands';
import { undoOf } from '@/state/undo';
import { blockedReason, redoFlow, undoFlow } from './flows';
import { REDO_KEY, UNDO_KEY } from './keys';

// The palette's Undo and Redo (shell/commands.ts), titled with the entry they run.

export const UNDO_COMMANDS: Command[] = [
  {
    id: 'undo.undo', title: (tab) => `Undo ${undoOf(tab).data?.undo?.label ?? ''}`.trim(), group: 'Undo', shortcut: UNDO_KEY,
    when: (tab) => !!undoOf(tab).data?.undo && !blockedReason(tab), run: (tab) => undoFlow(tab),
  },
  {
    id: 'undo.redo', title: (tab) => `Redo ${undoOf(tab).data?.redo?.label ?? ''}`.trim(), group: 'Undo', shortcut: REDO_KEY,
    when: (tab) => !!undoOf(tab).data?.redo && !blockedReason(tab), run: (tab) => redoFlow(tab),
  },
];
