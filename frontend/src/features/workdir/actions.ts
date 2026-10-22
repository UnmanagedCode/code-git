import type { DiffFile } from '@/features/diff/api';
import { patchPaths } from '@/features/diff/patch';
import { confirm } from '@/lib/confirm';
import type { MenuAction } from '@/shell/menus';
import type { Tab } from '@/state/tabs';
import { runWorkdirOp } from '@/state/workdir';
import { discardFiles, stageFiles, unstageFiles } from './api';

// What the Changes panel does to files. Every discard asks first and sends nothing until confirmed.

export type Section = 'unstaged' | 'staged';
export interface WorkdirFileCtx { tab: Tab; file: DiffFile; section: Section }

/** Statuses whose worktree change a discard can throw away (a conflict is resolved first; `U` is refused). */
const DISCARDABLE = new Set(['M', 'D', 'T', '?']);
export const canDiscard = (f: DiffFile): boolean => DISCARDABLE.has(f.status);

export const stageFile = (tab: Tab, f: DiffFile) => runWorkdirOp(tab, () => stageFiles(tab, { paths: patchPaths([f]) }));
export const unstageFile = (tab: Tab, f: DiffFile) => runWorkdirOp(tab, () => unstageFiles(tab, { paths: patchPaths([f]) }));
export const stageAll = (tab: Tab) => runWorkdirOp(tab, () => stageFiles(tab, { all: true }));
export const unstageAll = (tab: Tab) => runWorkdirOp(tab, () => unstageFiles(tab, { all: true }));

export async function discardFile(tab: Tab, f: DiffFile): Promise<void> {
  const untracked = f.status === '?';
  const ok = await confirm({
    title: untracked ? `Delete ${f.path}?` : `Discard changes to ${f.path}?`,
    body: untracked ? 'The untracked file is deleted from the working tree.' : 'Its unstaged changes are thrown away; what is staged stays.',
    irreversible: true,
    confirmLabel: untracked ? 'Delete file' : 'Discard changes',
  });
  if (!ok) return;
  await runWorkdirOp(tab, () => discardFiles(tab, untracked ? { tracked: [], untracked: [f.path] } : { tracked: [f.path], untracked: [] }));
}

/** Discard all = every listed unstaged change plus every listed untracked file; staged changes stay. Exactly the files shown. */
export async function discardAll(tab: Tab, unstaged: DiffFile[]): Promise<void> {
  const tracked = unstaged.filter((f) => canDiscard(f) && f.status !== '?').map((f) => f.path);
  const untracked = unstaged.filter((f) => f.status === '?').map((f) => f.path);
  if (!tracked.length && !untracked.length) return;
  const ok = await confirm({
    title: 'Discard all unstaged changes?',
    body: `${tracked.length} tracked ${tracked.length === 1 ? 'file loses its' : 'files lose their'} unstaged changes${untracked.length ? ', and these untracked files are deleted' : ''}. Staged changes and ignored files stay.`,
    ...(untracked.length ? { items: untracked, count: untracked.length } : {}),
    irreversible: true,
    confirmLabel: 'Discard all',
  });
  if (!ok) return;
  await runWorkdirOp(tab, () => discardFiles(tab, { tracked, untracked }));
}

export const WORKDIR_FILE_ACTIONS: MenuAction<WorkdirFileCtx>[] = [
  { id: 'workdir.stage', context: 'workdir-file', label: 'Stage', when: (c) => c.section === 'unstaged', run: (c) => void stageFile(c.tab, c.file) },
  { id: 'workdir.unstage', context: 'workdir-file', label: 'Unstage', when: (c) => c.section === 'staged', run: (c) => void unstageFile(c.tab, c.file) },
  { id: 'workdir.discard', context: 'workdir-file', label: 'Discard…', destructive: true, when: (c) => c.section === 'unstaged' && canDiscard(c.file), run: (c) => discardFile(c.tab, c.file) },
  { id: 'workdir.copyPath', context: 'workdir-file', label: 'Copy path', run: (c) => navigator.clipboard?.writeText(c.file.path) },
];
