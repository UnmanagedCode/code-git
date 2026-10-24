import { REPO_CONTEXT, type RepoCtx } from '@/features/repoMenu/context';
import type { MenuAction } from '@/shell/menus';
import { openLfsDialog } from '@/state/lfsDialog';

// The repository menu's LFS item (docs/lfs.md).

export const LFS_ACTIONS: MenuAction<never>[] = [
  { id: 'lfs.repo.open', context: REPO_CONTEXT, label: 'LFS…', group: 'lfs', order: 200, run: (c: RepoCtx) => openLfsDialog(c.tab) },
];
