import { expect, test } from 'vitest';
import { diffStore } from '@/state/diff';
import { fileIntentStore, requestFileOpen } from '@/state/graphSelection';
import { shownPanelStore } from '@/state/shownPanel';
import { tabsStore } from '@/state/tabs';
import { checkout, oid } from '@/test/graphData';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { openIn, selectionDiff, wipSource } from './diffWiring';

const TAB = { project: 'app', worktree: null };
const WT = { project: 'app', worktree: 'wt' };
const dirty = (n: Partial<{ staged: number; unstaged: number; untracked: number; conflicted: number }>) => ({ staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ...n });

test('one commit or stash opens that commit against its first parent', () => {
  expect(selectionDiff(TAB, [{ kind: 'commit', oid: oid(1) }], [])).toEqual({ target: TAB, source: { kind: 'commit', rev: oid(1) } });
  expect(selectionDiff(TAB, [{ kind: 'stash', oid: oid(9) }], [])).toEqual({ target: TAB, source: { kind: 'commit', rev: oid(9) } });
});

test('a WIP row opens its own checkout: unstaged, or staged when only staged changes are pending', () => {
  const own = checkout(null, { counts: dirty({ unstaged: 1 }) });
  const other = checkout('wt', { counts: dirty({ staged: 2 }) });
  expect(selectionDiff(TAB, [{ kind: 'wip', checkout: TAB }], [own, other])).toEqual({ target: TAB, source: { kind: 'unstaged' } });
  expect(selectionDiff(TAB, [{ kind: 'wip', checkout: WT }], [own, other])).toEqual({ target: WT, source: { kind: 'staged' } });
  expect(wipSource(checkout(null, { counts: dirty({ staged: 1, untracked: 1 }) }))).toEqual({ kind: 'unstaged' });
  expect(wipSource(undefined)).toEqual({ kind: 'unstaged' });
});

test('several commits give the commits source, with wip when the own WIP row is in it; stashes or another WIP give none', () => {
  const two = [{ kind: 'commit' as const, oid: oid(3) }, { kind: 'commit' as const, oid: oid(2) }];
  expect(selectionDiff(TAB, two, [])).toEqual({ target: TAB, source: { kind: 'commits', oids: [oid(3), oid(2)], wip: false } });
  expect(selectionDiff(TAB, [{ kind: 'wip', checkout: TAB }, ...two], [])!.source).toEqual({ kind: 'commits', oids: [oid(3), oid(2)], wip: true });
  expect(selectionDiff(TAB, [...two, { kind: 'stash', oid: oid(9) }], [])).toBeNull();
  expect(selectionDiff(TAB, [{ kind: 'wip', checkout: WT }, ...two], [])).toBeNull();
  expect(selectionDiff(TAB, [{ kind: 'wip', checkout: TAB }, { kind: 'wip', checkout: WT }], [])).toBeNull();
});

test('a file-open intent opens that commit at that file in the diff panel', () => {
  stubGraph(linearWorld(2));
  requestFileOpen({ tab: TAB, commit: oid(2), parent: oid(1), path: 'src/a.ts', oldPath: null });
  expect(shownPanelStore.get().get('app\0')).toBe('diff');
  expect(diffStore.get().get('app\0')).toMatchObject({ source: { kind: 'commit', rev: oid(2) }, viewed: 'src/a.ts' });
  fileIntentStore.set(null);
  expect(shownPanelStore.get().get('app\0')).toBe('diff');
});

test("another checkout's diff opens in that checkout's tab", () => {
  stubGraph(linearWorld(2));
  openIn(TAB, WT, { kind: 'unstaged' });
  expect(tabsStore.get().open).toEqual([WT]);
  expect(diffStore.get().get('app\0wt')!.source).toEqual({ kind: 'unstaged' });
  expect(diffStore.get().has('app\0')).toBe(false);
});
