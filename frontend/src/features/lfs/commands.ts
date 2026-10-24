import type { Command } from '@/shell/commands';
import { openLfsDialog } from '@/state/lfsDialog';

// The palette's LFS command (shell/commands.ts).

export const LFS_COMMANDS: Command[] = [
  { id: 'lfs.open', title: 'LFS…', group: 'Repository', run: (tab) => openLfsDialog(tab) },
];
