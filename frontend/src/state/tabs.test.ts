import { describe, expect, test } from 'vitest';
import { readRoute, routeSearch, writeRoute } from '@/lib/route';
import { dispatchTabs, EMPTY, loadTabs, parentTab, prefsKey, refsKey, tabKey, tabsReducer, tabsStore, type TabsState } from './tabs';

const t = (project: string, worktree: string | null = null) => ({ project, worktree });
const S = (n: number, active: number): TabsState => ({ open: Array.from({ length: n }, (_, i) => t(`p${i}`)), active });

describe('tabsReducer', () => {
  test('open appends and activates; reopening an open checkout activates it instead of duplicating', () => {
    let s = tabsReducer(EMPTY, { type: 'open', tab: t('a') });
    s = tabsReducer(s, { type: 'open', tab: t('a', 'wt') });
    expect(s).toEqual({ open: [t('a'), t('a', 'wt')], active: 1 });
    s = tabsReducer(s, { type: 'open', tab: t('a') });
    expect(s).toEqual({ open: [t('a'), t('a', 'wt')], active: 0 });
    expect(tabsReducer(s, { type: 'open', tab: t('a') })).toBe(s);
  });

  test('open normalises a missing worktree to the main checkout', () => {
    const s = tabsReducer(EMPTY, { type: 'open', tab: { project: 'a' } as never });
    expect(s.open[0]).toEqual(t('a'));
  });

  test('close picks a neighbour: the right one, else the left; closing before the active shifts it; the last close empties', () => {
    expect(tabsReducer(S(3, 1), { type: 'close', index: 1 })).toEqual({ open: [t('p0'), t('p2')], active: 1 });
    expect(tabsReducer(S(3, 2), { type: 'close', index: 2 })).toEqual({ open: [t('p0'), t('p1')], active: 1 });
    expect(tabsReducer(S(3, 2), { type: 'close', index: 0 })).toEqual({ open: [t('p1'), t('p2')], active: 1 });
    expect(tabsReducer(S(3, 0), { type: 'close', index: 2 })).toEqual({ open: [t('p0'), t('p1')], active: 0 });
    expect(tabsReducer(S(1, 0), { type: 'close', index: 0 })).toEqual(EMPTY);
    const s = S(2, 0);
    expect(tabsReducer(s, { type: 'close', index: 5 })).toBe(s);
    expect(tabsReducer(s, { type: 'close', index: -1 })).toBe(s);
  });

  test('closeOthers keeps only that tab', () => {
    expect(tabsReducer(S(3, 0), { type: 'closeOthers', index: 2 })).toEqual({ open: [t('p2')], active: 0 });
    const s = S(2, 0);
    expect(tabsReducer(s, { type: 'closeOthers', index: 4 })).toBe(s);
  });

  test('activateIndex activates an existing index and ignores one out of range', () => {
    expect(tabsReducer(S(3, 0), { type: 'activateIndex', index: 2 }).active).toBe(2);
    const s = S(3, 0);
    expect(tabsReducer(s, { type: 'activateIndex', index: 3 })).toBe(s);
    expect(tabsReducer(s, { type: 'activateIndex', index: -1 })).toBe(s);
  });

  test('move reorders and keeps the same tab active', () => {
    expect(tabsReducer(S(3, 0), { type: 'move', from: 0, to: 2 })).toEqual({ open: [t('p1'), t('p2'), t('p0')], active: 2 });
    expect(tabsReducer(S(3, 1), { type: 'move', from: 2, to: 0 })).toEqual({ open: [t('p2'), t('p0'), t('p1')], active: 2 });
    const s = S(2, 0);
    expect(tabsReducer(s, { type: 'move', from: 0, to: 5 })).toBe(s);
  });

  test('tabKey never collides across the project/worktree boundary', () => {
    expect(tabKey(t('ab'))).not.toBe(tabKey(t('a', 'b')));
    expect(tabKey(t('a', 'bc'))).not.toBe(tabKey(t('ab', 'c')));
  });

  test('tabKey separates project and worktree unambiguously', () => {
    expect(tabKey(t('a', 'b'))).not.toBe(tabKey(t('a\0b')));
    expect(tabKey(t('a'))).not.toBe(tabKey(t('a', 'main')));
  });
});

describe('persistence', () => {
  test('tabs persist under code-git:tabs and load back', () => {
    dispatchTabs({ type: 'open', tab: t('a') });
    dispatchTabs({ type: 'open', tab: t('b', 'wt') });
    expect(JSON.parse(localStorage.getItem('code-git:tabs')!)).toEqual({ open: [t('a'), t('b', 'wt')], active: 1 });
    expect(Object.keys(localStorage).every((k) => k.startsWith('code-git:'))).toBe(true);
    tabsStore.set(EMPTY);
    localStorage.setItem('code-git:tabs', JSON.stringify({ open: [t('a'), t('b', 'wt')], active: 1 }));
    expect(loadTabs()).toEqual({ open: [t('a'), t('b', 'wt')], active: 1 });
  });

  test('malformed storage loads as no tabs; bad rows are dropped and a bad active falls back to 0', () => {
    for (const raw of ['not json', 'null', '{"open":3}', '{"open":[]}']) {
      localStorage.setItem('code-git:tabs', raw);
      expect(loadTabs()).toEqual(EMPTY);
    }
    localStorage.setItem('code-git:tabs', JSON.stringify({ open: [{ project: '' }, t('ok'), { project: 'x', worktree: 3 }], active: 7 }));
    expect(loadTabs()).toEqual({ open: [t('ok')], active: 0 });
  });
});

