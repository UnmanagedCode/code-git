import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Shell } from '@/shell/Shell';
import { setPrefs } from '@/state/diff';
import { dispatchTabs } from '@/state/tabs';
import { dfile, fdiff, filesResult, hunk, OID } from '@/test/diffFixtures';
import { json } from '@/test/fixtures';
import { workdirWorld, type WorkdirWorld } from '@/test/workdirWorld';
import type { DiffFile, DiffSource } from './api';
import { openDiff } from './openDiff';

const APP = { project: 'app', worktree: null };
const H1 = '@@ -1,3 +1,3 @@ fn';
const H2 = '@@ -10,2 +10,2 @@';
const FD = fdiff([hunk(1, 1, [' a', '-foo(bar)', '+foo(baz)', ' b'], 'fn'), hunk(10, 10, ['-x', '+y', ' z'])]);
const M = dfile({ path: 'src/a.ts' });

async function show(source: DiffSource, file: DiffFile = M, w: WorkdirWorld = {}) {
  const world = workdirWorld({ unstaged: [file], staged: [file], fileDiffs: { [file.path]: FD }, ...w });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  act(() => openDiff(APP, source, { path: file.path }));
  await rendered();
  return world;
}
/** The viewed file's rows are on screen. */
const rendered = () => waitFor(() => expect(diff().querySelectorAll('[data-diff-body] [data-row], [data-diff-body] [data-side]').length).toBeGreaterThan(0));
const diff = () => screen.getByRole('region', { name: 'Diff' });
const toggles = () => within(diff()).queryAllByRole('button', { name: /^Select (added|removed) line/ });
const btn = (name: string | RegExp) => within(diff()).getByRole('button', { name });

test('an unstaged M file: Stage hunk / Discard hunk… on each header, a toggle on each add/del line only', async () => {
  await show({ kind: 'unstaged' });
  expect(within(diff()).getAllByRole('button', { name: 'Stage hunk' })).toHaveLength(2);
  expect(within(diff()).getAllByRole('button', { name: 'Discard hunk…' })).toHaveLength(2);
  expect(within(diff()).queryByRole('button', { name: 'Unstage hunk' })).toBeNull();
  expect(toggles().map((b) => b.getAttribute('aria-label'))).toEqual(['Select removed line 2', 'Select added line 2', 'Select removed line 10', 'Select added line 10']);
});

test('Stage hunk sends the whole hunk: its header and every add/del line with its exact text', async () => {
  const w = await show({ kind: 'unstaged' });
  await userEvent.click(within(diff()).getAllByRole('button', { name: 'Stage hunk' })[1]);
  await waitFor(() => expect(w.posts('stage.stageLines')).toEqual([
    { path: 'src/a.ts', context: 3, hunks: [{ header: H2, lines: [{ index: 0, text: 'x' }, { index: 1, text: 'y' }] }] },
  ]));
});

test('line clicks and a shift-click range build the exact request; Stage lines sends it and clears the selection', async () => {
  const w = await show({ kind: 'unstaged' });
  await userEvent.click(btn('Select added line 2'));
  expect(btn('Select added line 2').getAttribute('aria-pressed')).toBe('true');
  expect(within(diff()).getByRole('toolbar', { name: 'Line selection' }).textContent).toContain('1 line selected');
  const user = userEvent.setup();
  await user.keyboard('{Shift>}');
  await user.click(btn('Select removed line 10'));
  await user.keyboard('{/Shift}');
  expect(within(diff()).getByRole('toolbar', { name: 'Line selection' }).textContent).toContain('2 lines selected');
  await userEvent.click(btn('Stage lines'));
  await waitFor(() => expect(w.posts('stage.stageLines')).toEqual([{
    path: 'src/a.ts', context: 3,
    hunks: [{ header: H1, lines: [{ index: 2, text: 'foo(baz)' }] }, { header: H2, lines: [{ index: 0, text: 'x' }] }],
  }]));
  await waitFor(() => expect(within(diff()).queryByRole('toolbar', { name: 'Line selection' })).toBeNull());
});

test('a second click unselects; Clear empties the selection', async () => {
  await show({ kind: 'unstaged' });
  await userEvent.click(btn('Select removed line 2'));
  await userEvent.click(btn('Select removed line 2'));
  expect(within(diff()).queryByRole('toolbar', { name: 'Line selection' })).toBeNull();
  await userEvent.click(btn('Select removed line 2'));
  await userEvent.click(btn('Clear'));
  expect(btn('Select removed line 2').getAttribute('aria-pressed')).toBe('false');
});

test('Discard lines asks first, previewing the lines; nothing is sent on Cancel; Confirm sends discardLines', async () => {
  const w = await show({ kind: 'unstaged' });
  await userEvent.click(btn('Select removed line 2'));
  await userEvent.click(btn('Select added line 2'));
  await userEvent.click(btn('Discard lines…'));
  const d = screen.getByRole('dialog');
  expect(within(d).getByLabelText('Lines').textContent).toBe('-foo(bar)\n+foo(baz)');
  expect(within(d).getByText('This cannot be undone.')).toBeTruthy();
  await userEvent.click(within(d).getByRole('button', { name: 'Cancel' }));
  expect(w.posts('stage.discardLines')).toEqual([]);
  await userEvent.click(within(diff()).getAllByRole('button', { name: 'Discard hunk…' })[0]);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard lines' }));
  await waitFor(() => expect(w.posts('stage.discardLines')).toEqual([
    { path: 'src/a.ts', context: 3, hunks: [{ header: H1, lines: [{ index: 1, text: 'foo(bar)' }, { index: 2, text: 'foo(baz)' }] }] },
  ]));
});

