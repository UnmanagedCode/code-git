import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { dfile, filesResult } from '@/test/diffFixtures';
import { json, summary } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';
import { ComparePanel } from './ComparePanel';
import { openDiff } from './openDiff';

vi.mock('./openDiff', () => ({ openDiff: vi.fn() }));
const opened = vi.mocked(openDiff);
beforeEach(() => opened.mockReset());

const TAB = { project: 'app', worktree: null };
const LIST = filesResult([dfile()]);

function show(files: unknown = { ok: true, result: LIST }) {
  const fetch = stubFetch({
    'POST api/ops/repo.summary': { ok: true, result: summary({ counts: { staged: 2, unstaged: 1, untracked: 3, conflicted: 0 } }) },
    'POST api/ops/diff.files': files,
  });
  render(<ComparePanel tab={TAB} />);
  return fetch;
}

test('the working-directory buttons open the unstaged and staged diffs, with their counts', async () => {
  show();
  await userEvent.click(await screen.findByRole('button', { name: 'Unstaged changes (4)' }));
  expect(opened).toHaveBeenLastCalledWith(TAB, { kind: 'unstaged' });
  await userEvent.click(screen.getByRole('button', { name: 'Staged changes (2)' }));
  expect(opened).toHaveBeenLastCalledWith(TAB, { kind: 'staged' });
});

test('Show commit and Compare with working directory list first, then open with the list preloaded', async () => {
  const fetch = show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Commit (sha or ref)' }), '  HEAD~2 ');
  await userEvent.click(screen.getByRole('button', { name: 'Show commit' }));
  await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  expect(opened).toHaveBeenLastCalledWith(TAB, { kind: 'commit', rev: 'HEAD~2' }, { preloaded: LIST });
  expect(fetch.calls.at(-1)?.body).toEqual({ target: { project: 'app' }, params: { source: { kind: 'commit', rev: 'HEAD~2' }, whitespace: 'none' } });
  await userEvent.click(screen.getByRole('button', { name: 'Compare with working directory' }));
  await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
  expect(opened).toHaveBeenLastCalledWith(TAB, { kind: 'worktree', rev: 'HEAD~2' }, { preloaded: LIST });
});

test('Two refs compares with .. by default and ... when chosen', async () => {
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'From' }), 'main');
  await userEvent.type(screen.getByRole('textbox', { name: 'To' }), 'side');
  await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
  await waitFor(() => expect(opened).toHaveBeenLastCalledWith(TAB, { kind: 'compare', from: 'main', to: 'side', mode: '..' }, { preloaded: LIST }));
  await userEvent.click(screen.getByRole('button', { name: '...' }));
  await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
  await waitFor(() => expect(opened).toHaveBeenLastCalledWith(TAB, { kind: 'compare', from: 'main', to: 'side', mode: '...' }, { preloaded: LIST }));
});

test('empty inputs cannot submit', async () => {
  show();
  expect((screen.getByRole('button', { name: 'Show commit' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(screen.getByRole('textbox', { name: 'From' }), '   ');
  expect((screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement).disabled).toBe(true);
});

test('a refused ref (BAD_REF, REV_UNKNOWN, NO_MERGE_BASE) is shown as an alert and no diff opens', async () => {
  for (const [code, status] of [['REV_UNKNOWN', 404], ['BAD_REF', 400]] as const) {
    show(json({ error: `refused ${code}`, code }, status));
    await userEvent.type(screen.getByRole('textbox', { name: 'Commit (sha or ref)' }), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Show commit' }));
    expect((await screen.findByRole('alert')).textContent).toBe(`refused ${code}`);
    cleanup();
  }
  show(json({ error: 'no common ancestor', code: 'NO_MERGE_BASE' }, 409));
  await userEvent.type(screen.getByRole('textbox', { name: 'From' }), 'a');
  await userEvent.type(screen.getByRole('textbox', { name: 'To' }), 'b');
  await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
  expect((await screen.findByRole('alert')).textContent).toBe('no common ancestor');
  expect(opened).not.toHaveBeenCalled();
});