describe('query-string route', () => {
  test('round-trips a checkout through the query string', () => {
    for (const tab of [t('a'), t('a b&c', 'wt/1')]) expect(readRoute(routeSearch(tab))).toEqual(tab);
    expect(routeSearch(null)).toBe('');
    expect(readRoute('')).toBeNull();
    expect(readRoute('?worktree=x')).toBeNull();
  });

  test('writeRoute pushes only on change and never uses the hash', () => {
    const before = history.length;
    writeRoute(t('a', 'wt'));
    expect(location.search).toBe('?project=a&worktree=wt');
    expect(history.length).toBe(before + 1);
    writeRoute(t('a', 'wt'));
    expect(history.length).toBe(before + 1);
    expect(location.hash).toBe('');
  });
});

describe('submodule tabs', () => {
  const sub = (s: string[], worktree: string | null = null) => ({ project: 'a', worktree, sub: s });

  test('tabKey distinguishes sub chains and keeps root keys unchanged', () => {
    expect(tabKey(t('a'))).toBe('a\0');
    expect(tabKey(t('a', 'wt'))).toBe('a\0wt');
    const keys = [t('a'), sub(['x']), sub(['x', 'y']), sub(['x/y']), sub(['x'], 'wt'), t('a', 'wt'), sub(['y', 'x'])].map(tabKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(tabKey(sub(['libs/a', 'b']))).toBe('a\0\0libs/a\0b');
  });

  test('open keeps sub (a copy); an empty or malformed sub opens the checkout', () => {
    const chain = ['libs/a'];
    const s = tabsReducer(EMPTY, { type: 'open', tab: sub(chain) });
    chain.push('b');
    expect(s.open[0]).toEqual(sub(['libs/a']));
    const again = tabsReducer(s, { type: 'open', tab: t('a') });
    expect(again.open).toEqual([sub(['libs/a']), t('a')]);
    for (const bad of [[], [''], Array(9).fill('x'), 'x', [1]]) {
      expect(tabsReducer(EMPTY, { type: 'open', tab: { project: 'a', worktree: null, sub: bad } as never }).open[0]).toEqual(t('a'));
    }
  });

  test('loadTabs drops malformed sub (keeps the good rows)', () => {
    localStorage.setItem('code-git:tabs', JSON.stringify({ open: [sub(['x', 'y']), { ...t('a'), sub: [] }, { ...t('b'), sub: 'x' }, { ...t('c'), sub: [''] },
      { ...t('d'), sub: Array(9).fill('x') }, { ...t('e'), sub: [3] }, t('f')], active: 1 }));
    expect(loadTabs()).toEqual({ open: [sub(['x', 'y']), t('f')], active: 1 });
  });

  test('parentTab drops the last chain entry; refsKey and prefsKey are the project for a checkout, the repo for a submodule', () => {
    expect(parentTab(sub(['x', 'y'], 'wt'))).toEqual(sub(['x'], 'wt'));
    expect(parentTab(sub(['x'], 'wt'))).toEqual(t('a', 'wt'));
    expect('sub' in parentTab(sub(['x']))).toBe(false);
    expect(refsKey(t('a', 'wt'))).toBe('a');
    expect(refsKey(sub(['x'], 'wt'))).toBe(tabKey(sub(['x'], 'wt')));
    expect(refsKey(sub(['x']))).not.toBe(refsKey(sub(['x'], 'wt')));
    expect(prefsKey(t('a', 'wt'))).toBe('a');
    expect(prefsKey(sub(['libs/a', 'b']))).toBe('a\0libs/a\0b');
  });

  test('prefsKey: chains that join to the same path differ; a checkout\'s key stays the bare project name', () => {
    expect(prefsKey(sub(['a/b']))).not.toBe(prefsKey(sub(['a', 'b'])));
    expect(prefsKey(t('app'))).toBe('app');
    expect(prefsKey(t('app', 'wt'))).toBe('app');
    expect(prefsKey(sub(['x']))).not.toBe(prefsKey(t('a')));
  });

  test('sub round-trips as repeated params', () => {
    const tab = sub(['libs/a', 'b c&d']);
    expect(routeSearch(tab)).toBe('?project=a&sub=libs%2Fa&sub=b+c%26d');
    expect(readRoute(routeSearch(tab))).toEqual(tab);
    expect(readRoute(routeSearch({ ...tab, worktree: 'wt' }))).toEqual({ ...tab, worktree: 'wt' });
    expect('sub' in readRoute('?project=a&sub=')!).toBe(false);
  });
});
