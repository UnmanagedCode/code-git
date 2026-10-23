import type { Command } from '@/shell/commands';
import { stageAll, unstageAll } from './actions';
import { openWorkingTree } from './entry';
import { FOCUS_COMMIT_KEY, STAGE_ALL_KEY, UNSTAGE_ALL_KEY } from './keys';

// The palette's Changes commands (shell/commands.ts).

export const WORKDIR_COMMANDS: Command[] = [
  { id: 'workdir.show', title: 'Show changes', group: 'Changes', shortcut: FOCUS_COMMIT_KEY, run: (tab) => openWorkingTree(tab) },
  { id: 'workdir.stageAll', title: 'Stage all', group: 'Changes', shortcut: STAGE_ALL_KEY, run: (tab) => stageAll(tab) },
  { id: 'workdir.unstageAll', title: 'Unstage all', group: 'Changes', shortcut: UNSTAGE_ALL_KEY, run: (tab) => unstageAll(tab) },
];
