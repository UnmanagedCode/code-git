import { expect, test } from 'vitest';
import { DEFAULT_PREFS, type GraphPrefs } from '@/state/graphPrefs';
import { refsResult, ref, oid, worktree } from '@/test/graphData';
import { inFolder, refBase, resolveVisibility, TIPS_MAX } from './visibility';

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

test('wipVisible: the own checkout whatever is hidden or soloed; another when its branch is visible, or when detached and not soloing', () => {
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

test('tips are clamped to TIPS_MAX, keeping HEAD, detached worktree HEADs and branches before remotes and tags', () => {
  const many = Array.from({ length: TIPS_MAX + 5 }, (_, i) => ref(`refs/tags/t${i}`, oid(100 + i)));
  const big = refsResult({ ...refs, refs: [...many, ...refs.refs] });
  const v = resolveVisibility(big, DEFAULT_PREFS);
  expect(v.tips).toHaveLength(TIPS_MAX);
  expect(v.tipsDropped).toBe(TIPS_MAX + 5 + 5 - TIPS_MAX);
  for (const keep of [M, F, O, W]) expect(v.tips).toContain(keep);
  expect(v.tips).toEqual([...v.tips].sort());
  expect(resolveVisibility(refs, DEFAULT_PREFS).tipsDropped).toBe(0);
});

const T1 = oid(11);
const T2 = oid(12);
const T3 = oid(13);
const folderRefs = refsResult({
  head: { oid: M, branch: 'refs/heads/main', detached: false, unborn: false },
  refs: [
    ref('refs/heads/main', M, { isHead: true }), ref('refs/heads/team/a', T1), ref('refs/heads/team/sub/b', T2), ref('refs/heads/team-x', T3),
    ref('refs/remotes/origin/team/c', O), ref('refs/tags/team/t', T),
  ],
  worktrees: [],
});
const shown = (p: Partial<GraphPrefs>) => [...resolveVisibility(folderRefs, prefs(p)).visible].sort();

// Invariant: a folder is bound to its own namespace and to a whole path segment.
test('inFolder: whole-segment prefix inside the ref\'s own namespace only; the bare base matches nothing', () => {
  const local = ref('refs/heads/code-conductor/a', M);
  expect(inFolder(local, 'refs/heads/code-conductor/')).toBe(true);
  expect(inFolder(ref('refs/heads/code-conductorx', M), 'refs/heads/code-conductor/')).toBe(false);
  expect(inFolder(local, 'refs/tags/code-conductor/')).toBe(false);
  expect(inFolder(local, 'refs/remotes/origin/code-conductor/')).toBe(false);
  expect(inFolder(local, 'refs/heads/')).toBe(false);
  expect(inFolder(ref('refs/remotes/origin/a', M, { remote: 'origin' }), 'refs/remotes/')).toBe(false);
  expect(inFolder(ref('refs/tags/v/1', M), 'refs/tags/')).toBe(false);
});

test('inFolder: remote `origin` + folder `feature/` is not a remote named `origin/feature`', () => {
  const inOrigin = ref('refs/remotes/origin/feature/b', M, { remote: 'origin' });
  const inSlashRemote = ref('refs/remotes/origin/feature/b', M, { remote: 'origin/feature' });
  expect(refBase(inOrigin)).toBe('refs/remotes/origin/');
  expect(refBase(inSlashRemote)).toBe('refs/remotes/origin/feature/');
  expect(inFolder(inOrigin, 'refs/remotes/origin/feature/')).toBe(true);
  expect(inFolder(inSlashRemote, 'refs/remotes/origin/feature/')).toBe(false);
});

// Invariant: hiding a folder hides everything under it (nested too) and nothing outside it, later refs included.
test('a hidden folder hides its refs at any depth, in its namespace only; the checked-out branch stays', () => {
  expect(shown({ hiddenFolders: ['refs/heads/team/'] })).toEqual(['refs/heads/main', 'refs/heads/team-x', 'refs/remotes/origin/team/c', 'refs/tags/team/t']);
  expect(shown({ hiddenFolders: ['refs/heads/team/sub/'] })).toEqual(['refs/heads/main', 'refs/heads/team-x', 'refs/heads/team/a', 'refs/remotes/origin/team/c', 'refs/tags/team/t']);
  expect(shown({ hiddenFolders: ['refs/heads/'] })).toHaveLength(6);
  const head = refsResult({ head: { oid: M, branch: 'refs/heads/team/a', detached: false, unborn: false }, refs: [ref('refs/heads/team/a', M, { isHead: true }), ref('refs/heads/team/b', T1)], worktrees: [] });
  expect([...resolveVisibility(head, prefs({ hiddenFolders: ['refs/heads/team/'] })).visible]).toEqual(['refs/heads/team/a']);
});

test('a soloed folder shows exactly its refs; an empty one has no effect; solo folder + solo remote is the union', () => {
  expect(shown({ soloedFolders: ['refs/heads/team/'] })).toEqual(['refs/heads/team/a', 'refs/heads/team/sub/b']);
  expect(resolveVisibility(folderRefs, prefs({ soloedFolders: ['refs/heads/none/'] })).soloActive).toBe(false);
  expect(shown({ soloedFolders: ['refs/heads/none/'] })).toHaveLength(6);
  expect(shown({ soloedFolders: ['refs/heads/team/'], soloedRemotes: ['origin'] })).toEqual(['refs/heads/team/a', 'refs/heads/team/sub/b', 'refs/remotes/origin/team/c']);
  const v = resolveVisibility(folderRefs, prefs({ soloedFolders: ['refs/heads/team/'] }));
  expect(v.soloActive).toBe(true);
  expect(v.tips).toEqual([T1, T2].sort());
});

// Invariant: any solo match ignores every hide, whichever selector hides.
test('solo ignores every hide: a soloed ref inside a hidden folder, a hidden ref or sub-folder inside a soloed folder', () => {
  expect(shown({ hiddenFolders: ['refs/heads/team/'], soloed: ['refs/heads/team/a'] })).toEqual(['refs/heads/team/a']);
  expect(shown({ soloedFolders: ['refs/heads/team/'], hidden: ['refs/heads/team/a'] })).toEqual(['refs/heads/team/a', 'refs/heads/team/sub/b']);
  expect(shown({ soloedFolders: ['refs/heads/team/'], hiddenFolders: ['refs/heads/team/sub/'] })).toEqual(['refs/heads/team/a', 'refs/heads/team/sub/b']);
  expect(shown({ soloedFolders: ['refs/heads/team/'], hiddenRemotes: ['origin'], hiddenSections: ['local'] })).toEqual(['refs/heads/team/a', 'refs/heads/team/sub/b']);
});
