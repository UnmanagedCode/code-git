import { expect, test } from 'vitest';
import { dfile, filesResult } from '@/test/diffFixtures';
import { stubFetch } from '@/test/stubFetch';
import { diffStore, loadList, setSelection, startDiff } from './diff';

const TAB = { project: 'app', worktree: null };
const state = () => diffStore.get().get('app\0')!;

/** diff.files answers `paths`, only once released. */
function held(paths: string[]) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  stubFetch({ 'POST api/ops/diff.files': async () => { await gate; return { ok: true, result: filesResult(paths.map((path) => dfile({ path }))) }; } });
  return async () => { release(); await gate; await new Promise((r) => setTimeout(r, 0)); };
}

test('a pick made while the list loads wins when listed, keeping the listed part of its selection', async () => {
  const release = held(['a', 'b', 'c']);
  startDiff(TAB, { kind: 'unstaged' }, { path: 'a' });
  setSelection(TAB, ['c', 'gone', 'b'], 'b');
  const done = loadList(TAB);
  await release();
  await done;
  expect(state()).toMatchObject({ viewed: 'b', selected: ['c', 'b'] });
});

test('a picked file whose selection is all unlisted gets itself selected', async () => {
  const release = held(['a', 'b']);
  startDiff(TAB, { kind: 'unstaged' });
  setSelection(TAB, ['gone'], 'b');
  await release();
  await new Promise((r) => setTimeout(r, 0));
  expect(state()).toMatchObject({ viewed: 'b', selected: ['b'] });
});

test('an unlisted pick falls back to the path the load started with, else the first file', async () => {
  const release = held(['a', 'b']);
  startDiff(TAB, { kind: 'unstaged' }, { path: 'b' });
  const load = loadList(TAB, 'b');
  setSelection(TAB, ['gone'], 'gone');
  await release();
  await load;
  expect(state()).toMatchObject({ viewed: 'b', selected: ['b'] });
  const again = held(['x', 'y']);
  const reload = loadList(TAB);
  await again();
  await reload;
  expect(state()).toMatchObject({ viewed: 'x', selected: ['x'] });
});
