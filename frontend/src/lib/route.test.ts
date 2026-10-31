import { afterEach, expect, test, vi } from 'vitest';
import { consumeLink, consumeMenuTarget, readLink, readMenuTarget } from './route';

afterEach(() => vi.restoreAllMocks());

const A = 'a'.repeat(40);
const B = 'b'.repeat(64);

test('readLink accepts a full SHA-1 or SHA-256 oid with a project', () => {
  expect(readLink(`?project=p&commit=${A}`)).toEqual({ commit: A });
  expect(readLink(`?project=p&worktree=w&commit=${B}`)).toEqual({ commit: B });
});

test('readLink refuses an abbreviated, uppercase, non-hex or empty commit, and a link without a project', () => {
  for (const q of [`?project=p&commit=${A.slice(1)}`, `?project=p&commit=${A.toUpperCase()}`, `?project=p&commit=${'g'.repeat(40)}`,
    '?project=p&commit=', `?commit=${A}`, `?project=&commit=${A}`, `?project=p&commit=${A}0`]) expect(readLink(q), q).toBeNull();
});

test('readLink keeps a valid path beside the commit', () => {
  expect(readLink(`?project=p&commit=${A}&path=src/a%20b.ts`)).toEqual({ commit: A, path: 'src/a b.ts' });
});

test('readLink drops a path the backend would refuse but keeps the commit', () => {
  for (const p of ['/abs', 'a/../b', '..', 'a%5Cb', 'a%00b', '', 'x'.repeat(4097)]) {
    expect(readLink(`?project=p&commit=${A}&path=${p}`), p).toEqual({ commit: A });
  }
});

test('readLink: a path without a valid commit is no link', () => {
  expect(readLink('?project=p&path=a.txt')).toBeNull();
  expect(readLink('?project=p&commit=xyz&path=a.txt')).toBeNull();
});

test('readLink never throws on a malformed percent-encoding', () => {
  expect(() => readLink(`?project=p&commit=${A}&path=%E0%A4%A`)).not.toThrow();
  expect(readLink(`?project=%&commit=${A}`)).toEqual({ commit: A });
});

test('consumeLink strips commit and path in place, keeping the tab keys, without a history entry', () => {
  history.replaceState(null, '', `?project=p&worktree=w&sub=s&commit=${A}&path=a.txt`);
  const before = history.length;
  expect(consumeLink()).toEqual({ commit: A, path: 'a.txt' });
  expect(location.search).toBe('?project=p&worktree=w&sub=s');
  expect(history.length).toBe(before);
});

test('consumeLink strips invalid keys too', () => {
  history.replaceState(null, '', '?project=p&commit=abc&path=../x');
  expect(consumeLink()).toBeNull();
  expect(location.search).toBe('?project=p');
});

test('consumeLink strips a path that came without a commit', () => {
  history.replaceState(null, '', '?project=p&path=a.txt');
  expect(consumeLink()).toBeNull();
  expect(location.search).toBe('?project=p');
});

test('consumeLink leaves a URL without link keys alone', () => {
  history.replaceState(null, '', '?project=p&worktree=w');
  const replace = vi.spyOn(history, 'replaceState');
  const push = vi.spyOn(history, 'pushState');
  expect(consumeLink()).toBeNull();
  expect(location.search).toBe('?project=p&worktree=w');
  expect(replace).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

// ---- cc row ⋮ menu keys (readMenuTarget / consumeMenuTarget) ----

// Invariant: only cc's two keys make a menu target; an empty value is absent; code-git's own route is not one.
test('readMenuTarget reads ccProject/ccWorktree only', () => {
  expect(readMenuTarget('?ccProject=a')).toEqual({ project: 'a', worktree: null });
  expect(readMenuTarget('?ccProject=a&ccWorktree=w')).toEqual({ project: 'a', worktree: 'w' });
  expect(readMenuTarget('?ccWorktree=w')).toEqual({ project: null, worktree: 'w' });
  expect(readMenuTarget('?ccProject=')).toEqual({ project: null, worktree: null });
  expect(readMenuTarget('?ccProject=a&ccWorktree=')).toEqual({ project: 'a', worktree: null });
  expect(readMenuTarget('?project=a')).toBeNull();
  expect(readMenuTarget('')).toBeNull();
  expect(readMenuTarget('?ccProject=a%20b&ccWorktree=w%2Fx')).toEqual({ project: 'a b', worktree: 'w/x' });
});

test('consumeMenuTarget replaces the URL in place with the active tab\'s route, a submodule chain included', () => {
  history.replaceState(null, '', '?ccProject=a&ccWorktree=w');
  const before = history.length;
  expect(consumeMenuTarget({ project: 'kept', worktree: 'k', sub: ['libs/a'] })).toEqual({ project: 'a', worktree: 'w' });
  expect(location.search).toBe('?project=kept&worktree=k&sub=libs%2Fa');
  expect(history.length).toBe(before);
});

test('consumeMenuTarget with no active tab replaces the URL with the bare pathname', () => {
  history.replaceState(null, '', '/app/?ccProject=a');
  const before = history.length;
  expect(consumeMenuTarget(null)).toEqual({ project: 'a', worktree: null });
  expect(location.search).toBe('');
  expect(location.pathname).toBe('/app/');
  expect(history.length).toBe(before);
});

test('consumeMenuTarget drops tab and link keys that sit beside the cc keys', () => {
  history.replaceState(null, '', `?project=p&worktree=w&sub=s&commit=${A}&path=a.txt&ccProject=a`);
  expect(consumeMenuTarget({ project: 'kept', worktree: null })).toEqual({ project: 'a', worktree: null });
  expect(location.search).toBe('?project=kept');
});

test('consumeMenuTarget leaves a URL without cc keys alone', () => {
  history.replaceState(null, '', `?project=p&commit=${A}`);
  const replace = vi.spyOn(history, 'replaceState');
  const push = vi.spyOn(history, 'pushState');
  expect(consumeMenuTarget({ project: 'kept', worktree: null })).toBeNull();
  expect(location.search).toBe(`?project=p&commit=${A}`);
  expect(replace).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});
