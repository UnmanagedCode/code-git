import type { MenuAction } from '@/shell/menus';
import type { WorkdirFileCtx } from '@/features/workdir/actions';
import { markResolved, takeSide } from './flows';
import { labelsFor, openConflict } from './open';
import { ArrowLeftToLineIcon, ArrowRightToLineIcon, CircleCheckIcon, GitCompareArrowsIcon } from 'lucide-react';

// The Changes panel's menu on a conflicted (U) row (docs/merge.md → The conflict tool).

const conflicted = (c: WorkdirFileCtx) => c.file.status === 'U';

export const CONFLICT_FILE_ACTIONS: MenuAction<never>[] = [
  {
    id: 'conflicts.file.open', icon: GitCompareArrowsIcon, context: 'workdir-file', group: 'conflict', order: 50, label: 'Open in merge tool', when: conflicted,
    run: (c: WorkdirFileCtx) => void openConflict(c.tab, c.file.path),
  },
  {
    id: 'conflicts.file.takeOurs', icon: ArrowLeftToLineIcon, context: 'workdir-file', group: 'conflict', order: 51, when: conflicted,
    label: (c: WorkdirFileCtx) => `Take current (${labelsFor(c.tab).current})`,
    run: (c: WorkdirFileCtx) => void takeSide(c.tab, [c.file.path], 'ours'),
  },
  {
    id: 'conflicts.file.takeTheirs', icon: ArrowRightToLineIcon, context: 'workdir-file', group: 'conflict', order: 52, when: conflicted,
    label: (c: WorkdirFileCtx) => `Take incoming (${labelsFor(c.tab).incoming})`,
    run: (c: WorkdirFileCtx) => void takeSide(c.tab, [c.file.path], 'theirs'),
  },
  {
    id: 'conflicts.file.resolved', icon: CircleCheckIcon, context: 'workdir-file', group: 'conflict', order: 53, label: 'Mark resolved', when: conflicted,
    run: (c: WorkdirFileCtx) => void markResolved(c.tab, c.file.path),
  },
] as MenuAction<never>[];
