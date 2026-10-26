import { afterEach, expect, test, vi } from 'vitest';
import { consumeLink, readLink } from './route';

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

test('consumeLink leaves a URL without link keys alone', () => {
  history.replaceState(null, '', '?project=p&worktree=w');
  const replace = vi.spyOn(history, 'replaceState');
  const push = vi.spyOn(history, 'pushState');
  expect(consumeLink()).toBeNull();
  expect(location.search).toBe('?project=p&worktree=w');
  expect(replace).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});
