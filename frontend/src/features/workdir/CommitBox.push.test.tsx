import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { remote } from '@/test/remotesWorld';
import { Shell } from '@/shell/Shell';
import { getRemotes, remotesStore } from '@/state/remotes';
import { dispatchTabs } from '@/state/tabs';
import { dfile } from '@/test/diffFixtures';
import { json, summary } from '@/test/fixtures';
import { workdirWorld, type WorkdirWorld } from '@/test/workdirWorld';

// Push after commit (the remotes card): the commit box's checkbox pushes HEAD's branch after a commit that succeeded.

const APP = { project: 'app', worktree: null };
const TRACKED = { remotes: ['origin'], branches: { 'refs/heads/main': { upstream: 'refs/remotes/origin/main', ahead: 0, behind: 0, gone: false } } };

async function show(w: WorkdirWorld['answers'] = {}, over: WorkdirWorld = {}) {
  const world = workdirWorld({
    staged: [dfile({ path: 'a.txt', status: 'M' })],
    answers: { 'remote.list': { remotes: [remote('origin')] }, 'branch.tracking': TRACKED, ...w },
    ...over,
  });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await screen.findByRole('region', { name: 'Commit message' });
  return world;
}
const box = () => screen.getByRole('region', { name: 'Commit message' });
const pushAfter = () => within(box()).queryByRole('checkbox', { name: 'Push after commit' }) as HTMLInputElement | null;
async function commit(text: string) {
  await userEvent.type(within(box()).getByRole('textbox', { name: 'Summary' }), text);
  await userEvent.click(within(box()).getByRole('button', { name: /^Commit changes/ }));
}

test('checked: an ok commit is followed by a push of HEAD\'s branch to its upstream; the choice persists per project', async () => {
  const w = await show();
  await waitFor(() => expect(pushAfter()).not.toBeNull());
  expect(pushAfter()!.checked).toBe(false);
  await userEvent.click(pushAfter()!);
  expect(JSON.parse(localStorage.getItem('code-git:remotes:app')!)).toMatchObject({ pushAfterCommit: true });
  await commit('Ship it');
  await waitFor(() => expect(w.posts('remote.push')).toEqual([{ branch: 'main' }]));
  const order = w.fetch.calls.map((c) => c.url.pathname.split('/').pop()).filter((p) => p === 'commit.create' || p === 'remote.push');
  expect(order).toEqual(['commit.create', 'remote.push']);
});

test('unchecked: a commit pushes nothing', async () => {
  const w = await show();
  await waitFor(() => expect(pushAfter()).not.toBeNull());
  await commit('Local only');
  await waitFor(() => expect(w.posts('commit.create')).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 0));
  expect(w.posts('remote.push')).toEqual([]);
});

test('a refused commit pushes nothing, checked or not', async () => {
  localStorage.setItem('code-git:remotes:app', JSON.stringify({ pushAfterCommit: true }));
  const w = await show({ 'commit.create': json({ error: 'hook said no', code: 'GIT_FAILED', stderr: 'no' }, 422) });
  await waitFor(() => expect(pushAfter()?.checked).toBe(true));
  await commit('Rejected');
  await waitFor(() => expect(w.posts('commit.create')).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 0));
  expect(w.posts('remote.push')).toEqual([]);
});

test('the checkbox is offered only with a remote: none listed hides it, one listed shows it', async () => {
  await show({ 'remote.list': { remotes: [] } });
  await waitFor(() => expect(getRemotes('app').data).toEqual([]));
  await waitFor(() => expect(within(box()).getByRole('button', { name: /^Commit changes/ })).toBeTruthy());
  expect(pushAfter()).toBeNull();
  act(() => remotesStore.set((m) => new Map(m).set('app', { ...getRemotes('app'), data: [remote('origin')] })));
  await waitFor(() => expect(pushAfter()).not.toBeNull());
});

test('a detached HEAD has no Push after commit', async () => {
  await show({}, { summary: summary({ head: { oid: 'a'.repeat(40), branch: null, unborn: false } }) });
  await waitFor(() => expect(screen.getAllByText(/detached/i).length).toBeGreaterThan(0));
  await waitFor(() => expect(getRemotes('app').data?.map((r) => r.name)).toEqual(['origin']));
  expect(pushAfter()).toBeNull();
});