test('a staged diff offers Unstage hunk and Unstage lines only', async () => {
  const w = await show({ kind: 'staged' });
  expect(within(diff()).queryByRole('button', { name: 'Stage hunk' })).toBeNull();
  await userEvent.click(btn('Select added line 10'));
  expect(within(diff()).queryByRole('button', { name: 'Stage lines' })).toBeNull();
  await userEvent.click(btn('Unstage lines'));
  await waitFor(() => expect(w.posts('stage.unstageLines')).toEqual([{ path: 'src/a.ts', context: 3, hunks: [{ header: H2, lines: [{ index: 1, text: 'y' }] }] }]));
  await userEvent.click(within(diff()).getAllByRole('button', { name: 'Unstage hunk' })[0]);
  await waitFor(() => expect(w.posts('stage.unstageLines')).toHaveLength(2));
});

test('Inline and Split select lines too, against the whole-file context', async () => {
  const w = await show({ kind: 'unstaged' });
  setPrefs({ mode: 'split' });
  await waitFor(() => expect(toggles().length).toBe(4));
  expect(within(diff()).queryByRole('button', { name: 'Stage hunk' })).toBeNull();
  await userEvent.click(btn('Select added line 10'));
  await userEvent.click(btn('Stage lines'));
  await waitFor(() => expect(w.posts('stage.stageLines')).toEqual([{ path: 'src/a.ts', context: 'full', hunks: [{ header: H2, lines: [{ index: 1, text: 'y' }] }] }]));
  act(() => setPrefs({ mode: 'inline' }));
  await waitFor(() => expect(toggles().length).toBe(4));
});

test('a refused selection (STALE_DIFF) is shown in the diff header', async () => {
  await show({ kind: 'unstaged' }, M, { answers: { 'stage.stageLines': json({ error: 'the file changed since its diff was shown', code: 'STALE_DIFF' }, 409) } });
  await userEvent.click(within(diff()).getAllByRole('button', { name: 'Stage hunk' })[0]);
  expect((await within(diff()).findByRole('alert')).textContent).toBe('Could not stage the selection: the file changed since its diff was shown');
});

test.each([
  ['an added file', { kind: 'unstaged' }, dfile({ path: 'src/a.ts', status: 'A' }), {}],
  ['an untracked file', { kind: 'unstaged' }, dfile({ path: 'src/a.ts', status: '?' }), {}],
  ['a renamed file', { kind: 'staged' }, dfile({ path: 'src/a.ts', status: 'R', oldPath: 'old.ts' }), {}],
  ['a commit diff', { kind: 'commit', rev: 'HEAD' }, M, {}],
] as const)('no hunk or line affordances for %s', async (_n, source, file, w) => {
  await show(source as DiffSource, file, { ...w, answers: source.kind === 'commit' ? { 'diff.files': (p: { source: { kind: string } }) => (p.source.kind === 'commit' ? filesResult([file]) : filesResult([], { commit: null })) } : {} });
  expect(toggles()).toEqual([]);
  expect(within(diff()).queryByRole('button', { name: /hunk/ })).toBeNull();
});

test('no affordances with whitespace ignored or in File view', async () => {
  await show({ kind: 'unstaged' });
  act(() => setPrefs({ view: 'file' }));
  await waitFor(() => expect(toggles()).toEqual([]));
  act(() => setPrefs({ view: 'diff', whitespace: 'all' }));
  await rendered();
  expect(toggles()).toEqual([]);
});

test('Restore file to this version… (a commit diff) asks, then resets the file to the diff\'s new commit', async () => {
  const w = await show({ kind: 'commit', rev: 'HEAD' }, M, { answers: { 'diff.files': (p: { source: { kind: string } }) => (p.source.kind === 'commit' ? filesResult([M, dfile({ path: 'gone.ts', status: 'D' })]) : filesResult([], { commit: null })) } });
  const list = within(diff()).getByRole('listbox', { name: 'Changed files' });
  await userEvent.click(within(list).getByRole('button', { name: 'Actions for gone.ts' }));
  expect(screen.queryByRole('menuitem', { name: 'Restore file to this version…' })).toBeNull();
  await userEvent.keyboard('{Escape}');
  await userEvent.click(within(list).getByRole('button', { name: 'Actions for src/a.ts' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Restore file to this version…' }));
  const d = screen.getByRole('dialog');
  expect(within(d).getByText(`Restore src/a.ts to ${OID('b').slice(0, 7)}?`)).toBeTruthy();
  expect(w.posts('files.restore')).toEqual([]);
  await userEvent.click(within(d).getByRole('button', { name: 'Restore file' }));
  await waitFor(() => expect(w.posts('files.restore')).toEqual([{ oid: OID('b'), path: 'src/a.ts' }]));
});

test('no Restore on an unstaged diff (its new side is the working tree)', async () => {
  await show({ kind: 'unstaged' });
  await userEvent.click(within(within(diff()).getByRole('listbox', { name: 'Changed files' })).getByRole('button', { name: 'Actions for src/a.ts' }));
  expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Restore file to this version…' })).toBeNull();
});
