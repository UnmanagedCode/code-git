import type { DiffFile } from '@/features/diff/api';
import type { DiffFileCtx } from '@/features/diff/actions';
import { CONTEXT, type CommitCtx, type WipCtx } from '@/features/graph/contexts';
import { patchPaths } from '@/features/diff/patch';
import { confirm } from '@/lib/confirm';
import type { Target } from '@/lib/endpoints';
import type { MenuAction } from '@/shell/menus';
import { diffStore, setNotice } from '@/state/diff';
import { getGraph } from '@/state/graph';
import { tabKey, type Tab } from '@/state/tabs';
import { runWorkdirOp, workdirOf } from '@/state/workdir';
import { discardFiles, ignoreAdd, restoreFileOp, stageFiles, unstageFiles, type IgnoreKind } from './api';
import { openWip, openWorkingTree } from './entry';

// What the Changes panel does to files. Every discard asks first and sends nothing until confirmed.

export type Section = 'unstaged' | 'staged';
export interface WorkdirFileCtx { tab: Tab; file: DiffFile; section: Section }

/** Statuses whose worktree change a discard can throw away (a conflict is resolved first; `U` is refused). */
const DISCARDABLE = new Set(['M', 'D', 'T', '?']);
export const canDiscard = (f: DiffFile): boolean => DISCARDABLE.has(f.status);

/** Stages / unstages `files` in one op (a rename brings its old path: patchPaths). */
export const stageFilesOf = (tab: Tab, files: DiffFile[]) => runWorkdirOp(tab, () => stageFiles(tab, { paths: patchPaths(files) }));
export const unstageFilesOf = (tab: Tab, files: DiffFile[]) => runWorkdirOp(tab, () => unstageFiles(tab, { paths: patchPaths(files) }));
export const stageFile = (tab: Tab, f: DiffFile) => stageFilesOf(tab, [f]);
export const unstageFile = (tab: Tab, f: DiffFile) => unstageFilesOf(tab, [f]);
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
  const conflicted = unstaged.filter((f) => f.status === 'U').length;
  if (!tracked.length && !untracked.length) return;
  const ok = await confirm({
    title: 'Discard all unstaged changes?',
    body: `${tracked.length} tracked ${tracked.length === 1 ? 'file loses its' : 'files lose their'} unstaged changes${untracked.length ? `, and ${untracked.length === 1 ? 'this untracked file is' : 'these untracked files are'} deleted` : ''}. Staged changes and ignored files stay${conflicted ? `, and ${conflicted} conflicted ${conflicted === 1 ? 'file is' : 'files are'} left untouched (resolve ${conflicted === 1 ? 'it' : 'them'} first)` : ''}.`,
    ...(untracked.length ? { items: untracked, count: untracked.length } : {}),
    irreversible: true,
    confirmLabel: 'Discard all',
  });
  if (!ok) return;
  await runWorkdirOp(tab, () => discardFiles(tab, { tracked, untracked }));
}

/** What a path can be ignored as: itself, its extension (`a.log` → `log`; not a dotfile's name) and its directory. */
export function ignoreTargets(path: string): { kind: IgnoreKind; value: string; label: string }[] {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && dot < base.length - 1 ? base.slice(dot + 1) : null;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
  return [
    { kind: 'path', value: path, label: `'${base}'` },
    ...(ext ? [{ kind: 'ext' as const, value: ext, label: `all '*.${ext}' files` }] : []),
    ...(dir ? [{ kind: 'dir' as const, value: dir, label: `folder '${dir}/'` }] : []),
  ];
}

/** Adds the pattern to the root .gitignore; for a tracked file, after confirming, also removes what it matches from the index. */
export async function ignore(tab: Tab, f: DiffFile, kind: IgnoreKind, value: string): Promise<void> {
  const stopTracking = f.status !== '?';
  if (stopTracking) {
    const target = ignoreTargets(f.path).find((x) => x.kind === kind)?.label ?? value;
    const ok = await confirm({
      title: `Ignore and stop tracking ${target}?`,
      body: `A pattern is added to the root .gitignore, and every tracked file it matches is removed from the index (the files stay on disk; git add tracks them again).`,
      confirmLabel: 'Ignore and stop tracking',
    });
    if (!ok) return;
  }
  await runWorkdirOp(tab, () => ignoreAdd(tab, { kind, value, ...(stopTracking ? { stopTracking: true } : {}) }));
}

