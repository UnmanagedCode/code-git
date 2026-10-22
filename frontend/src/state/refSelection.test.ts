import { expect, test } from 'vitest';
import { ref } from '@/test/graphData';
import { dispatchRefSelection, NO_SELECTION, refSelectionReducer, selectedRefs, getRefSelection } from './refSelection';

const ORDER = ['refs/heads/a', 'refs/heads/b', 'refs/heads/c', 'refs/remotes/origin/d'];
const T = { project: 'app', worktree: null };

test('toggle adds and removes a name and moves the anchor to it', () => {
  let s = refSelectionReducer(NO_SELECTION, { type: 'toggle', name: 'refs/heads/a' });
  s = refSelectionReducer(s, { type: 'toggle', name: 'refs/heads/c' });
  expect(s).toEqual({ names: ['refs/heads/a', 'refs/heads/c'], anchor: 'refs/heads/c' });
  s = refSelectionReducer(s, { type: 'toggle', name: 'refs/heads/a' });
  expect(s).toEqual({ names: ['refs/heads/c'], anchor: 'refs/heads/a' });
});

test('range selects the displayed rows from the anchor to the name, either direction, and keeps the anchor', () => {
  const s = refSelectionReducer(NO_SELECTION, { type: 'toggle', name: 'refs/heads/b' });
  const down = refSelectionReducer(s, { type: 'range', name: 'refs/remotes/origin/d', order: ORDER });
  expect(down).toEqual({ names: ['refs/heads/b', 'refs/heads/c', 'refs/remotes/origin/d'], anchor: 'refs/heads/b' });
  const up = refSelectionReducer(down, { type: 'range', name: 'refs/heads/a', order: ORDER });
  expect(up).toEqual({ names: ['refs/heads/a', 'refs/heads/b'], anchor: 'refs/heads/b' });
});

test('range without a displayed anchor starts a selection at the name; an undisplayed name changes nothing', () => {
  expect(refSelectionReducer(NO_SELECTION, { type: 'range', name: 'refs/heads/c', order: ORDER })).toEqual({ names: ['refs/heads/c'], anchor: 'refs/heads/c' });
  const filtered = refSelectionReducer({ names: ['refs/heads/x'], anchor: 'refs/heads/x' }, { type: 'range', name: 'refs/heads/a', order: ORDER });
  expect(filtered).toEqual({ names: ['refs/heads/a'], anchor: 'refs/heads/a' });
  const s = { names: ['refs/heads/a'], anchor: 'refs/heads/a' };
  expect(refSelectionReducer(s, { type: 'range', name: 'refs/heads/zz', order: ORDER })).toBe(s);
});

test('clear empties the selection and its anchor', () => {
  expect(refSelectionReducer({ names: ['refs/heads/a'], anchor: 'refs/heads/a' }, { type: 'clear' })).toEqual(NO_SELECTION);
});

test('selectedRefs drops names no longer among the refs, per tab', () => {
  dispatchRefSelection(T, { type: 'toggle', name: 'refs/heads/a' });
  dispatchRefSelection(T, { type: 'toggle', name: 'refs/heads/gone' });
  expect(getRefSelection({ project: 'app', worktree: 'wt' })).toEqual(NO_SELECTION);
  expect(selectedRefs(T, [ref('refs/heads/a', 'x'), ref('refs/heads/b', 'y')]).map((r) => r.name)).toEqual(['refs/heads/a']);
});
