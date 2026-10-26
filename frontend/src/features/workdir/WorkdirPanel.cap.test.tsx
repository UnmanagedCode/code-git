import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { FILE_RENDER_CAP } from '@/lib/clip';
import { Shell } from '@/shell/Shell';
import { dispatchTabs } from '@/state/tabs';
import { dfile } from '@/test/diffFixtures';
import { workdirWorld } from '@/test/workdirWorld';

// The list caps with a small FILE_RENDER_CAP, so the fixtures stay a few rows instead of a thousand.
vi.mock('@/lib/clip', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/clip')>()), FILE_RENDER_CAP: 5 }));

const APP = { project: 'app', worktree: null };
const untracked = (n: number) => Array.from({ length: n }, (_, i) => dfile({ path: `u${i}.txt`, status: '?' }));

async function show(n: number) {
  const w = workdirWorld({ unstaged: untracked(n), staged: [] });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await screen.findByRole('region', { name: 'Unstaged Files' });
  return w;
}
const section = () => screen.getByRole('region', { name: 'Unstaged Files' });

test('the cap seam is in effect for this file', () => {
  expect(FILE_RENDER_CAP).toBe(5);
});

test('a list longer than FILE_RENDER_CAP mounts only that many rows until "Show all N"', async () => {
  await show(FILE_RENDER_CAP + 3);
  await waitFor(() => expect(within(section()).getAllByRole('option')).toHaveLength(FILE_RENDER_CAP));
  expect(within(section()).getByRole('heading').textContent).toBe(`Unstaged Files (${FILE_RENDER_CAP + 3})`);
  await userEvent.click(within(section()).getByRole('button', { name: `Show all ${FILE_RENDER_CAP + 3}` }));
  expect(within(section()).getAllByRole('option')).toHaveLength(FILE_RENDER_CAP + 3);
});

test('"Show all N" sits inside the section\'s own scroller', async () => {
  await show(FILE_RENDER_CAP + 3);
  const showAll = await within(section()).findByRole('button', { name: `Show all ${FILE_RENDER_CAP + 3}` });
  expect(section().querySelector('[data-section-list]')!.contains(showAll)).toBe(true);
});

test('Discard all lists at most FILE_RENDER_CAP untracked names, then how many more; all of them are still sent', async () => {
  const w = await show(FILE_RENDER_CAP + 3);
  await waitFor(() => expect(within(section()).getAllByRole('option').length).toBeGreaterThan(0));
  await userEvent.click(screen.getByRole('button', { name: 'Discard all…' }));
  const dialog = screen.getByRole('dialog');
  const list = within(dialog).getByRole('list', { name: 'Affected files' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(FILE_RENDER_CAP + 1);
  expect(within(list).getByText('…and 3 more')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Discard all' }));
  await waitFor(() => expect((w.posts('stage.discardFiles')[0] as { untracked: string[] }).untracked).toHaveLength(FILE_RENDER_CAP + 3));
});

test('Stage folder and Unstage folder act on every file of the section beneath the folder, not only the rows rendered under the cap', async () => {
  const under = (dir: string, n: number) => Array.from({ length: n }, (_, i) => dfile({ path: `${dir}/f${i}.ts` }));
  const unstaged = [...under('src', FILE_RENDER_CAP + 3), dfile({ path: 'src/c.ts', status: 'U' })];
  const staged = under('lib', FILE_RENDER_CAP + 2);
  const w = workdirWorld({ unstaged, staged });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await screen.findByRole('region', { name: 'Unstaged Files' });
  await userEvent.click(within(screen.getByRole('group', { name: 'File view' })).getByRole('button', { name: 'Tree' }));
  const unstagedSection = screen.getByRole('region', { name: 'Unstaged Files' });
  await waitFor(() => expect(within(unstagedSection).getAllByRole('option')).toHaveLength(FILE_RENDER_CAP));
  await userEvent.click(within(unstagedSection).getByRole('button', { name: 'Stage folder src' }));
  await waitFor(() => expect(w.posts('stage.files')).toHaveLength(1));
  expect((w.posts('stage.files')[0] as { paths: string[] }).paths.sort()).toEqual(under('src', FILE_RENDER_CAP + 3).map((f) => f.path).sort());
  await waitFor(() => expect(screen.queryByText('Loading changes…')).toBeNull());
  const stagedSection = screen.getByRole('region', { name: 'Staged Files' });
  expect(within(stagedSection).getAllByRole('option')).toHaveLength(FILE_RENDER_CAP);
  await userEvent.click(within(stagedSection).getByRole('button', { name: 'Unstage folder lib' }));
  await waitFor(() => expect(w.posts('stage.unstageFiles')).toHaveLength(1));
  expect((w.posts('stage.unstageFiles')[0] as { paths: string[] }).paths.sort()).toEqual(staged.map((f) => f.path).sort());
});
