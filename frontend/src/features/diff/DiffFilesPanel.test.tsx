import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Shell } from '@/shell/Shell';
import { diffStore } from '@/state/diff';
import { dispatchTabs } from '@/state/tabs';
import { dfile, fdiff, filesResult, hunk, OID } from '@/test/diffFixtures';
import { workdirWorld } from '@/test/workdirWorld';
import type { DiffSource } from './api';
import { closeDiff, openDiff } from './openDiff';

const APP = { project: 'app', worktree: null };
const slot = () => document.querySelector<HTMLElement>('[data-slot-name=right]')!;

/** The shell with a Changes panel (one unstaged file) and a compare diff of two files. */
async function show() {
  const w = workdirWorld({
    fileDiffs: { 'x.ts': fdiff([hunk(1, 1, ['+x'])], { path: 'x.ts' }), 'y.ts': fdiff([hunk(1, 1, ['+y'])], { path: 'y.ts' }) },
    answers: {
      'diff.files': (p: { source: DiffSource }) => (p.source.kind === 'compare'
        ? filesResult([dfile({ path: 'x.ts', added: 3, deleted: 1 }), dfile({ path: 'y.ts' })], { commit: null, mergeBase: OID('m') })
        : p.source.kind === 'worktree' ? filesResult([dfile({ path: 'src/x.ts' }), dfile({ path: 'y.ts' })], { commit: null })
          : filesResult(p.source.kind === 'unstaged' ? [dfile({ path: 'wip.ts' })] : [], { commit: null })),
    },
  });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await within(slot()).findByRole('region', { name: 'Unstaged Files' });
  return w;
}

test('a compare diff puts its Changed files panel in the right slot, in place of Changes and the details', async () => {
  const { posts } = await show();
  act(() => openDiff(APP, { kind: 'compare', from: 'main', to: 'side', mode: '...' }));
  const panel = await within(slot()).findByRole('complementary', { name: 'Changed files panel' });
  const list = await within(panel).findByRole('listbox', { name: 'Changed files' });
  expect(within(panel).getByText('2 files')).toBeTruthy();
  expect(within(list).getAllByRole('option').map((o) => o.getAttribute('data-path'))).toEqual(['x.ts', 'y.ts']);
  expect(within(list).getByLabelText('3 added, 1 deleted')).toBeTruthy();
  expect(within(slot()).queryByRole('region', { name: 'Unstaged Files' })).toBeNull();
  expect(within(slot()).queryByRole('complementary', { name: 'Commit details' })).toBeNull();
  const lists = posts('diff.files').length;
  await userEvent.click(within(list).getByRole('option', { name: /y\.ts/ }));
  expect(diffStore.get().get('app\0')).toMatchObject({ viewed: 'y.ts', selected: ['y.ts'] });
  expect(within(list).getByRole('option', { name: /y\.ts/ }).getAttribute('aria-current')).toBe('true');
  // Picking a file never refetches the list.
  expect(posts('diff.files')).toHaveLength(lists);
  // ↓ from the focused row views the next file; ↑ goes back.
  fireEvent.keyDown(within(list).getByRole('option', { name: /y\.ts/ }), { key: 'ArrowUp' });
  expect(diffStore.get().get('app\0')?.viewed).toBe('x.ts');
});

test('closing the diff gives the right slot back to what the selection shows (Changes)', async () => {
  await show();
  act(() => openDiff(APP, { kind: 'compare', from: 'main', to: 'side', mode: '..' }));
  await within(slot()).findByRole('listbox', { name: 'Changed files' });
  act(() => closeDiff(APP));
  await waitFor(() => expect(within(slot()).queryByRole('complementary', { name: 'Changed files panel' })).toBeNull());
  expect(within(slot()).getByRole('region', { name: 'Unstaged Files' })).toBeTruthy();
});

test('the panel has the File view toggle; Tree nests the files', async () => {
  await show();
  act(() => openDiff(APP, { kind: 'worktree', rev: 'main' }));
  const panel = await within(slot()).findByRole('complementary', { name: 'Changed files panel' });
  await within(panel).findAllByRole('option');
  expect(within(panel).queryByRole('group', { name: 'src' })).toBeNull();
  await userEvent.click(within(panel).getByRole('button', { name: 'Tree' }));
  expect(within(panel).getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(within(panel).getByRole('group', { name: 'src' })).getByRole('option', { name: /x\.ts/ })).toBeTruthy();
});
