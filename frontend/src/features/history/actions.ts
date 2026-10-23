import { reset } from '@/features/branches/actions';
import type { ResetMode } from '@/features/branches/api';
import { headOf } from '@/features/branches/refInfo';
import type { DiffFileCtx } from '@/features/diff/actions';
import { openDiff } from '@/features/diff/openDiff';
import { CONTEXT, type FileCtx, type RefCtx } from '@/features/graph/contexts';
import type { WorkdirFileCtx } from '@/features/workdir/actions';
import type { MenuAction } from '@/shell/menus';
import { diffStore } from '@/state/diff';
import { openRefDialog } from '@/state/refDialog';
import { tabKey, type Tab } from '@/state/tabs';
import type { ReflogItem } from './api';
import { openBlame, openFileHistory, openReflog } from './open';

// The history feature's menu items (order 800: view): File history and Blame on a commit's file, a diff's file and a
// tracked Changes row; Show reflog on a local branch; and the reflog row's own menu.

export const REFLOG_CONTEXT = 'reflog-entry';
export interface ReflogEntryCtx { tab: Tab; entry: ReflogItem }

/** The commit a diff's new side is (`commit`), else HEAD (a working-tree or index diff: the file as last committed). */
function diffRev(tab: Tab): { rev: string | null; commit: boolean } {
  const side = diffStore.get().get(tabKey(tab))?.list.result?.pair.new;
  return side?.type === 'tree' ? { rev: side.oid, commit: true } : { rev: headOf(tab).oid, commit: false };
}

/** File history and Blame for one file of `context`, at the commit `at` says; Blame not for a file the commit deletes. */
function fileItems<C extends { tab: Tab }>(context: string, at: (c: C) => { path: string; rev: string | null; deleted: boolean } | null): MenuAction<C>[] {
  return [
    {
      id: `${context}.history`, context, label: 'File history', group: 'view', order: 810,
      when: (c) => !!at(c)?.rev, run: (c) => { const a = at(c); if (a?.rev) openFileHistory(c.tab, { path: a.path, rev: a.rev }); },
    },
    {
      id: `${context}.blame`, context, label: 'Blame', group: 'view', order: 811,
      when: (c) => { const a = at(c); return !!a?.rev && !a.deleted; }, run: (c) => { const a = at(c); if (a?.rev) openBlame(c.tab, { path: a.path, rev: a.rev }); },
    },
  ];
}

const MODES: { mode: ResetMode; label: string }[] = [{ mode: 'soft', label: 'Soft (keep index and files)' }, { mode: 'mixed', label: 'Mixed (keep files)' }, { mode: 'hard', label: 'Hard (discard changes)' }];
const pointOf = (c: ReflogEntryCtx) => ({ oid: c.entry.oid, label: c.entry.selector });

export const HISTORY_ACTIONS: MenuAction<never>[] = [
  ...fileItems<FileCtx>(CONTEXT.file, (c) => ({ path: c.file.path, rev: c.commit, deleted: c.file.status === 'D' })),
  ...fileItems<DiffFileCtx>('diff-file', (c) => {
    if (c.files.length !== 1) return null;
    const { rev, commit } = diffRev(c.tab);
    return { path: c.files[0].path, rev, deleted: commit && c.files[0].status === 'D' };
  }),
  // A tracked row: the file as HEAD has it (an untracked or newly added file has no history yet).
  ...fileItems<WorkdirFileCtx>('workdir-file', (c) => (c.file.status === '?' || c.file.status === 'A' ? null : { path: c.file.oldPath ?? c.file.path, rev: headOf(c.tab).oid, deleted: false })),
  {
    id: 'branch.reflog', context: CONTEXT.branch, label: 'Show reflog', group: 'view', order: 810,
    when: (c: RefCtx) => c.ref.kind === 'local', run: (c: RefCtx) => openReflog(c.tab, c.ref.name),
  },
  { id: 'reflog.diff', context: REFLOG_CONTEXT, label: 'View changes', order: 100, run: (c: ReflogEntryCtx) => openDiff(c.tab, { kind: 'commit', rev: c.entry.oid }) },
  { id: 'reflog.branch', context: REFLOG_CONTEXT, label: 'Create branch here…', order: 200, run: (c: ReflogEntryCtx) => openRefDialog({ kind: 'createBranch', tab: c.tab, from: pointOf(c) }) },
  {
    id: 'reflog.reset', context: REFLOG_CONTEXT, label: 'Reset HEAD to here', order: 300, group: 'reset', when: (c: ReflogEntryCtx) => headOf(c.tab).oid !== null,
    children: MODES.map(({ mode, label }) => ({
      id: `reflog.reset.${mode}`, context: REFLOG_CONTEXT, label, destructive: mode === 'hard', run: (c: ReflogEntryCtx) => reset(c.tab, pointOf(c), mode),
    })),
  },
  { id: 'reflog.copy', context: REFLOG_CONTEXT, label: 'Copy SHA', order: 900, group: 'copy', run: (c: ReflogEntryCtx) => navigator.clipboard?.writeText(c.entry.oid) },
] as MenuAction<never>[];
