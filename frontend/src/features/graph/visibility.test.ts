import { expect, test } from 'vitest';
import { DEFAULT_PREFS, type GraphPrefs } from '@/state/graphPrefs';
import { refsResult, ref, oid, worktree } from '@/test/graphData';
import { resolveVisibility } from './visibility';

const M = oid(1);
const F = oid(2);
const O = oid(3);
const T = oid(4);
const W = oid(5);
const refs = refsResult({
  head: { oid: M, branch: 'refs/heads/main', detached: false, unborn: false },
  refs: [
    ref('refs/heads/main', M, { isHead: true }), ref('refs/heads/feat', F), ref('refs/remotes/origin/main', O),
    ref('refs/remotes/up/feat', F), ref('refs/tags/v1', T), ref('refs/tags/tree', null),
  ],
  worktrees: [worktree('/r', M, 'refs/heads/main'), worktree('/r/wt', W, null)],
});
const prefs = (over: Partial<GraphPrefs>): GraphPrefs => ({ ...DEFAULT_PREFS, ...over });

test('everything visible by default: tips are every ref commit, HEAD and detached worktree HEADs, sorted and unique; a non-commit tag adds none', () => {
  const v = resolveVisibility(refs, DEFAULT_PREFS);
  expect(v.soloActive).toBe(false);
  expect(v.visible.size).toBe(6);
  expect(v.tips).toEqual([M, F, O, T, W].sort());
});

test('hiding a ref, a remote or a section removes its commits from the tips', () => {
  expect(resolveVisibility(refs, prefs({ hidden: ['refs/heads/feat', 'refs/remotes/up/feat'] })).tips).toEqual([M, O, T, W]);
  expect(resolveVisibility(refs, prefs({ hiddenRemotes: ['origin'] })).visible.has('refs/remotes/origin/main')).toBe(false);
  expect(resolveVisibility(refs, prefs({ hiddenRemotes: ['origin'] })).tips).toEqual([M, F, T, W]);
  expect(resolveVisibility(refs, prefs({ hiddenSections: ['tags'] })).tips).toEqual([M, F, O, W]);
  const remote = resolveVisibility(refs, prefs({ hiddenSections: ['remote'] }));
  expect([...remote.visible].sort()).toEqual(['refs/heads/feat', 'refs/heads/main', 'refs/tags/tree', 'refs/tags/v1']);
});

test('the checked-out branch is never hidden, even by its section', () => {
  const v = resolveVisibility(refs, prefs({ hidden: ['refs/heads/main'], hiddenSections: ['local'] }));
  expect(v.visible.has('refs/heads/main')).toBe(true);
  expect(v.visible.has('refs/heads/feat')).toBe(false);
});

test('solo of a ref, a remote or a section shows only those and overrides hides; HEAD and detached HEADs are not added', () => {
  const ref1 = resolveVisibility(refs, prefs({ soloed: ['refs/heads/feat'], hidden: ['refs/heads/feat'] }));
  expect(ref1.soloActive).toBe(true);
  expect([...ref1.visible]).toEqual(['refs/heads/feat']);
  expect(ref1.tips).toEqual([F]);
  expect([...resolveVisibility(refs, prefs({ soloedRemotes: ['up'] })).visible]).toEqual(['refs/remotes/up/feat']);
  expect([...resolveVisibility(refs, prefs({ soloedSections: ['tags'], hiddenSections: ['tags'] })).visible]).toEqual(['refs/tags/v1', 'refs/tags/tree']);
  expect(resolveVisibility(refs, prefs({ soloed: ['refs/heads/gone'] })).soloActive).toBe(false);
});

test('WIP rows: the own checkout always; another when its branch is visible, or when detached and not soloing', () => {
  const plain = resolveVisibility(refs, prefs({ hidden: ['refs/heads/feat'] }));
  expect(plain.wipVisible({ isOwn: true, branch: 'refs/heads/feat' })).toBe(true);
  expect(plain.wipVisible({ isOwn: false, branch: 'refs/heads/feat' })).toBe(false);
  expect(plain.wipVisible({ isOwn: false, branch: 'refs/heads/main' })).toBe(true);
  expect(plain.wipVisible({ isOwn: false, branch: null })).toBe(true);
  const solo = resolveVisibility(refs, prefs({ soloed: ['refs/heads/feat'] }));
  expect(solo.wipVisible({ isOwn: false, branch: null })).toBe(false);
  expect(solo.wipVisible({ isOwn: false, branch: 'refs/heads/feat' })).toBe(true);
  expect(solo.wipVisible({ isOwn: true, branch: 'refs/heads/main' })).toBe(true);
});

test('the stashes section hidden hides stashes', () => {
  expect(resolveVisibility(refs, DEFAULT_PREFS).stashesVisible).toBe(true);
  expect(resolveVisibility(refs, prefs({ hiddenSections: ['stashes'] })).stashesVisible).toBe(false);
});
