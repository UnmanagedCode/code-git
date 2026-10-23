import { expect, test } from 'vitest';
import { BASE, I, stashFx, U, W } from '@/test/stashWorld';
import { messageOf, stashViewOf, stashViewSource, viewsOf } from './views';

test('each view\'s exact source: all → W against parent 1 (the base), Staged → I, Untracked → U', () => {
  const s = stashFx();
  expect(stashViewSource(s, 'all')).toEqual({ kind: 'commit', rev: W, parent: 1 });
  expect(stashViewSource(s, 'staged')).toEqual({ kind: 'commit', rev: I });
  expect(stashViewSource(s, 'untracked')).toEqual({ kind: 'commit', rev: U });
});

test('Untracked is offered only when the stash has a third parent', () => {
  expect(viewsOf(stashFx())).toEqual(['all', 'staged', 'untracked']);
  expect(viewsOf(stashFx({ parents: [BASE, I] }))).toEqual(['all', 'staged']);
});

test('stashViewOf recognises a stash\'s W, I and U oids, and nothing else (the base included)', () => {
  const s = stashFx();
  const other = stashFx({ oid: 'f'.repeat(40), parents: [BASE, '9'.repeat(40)], selector: 'stash@{1}' });
  expect(stashViewOf([other, s], W)).toEqual({ stash: s, view: 'all' });
  expect(stashViewOf([other, s], I)).toEqual({ stash: s, view: 'staged' });
  expect(stashViewOf([other, s], U)).toEqual({ stash: s, view: 'untracked' });
  expect(stashViewOf([other, s], '9'.repeat(40))).toEqual({ stash: other, view: 'staged' });
  expect(stashViewOf([other, s], BASE)).toBeNull();
  expect(stashViewOf([], W)).toBeNull();
});

test('messageOf strips the prefix git writes, and only that', () => {
  expect(messageOf('On main: my work')).toBe('my work');
  expect(messageOf('WIP on feature/x: 1234567 subject: with colon')).toBe('1234567 subject: with colon');
  expect(messageOf('custom: text')).toBe('custom: text');
});
