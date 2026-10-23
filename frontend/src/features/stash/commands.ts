import type { Command } from '@/shell/commands';
import { openStashSave } from './actions';

// The palette's stash command (shell/commands.ts).

export const STASH_COMMANDS: Command[] = [
  { id: 'stash.save', title: 'Stash changes…', group: 'Changes', run: (tab) => openStashSave(tab, { mode: 'all' }) },
];
