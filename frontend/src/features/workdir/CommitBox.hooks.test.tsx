import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { remotesStore } from '@/state/remotes';
import { workdirOf } from '@/state/workdir';
import { summary } from '@/test/fixtures';
import { remote } from '@/test/remotesWorld';
import { CommitBox } from './CommitBox';

// The commit box calls the same hooks on every render: its summary's HEAD flipping between a branch and detached (a
// rebase mid-way reports a detached HEAD) must not change the hook count, which React refuses (#300 / #310).

const T = { project: 'app', worktree: null };
const onBranch = summary({ head: { oid: 'a'.repeat(40), branch: 'main', unborn: false } });
const detached = summary({ head: { oid: 'a'.repeat(40), branch: null, unborn: false } });

test('re-rendering with HEAD flipping branch → detached → branch → no summary renders without an error', () => {
  remotesStore.set(new Map([['app', { data: [remote('origin')], busy: { fetch: false, pull: false, push: false }, autoFetchError: null }]]));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const box = (s: typeof onBranch | null) => <CommitBox tab={T} state={workdirOf(T)} summary={s} instance="slot" />;
  const { rerender } = render(box(onBranch));
  expect(screen.getByRole('checkbox', { name: 'Push after commit' })).toBeTruthy();
  rerender(box(detached));
  expect(screen.queryByRole('checkbox', { name: 'Push after commit' })).toBeNull();
  rerender(box(onBranch));
  rerender(box(null));
  rerender(box(onBranch));
  expect(screen.getByRole('checkbox', { name: 'Push after commit' })).toBeTruthy();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

test('starting detached, then on a branch: the checkbox appears, no error', () => {
  remotesStore.set(new Map([['app', { data: [remote('origin')], busy: { fetch: false, pull: false, push: false }, autoFetchError: null }]]));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { rerender } = render(<CommitBox tab={T} state={workdirOf(T)} summary={detached} instance="slot" />);
  rerender(<CommitBox tab={T} state={workdirOf(T)} summary={onBranch} instance="slot" />);
  expect(screen.getByRole('checkbox', { name: 'Push after commit' })).toBeTruthy();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});
