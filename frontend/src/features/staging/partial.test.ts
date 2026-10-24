import { expect, test } from 'vitest';
import type { DiffSource } from '@/features/diff/api';
import { DEFAULT_PREFS } from '@/state/diff';
import { dfile, fdiff, hunk } from '@/test/diffFixtures';
import { canPartial } from './partial';

const D = fdiff([hunk(1, 1, ['-a', '+b'])]);
const UNSTAGED: DiffSource = { kind: 'unstaged' };

// Invariant: scope and layout never decide staging: an M text file of an unstaged or staged diff, whitespace shown,
// Diff view, gets hunk/line staging in all four combinations.
test('an M text file of an unstaged or staged diff, whitespace shown, Diff view: hunk/line staging in all four combinations', () => {
  for (const scope of ['hunk', 'full'] as const) {
    for (const layout of ['inline', 'split'] as const) {
      for (const source of [UNSTAGED, { kind: 'staged' } as DiffSource]) expect(canPartial(dfile(), D, { ...DEFAULT_PREFS, scope, layout }, source)).toBe(true);
    }
  }
});

// Invariant: every case the backend refuses PARTIAL_UNSUPPORTED (and Ignore whitespace on, in any combination) gets none.
test.each([
  ['an added file', dfile({ status: 'A' }), D, DEFAULT_PREFS, UNSTAGED],
  ['an untracked file', dfile({ status: '?' }), D, DEFAULT_PREFS, UNSTAGED],
  ['a deleted file', dfile({ status: 'D' }), D, DEFAULT_PREFS, UNSTAGED],
  ['a rename', dfile({ status: 'R', oldPath: 'o' }), D, DEFAULT_PREFS, UNSTAGED],
  ['a type change', dfile({ status: 'T' }), D, DEFAULT_PREFS, UNSTAGED],
  ['a conflict', dfile({ status: 'U' }), D, DEFAULT_PREFS, UNSTAGED],
  ['a binary file', dfile({ binary: true }), D, DEFAULT_PREFS, UNSTAGED],
  ['a submodule', dfile({ submodule: true }), D, DEFAULT_PREFS, UNSTAGED],
  ['a binary diff', dfile(), fdiff([], { binary: true }), DEFAULT_PREFS, UNSTAGED],
  ['an LFS pointer', dfile(), fdiff([hunk(1, 1, ['-a', '+b'])], { lfs: { old: null, new: { oid: 'a'.repeat(64), size: 1 } } }), DEFAULT_PREFS, UNSTAGED],
  ['no hunks (mode only)', dfile(), fdiff([]), DEFAULT_PREFS, UNSTAGED],
  ['a diff not loaded yet', dfile(), null, DEFAULT_PREFS, UNSTAGED],
  ['Ignore whitespace on', dfile(), D, { ...DEFAULT_PREFS, ignoreWhitespace: true }, UNSTAGED],
  ['Ignore whitespace on, Full+Split', dfile(), D, { ...DEFAULT_PREFS, ignoreWhitespace: true, scope: 'full' as const, layout: 'split' as const }, { kind: 'staged' } as DiffSource],
  ['File view', dfile(), D, { ...DEFAULT_PREFS, view: 'file' as const }, UNSTAGED],
  ['a commit diff', dfile(), D, DEFAULT_PREFS, { kind: 'commit', rev: 'HEAD' } as DiffSource],
  ['a worktree diff', dfile(), D, DEFAULT_PREFS, { kind: 'worktree', rev: 'HEAD' } as DiffSource],
])('no hunk/line staging for %s', (_name, file, diff, prefs, source) => {
  expect(canPartial(file, diff, prefs, source)).toBe(false);
});
