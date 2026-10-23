import { act, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { FileStatus } from '@/features/diff/api';
import type { Conflict } from '@/features/sequence/api';
import type { WorkdirFileCtx } from '@/features/workdir/actions';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { labelOf, resolveActions, type MenuAction } from '@/shell/menus';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { shownPanelStore } from '@/state/shownPanel';
import { tabKey } from '@/state/tabs';
import { workdirOf, workdirStore } from '@/state/workdir';
import { dfile } from '@/test/diffFixtures';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { ref, refsResult } from '@/test/graphData';
import { CONFLICT_FILE_ACTIONS } from './actions';
import { takeSide } from './flows';

const T = { project: 'app', worktree: null };
const OID = (c: string) => c.repeat(40);
const ctx = (path: string, status: FileStatus = 'U'): WorkdirFileCtx => ({ tab: T, file: dfile({ path, status }), section: 'unstaged' });
const items = (c: WorkdirFileCtx) => resolveActions(CONFLICT_FILE_ACTIONS as unknown as MenuAction<WorkdirFileCtx>[], 'workdir-file', c);
const side = { mode: '100644', oid: OID('1') };
const conflicts: Conflict[] = [
  { path: 'a.txt', kind: 'bothModified', base: side, ours: side, theirs: side },
  { path: 'gone.txt', kind: 'deletedByThem', base: side, ours: side, theirs: null },
];

function setup() {
  graphStore.set(new Map([[tabKey(T), { ...EMPTY_GRAPH, status: 'ready', refs: refsResult({ head: { oid: OID('a'), branch: null, detached: true, unborn: false }, refs: [ref('refs/heads/main', OID('c'))] }) }]]));
  workdirStore.set(new Map([[tabKey(T), { ...workdirOf(T), conflicts, operation: { kind: 'rebase', incoming: { oid: OID('d'), subject: 'Fix it' }, rebase: { branch: 'refs/heads/topic', onto: OID('c'), step: 1, total: 2 } } }]]));
  return stubGraph(linearWorld(2), {
    'POST api/ops/conflict.take': { ok: true, result: { resolved: ['a.txt'], deleted: ['gone.txt'] } },
    'POST api/ops/conflict.read': { ok: true, result: { path: 'a.txt', kind: 'bothModified', content: 'binary', base: null, ours: null, theirs: null, worktree: null } },
    'POST api/ops/commit.state': { ok: true, result: { merging: false } },
  });
}

test('a conflicted (U) row offers Open in merge tool, Take current / incoming named per the operation, Mark resolved; another row none', () => {
  setup();
  expect(items(ctx('a.txt')).map((a) => labelOf(a, ctx('a.txt')))).toEqual([
    'Open in merge tool', 'Take current (main (rebased so far))', `Take incoming (${OID('d').slice(0, 7)} Fix it)`, 'Mark resolved',
  ]);
  expect(items(ctx('m.txt', 'M'))).toEqual([]);
});

test('Open in merge tool shows the tool for that path', async () => {
  setup();
  void items(ctx('a.txt'))[0].run!(ctx('a.txt'));
  await waitFor(() => expect(shownPanelStore.get().get(tabKey(T))).toBe('conflicts'));
});

test('Take asks first, listing the files and naming the ones the side deleted; Cancel sends nothing, Confirm posts conflict.take', async () => {
  const f = setup();
  const first = takeSide(T, ['a.txt', 'gone.txt'], 'theirs');
  await waitFor(() => expect(confirmStore.get()).not.toBeNull());
  expect(confirmStore.get()!.opts.items).toEqual(['a.txt', 'gone.txt (deleted)']);
  expect(confirmStore.get()!.opts.body).toContain('1 file that side deleted is deleted.');
  act(() => settleConfirm(false));
  await first;
  expect(paramsOf(f, 'POST api/ops/conflict.take')).toEqual([]);
  const second = takeSide(T, ['a.txt'], 'ours');
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Take current'));
  act(() => settleConfirm(true));
  await second;
  expect(paramsOf(f, 'POST api/ops/conflict.take')).toEqual([{ paths: ['a.txt'], side: 'ours' }]);
});
