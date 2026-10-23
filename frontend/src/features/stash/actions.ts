import type { DiffFileCtx } from '@/features/diff/actions';
import { CONTEXT, type FileCtx, type StashCtx, type WipCtx } from '@/features/graph/contexts';
import type { Stash } from '@/features/graph/types';
import type { WorkdirFileCtx } from '@/features/workdir/actions';
import { confirm } from '@/lib/confirm';
import type { MenuAction } from '@/shell/menus';
import { openStashDialog, type SavePreset } from '@/state/stashDialog';
import type { Tab } from '@/state/tabs';
import { stashApply, stashApplyFile, stashDrop, stashPop } from './api';
import { appliedToast, runStashOp } from './run';
import { stashesOf, stashViewOf } from './views';

// The stash's menu actions (docs/features.md → Stash), group 'stash', orders 400+. Only Drop asks first: git refuses to
// overwrite local changes on apply and pop (CHECKOUT_CONFLICT), and a conflict only adds markers to files that were clean.

export const openStashSave = (tab: Tab, preset: SavePreset): void => openStashDialog({ kind: 'save', tab, preset });

export const applyStash = (tab: Tab, stash: Stash, index = false) => runStashOp(tab, {
  running: `Applying ${stash.selector}…`,
  done: (r) => appliedToast(`Applied ${stash.selector}`, stash.selector, r.conflicts, false),
}, () => stashApply(tab, stash.oid, index));

export const popStash = (tab: Tab, stash: Stash) => runStashOp(tab, {
  running: `Popping ${stash.selector}…`,
  done: (r) => {
    if (r.conflicts.length) return appliedToast('', stash.selector, r.conflicts, true);
    if (!r.dropped) return { tone: 'warning', title: `Applied ${stash.selector}; it was not dropped`, description: 'The stash list changed meanwhile: drop it yourself once you have checked it.' };
    return `Popped ${stash.selector}`;
  },
}, () => stashPop(tab, stash.oid));

export async function dropStash(tab: Tab, stash: Stash): Promise<void> {
  const ok = await confirm({ title: `Drop ${stash.selector}?`, body: stash.subject, confirmLabel: 'Drop stash' });
  if (!ok) return;
  await runStashOp(tab, { running: `Dropping ${stash.selector}…`, done: () => `Dropped ${stash.selector}` }, () => stashDrop(tab, stash.oid));
}

export const applyStashFile = (tab: Tab, stash: Stash, path: string) => runStashOp(tab, {
  running: `Applying ${path} from ${stash.selector}…`, done: () => `Applied ${path} from ${stash.selector}`,
}, () => stashApplyFile(tab, stash.oid, path));

const stashOfCommit = (tab: Tab, oid: string): Stash | null => stashesOf(tab).find((s) => s.oid === oid) ?? null;
/** The stash a one-file diff menu applies from: the diff shows a stash's All changes or Untracked view. */
const stashOfDiff = (c: DiffFileCtx): Stash | null => {
  if (c.files.length !== 1 || c.source.kind !== 'commit') return null;
  const v = stashViewOf(stashesOf(c.tab), c.source.rev);
  return v && v.view !== 'staged' ? v.stash : null;
};

const S = { group: 'stash' } as const;
export const STASH_ACTIONS: MenuAction<never>[] = [
  { ...S, id: 'stash.apply', context: CONTEXT.stash, label: 'Apply', order: 400, run: (c: StashCtx) => void applyStash(c.tab, c.stash) },
  { ...S, id: 'stash.applyIndex', context: CONTEXT.stash, label: 'Apply with staged changes', order: 401, run: (c: StashCtx) => void applyStash(c.tab, c.stash, true) },
  { ...S, id: 'stash.pop', context: CONTEXT.stash, label: 'Pop', order: 402, run: (c: StashCtx) => void popStash(c.tab, c.stash) },
  { ...S, id: 'stash.branch', context: CONTEXT.stash, label: 'Create branch…', order: 403, run: (c: StashCtx) => openStashDialog({ kind: 'branch', tab: c.tab, stash: c.stash }) },
  { ...S, id: 'stash.rename', context: CONTEXT.stash, label: 'Rename…', order: 404, run: (c: StashCtx) => openStashDialog({ kind: 'rename', tab: c.tab, stash: c.stash }) },
  { ...S, id: 'stash.drop', context: CONTEXT.stash, label: 'Drop…', order: 405, destructive: true, run: (c: StashCtx) => dropStash(c.tab, c.stash) },
  { ...S, id: 'stash.save.wip', context: CONTEXT.wip, label: 'Stash changes…', order: 400, when: (c: WipCtx) => c.isOwn, run: (c: WipCtx) => openStashSave(c.tab, { mode: 'all' }) },
  {
    ...S, id: 'stash.save.file', context: 'workdir-file', label: 'Stash this file…', order: 400,
    run: (c: WorkdirFileCtx) => openStashSave(c.tab, { mode: 'files', paths: [c.file.path] }),
  },
  {
    ...S, id: 'stash.applyFile.details', context: CONTEXT.file, label: 'Apply this file', order: 400,
    when: (c: FileCtx) => stashOfCommit(c.tab, c.commit) !== null,
    run: (c: FileCtx) => { const s = stashOfCommit(c.tab, c.commit); if (s) void applyStashFile(c.tab, s, c.file.path); },
  },
  {
    ...S, id: 'stash.applyFile.diff', context: 'diff-file', label: 'Apply file from stash', order: 400,
    when: (c: DiffFileCtx) => stashOfDiff(c) !== null,
    run: (c: DiffFileCtx) => { const s = stashOfDiff(c); if (s) void applyStashFile(c.tab, s, c.files[0].path); },
  },
] as MenuAction<never>[];