/**
 * Resets `path` to its version in commit `oid`, in the index and the worktree, after confirming (it overwrites
 * uncommitted work). The entry point for "restore file" from a diff or a commit's details. A failure shows in the
 * Changes panel and, when a diff is open, in its header.
 */
export async function restoreFile(t: Target, oid: string, path: string): Promise<void> {
  const ok = await confirm({
    title: `Restore ${path} to ${oid.slice(0, 7)}?`,
    body: "Its staged and working-tree content are replaced by this commit's version; uncommitted changes to it are lost.",
    irreversible: true,
    confirmLabel: 'Restore file',
  });
  if (!ok) return;
  if (!await runWorkdirOp(t, () => restoreFileOp(t, oid, path))) setNotice(t, `Could not restore ${path}: ${workdirOf(t).opError?.message ?? ''}`);
}

/** The commit a diff's new side is (a tree side), for the restore action. */
const newCommit = (tab: Tab): string | null => {
  const side = diffStore.get().get(tabKey(tab))?.list.result?.pair.new;
  return side?.type === 'tree' ? side.oid : null;
};

export const RESTORE_ACTION: MenuAction<DiffFileCtx> = {
  id: 'diff.restore', context: 'diff-file', label: 'Restore file to this version…', destructive: true,
  when: (c) => c.files.length === 1 && c.files[0].status !== 'D' && !c.files[0].submodule && newCommit(c.tab) !== null,
  run: (c) => { const oid = newCommit(c.tab); if (oid) void restoreFile(c.tab, oid, c.files[0].path); },
};

/** "Ignore 'name'" (untracked) or "Ignore and stop tracking 'name'…" (tracked): its label names the file. */
const ignoreAction = (kind: IgnoreKind, order: number): MenuAction<WorkdirFileCtx> => {
  const target = (c: WorkdirFileCtx) => ignoreTargets(c.file.path).find((x) => x.kind === kind);
  return {
    id: `workdir.ignore.${kind}`, context: 'workdir-file', group: 'ignore', order,
    label: (c) => (c.file.status === '?' ? `Ignore ${target(c)?.label}` : `Ignore and stop tracking ${target(c)?.label}…`),
    when: (c) => !!target(c),
    run: (c) => { const t = target(c); if (t) return ignore(c.tab, c.file, kind, t.value); },
  };
};

export const WORKDIR_FILE_ACTIONS: MenuAction<WorkdirFileCtx>[] = [
  { id: 'workdir.stage', context: 'workdir-file', label: 'Stage', when: (c) => c.section === 'unstaged', run: (c) => void stageFile(c.tab, c.file) },
  { id: 'workdir.unstage', context: 'workdir-file', label: 'Unstage', when: (c) => c.section === 'staged', run: (c) => void unstageFile(c.tab, c.file) },
  { id: 'workdir.discard', context: 'workdir-file', label: 'Discard…', destructive: true, when: (c) => c.section === 'unstaged' && canDiscard(c.file), run: (c) => discardFile(c.tab, c.file) },
  { id: 'workdir.copyPath', context: 'workdir-file', label: 'Copy path', run: (c) => navigator.clipboard?.writeText(c.file.path) },
  ignoreAction('path', 600), ignoreAction('ext', 601), ignoreAction('dir', 602),
];

/** C4's actions on the graph's menus: a WIP row's Changes panel, and the HEAD commit's message (order 300: history-rewriting). */
export const WORKDIR_GRAPH_ACTIONS: MenuAction<never>[] = [
  {
    id: 'workdir.wip.changes', context: CONTEXT.wip, label: 'Show changes', group: 'view', order: 780,
    run: (c: WipCtx) => openWip(c.tab, c.checkout),
  },
  {
    id: 'workdir.commit.editHeadMessage', context: CONTEXT.commit, label: 'Edit HEAD message…', group: 'rewrite', order: 300,
    when: (c: CommitCtx) => !!c.commit.oid && getGraph(c.tab).refs?.head.oid === c.commit.oid,
    run: (c: CommitCtx) => openWorkingTree(c.tab, { amend: 'message' }),
  },
];
