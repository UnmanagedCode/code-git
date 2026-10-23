import { expect, test } from 'vitest';
import { COLUMN_IDS, COLUMNS } from '@/features/graph/columns';
import { DEFAULT_PREFS, getPrefs, loadPrefs, resetGraphPrefs, toggled, updatePrefs, validatePrefs } from './graphPrefs';
import { prefsKey } from './tabs';

test('prefs persist per project under code-git:graph:<project>; two projects are independent', () => {
  updatePrefs('a', (p) => ({ ...p, hidden: ['refs/heads/x'] }));
  updatePrefs('b', (p) => ({ ...p, pinned: ['refs/heads/y'] }));
  expect(JSON.parse(localStorage.getItem('code-git:graph:a')!).hidden).toEqual(['refs/heads/x']);
  resetGraphPrefs();
  expect(getPrefs('a').hidden).toEqual(['refs/heads/x']);
  expect(getPrefs('a').pinned).toEqual([]);
  expect(getPrefs('b').pinned).toEqual(['refs/heads/y']);
  expect(getPrefs('c')).toEqual(DEFAULT_PREFS);
});

test('malformed storage loads the defaults', () => {
  for (const raw of ['not json', 'null', '[]', '"x"', '3']) {
    localStorage.setItem('code-git:graph:p', raw);
    expect(loadPrefs('p')).toEqual(DEFAULT_PREFS);
  }
});

test('ill-typed entries are dropped, unknown sections refused, column order repaired and widths clamped', () => {
  const p = validatePrefs({
    hidden: ['refs/heads/a', 3, '', 'refs/heads/a', null], hiddenSections: ['tags', 'nope'], soloedSections: ['stashes', 'local'],
    pinned: 'refs/heads/x',
    columns: { order: ['sha', 'bogus', 'graph', 'sha'], visible: ['sha', 'graph', 'x'], widths: { author: 1e6, sha: -5, message: 500, bogus: 3, date: 'wide' } },
  });
  expect(p.hidden).toEqual(['refs/heads/a']);
  expect(p.hiddenSections).toEqual(['tags']);
  expect(p.soloedSections).toEqual(['local']);
  expect(p.pinned).toEqual([]);
  expect(p.columns.order).toEqual(['sha', 'graph', ...COLUMN_IDS.filter((c) => c !== 'sha' && c !== 'graph')]);
  expect(p.columns.visible).toEqual(['sha']);
  expect(p.columns.widths).toEqual({ author: COLUMNS.author.max, sha: COLUMNS.sha.min });
});

test('toggled adds once at the end or removes', () => {
  expect(toggled(['a'], 'b', true)).toEqual(['a', 'b']);
  expect(toggled(['a', 'b'], 'a', true)).toEqual(['a', 'b']);
  expect(toggled(['a', 'b'], 'a', false)).toEqual(['b']);
});

test("sub prefs key: a submodule's prefs persist under code-git:graph:<project>/<chain>, apart from its project's", () => {
  const SUB = { project: 'a', worktree: null, sub: ['libs/x', 'y'] };
  updatePrefs(prefsKey(SUB), (p) => ({ ...p, hidden: ['refs/heads/s'] }));
  expect(JSON.parse(localStorage.getItem('code-git:graph:a/libs/x/y')!).hidden).toEqual(['refs/heads/s']);
  expect(getPrefs(prefsKey({ project: 'a', worktree: null })).hidden).toEqual([]);
  expect(getPrefs(prefsKey({ ...SUB, worktree: 'wt' })).hidden).toEqual(['refs/heads/s']);
});
