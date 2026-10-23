import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { Shell } from '@/shell/Shell';
import { dispatchTabs } from '@/state/tabs';
import { OID } from '@/test/diffFixtures';
import { summary } from '@/test/fixtures';
import { ref, refsResult } from '@/test/graphData';
import { workdirWorld, type WorkdirWorld } from '@/test/workdirWorld';
import type { Conflict, Operation } from './api';

const APP = { project: 'app', worktree: null };
const ONTO = OID('c');
const conflict = (path: string): Conflict => ({ path, kind: 'bothModified', base: null, ours: { mode: '100644', oid: OID('1') }, theirs: { mode: '100644', oid: OID('2') } });
const REBASE: Operation = { kind: 'rebase', incoming: { oid: OID('d'), subject: 'Fix it' }, rebase: { branch: 'refs/heads/feature', onto: ONTO, step: 2, total: 5 } };
const op = (kind: Operation['kind']): Operation => ({ kind, incoming: { oid: OID('e'), subject: 'Add x' }, rebase: null });

/** The Shell with the Changes panel; the graph's refs name `main` at ONTO and `feature` at the incoming oid. */
async function show(w: WorkdirWorld) {
  const world = workdirWorld({
    ...w,
    answers: {
      'graph.refs': refsResult({
        head: { oid: OID('a'), branch: w.summary?.head.branch === null ? null : 'refs/heads/main', detached: w.summary?.head.branch === null, unborn: false },
        refs: [ref('refs/heads/main', ONTO), ref('refs/heads/topic', OID('e'))],
      }),
      ...w.answers,
    },
  });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await screen.findByRole('region', { name: 'Commit message' });
  await waitFor(() => expect(screen.queryByText('Loading changes…')).toBeNull());
  return world;
}
const banner = () => screen.getByRole('status', { name: 'Operation in progress' });
const btn = (name: string) => within(banner()).queryByRole('button', { name }) as HTMLButtonElement | null;

test.each([
  ['Rebasing feature onto main (step 2 of 5)', REBASE],
  ['Merging topic into main', op('merge')],
  [`Cherry-picking ${OID('e').slice(0, 7)} Add x`, op('cherry-pick')],
  [`Reverting ${OID('e').slice(0, 7)} Add x`, op('revert')],
] as [string, Operation][])('the banner shows "%s" from commit.state on first load (what a reload sees)', async (title, operation) => {
  await show({ operation, conflicts: [] });
  await waitFor(() => expect(within(banner()).getByText(title)).toBeTruthy());
});

test('Continue is disabled while conflicts remain and says how many; enabled once none are left', async () => {
  await show({ operation: op('merge'), conflicts: [conflict('a.txt'), conflict('b.txt')] });
  await waitFor(() => expect(btn('Continue')!.disabled).toBe(true));
  expect(within(banner()).getByText('2 conflicted files — resolve them, then Continue')).toBeTruthy();
});

test('Continue posts head.continue for the kind in progress and reloads the state', async () => {
  const w = await show({ operation: op('cherry-pick'), conflicts: [], answers: { 'head.continue': { outcome: 'done', files: [], oid: OID('f'), undo: {} } } });
  await waitFor(() => expect(btn('Continue')!.disabled).toBe(false));
  const reads = w.fetch.count('POST api/ops/commit.state');
  await userEvent.click(btn('Continue')!);
  await waitFor(() => expect(w.posts('head.continue')).toEqual([{ which: 'cherry-pick' }]));
  await waitFor(() => expect(w.fetch.count('POST api/ops/commit.state')).toBeGreaterThan(reads));
});

test('a merge offers no Skip', async () => {
  await show({ operation: op('merge'), conflicts: [] });
  await waitFor(() => expect(btn('Abort…')).not.toBeNull());
  expect(btn('Skip')).toBeNull();
});

test.each([REBASE, op('cherry-pick'), op('revert')])('a $kind offers Skip', async (operation) => {
  await show({ operation, conflicts: [] });
  await waitFor(() => expect(btn('Skip')).not.toBeNull());
});

test('Abort and Skip ask first: nothing is posted on Cancel, the op only after Confirm', async () => {
  const w = await show({ operation: REBASE, conflicts: [conflict('a.txt')], answers: { 'head.skip': { outcome: 'done', files: [], oid: null, undo: {} } } });
  await waitFor(() => expect(btn('Abort…')).not.toBeNull());
  await userEvent.click(btn('Abort…')!);
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Abort rebase'));
  expect(confirmStore.get()?.opts.irreversible).toBe(true);
  act(() => settleConfirm(false));
  expect(w.posts('head.abort')).toEqual([]);
  await userEvent.click(btn('Abort…')!);
  act(() => settleConfirm(true));
  await waitFor(() => expect(w.posts('head.abort')).toEqual([{ which: 'rebase' }]));
  await userEvent.click(btn('Skip')!);
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Skip commit'));
  expect(w.posts('head.skip')).toEqual([]);
  act(() => settleConfirm(true));
  await waitFor(() => expect(w.posts('head.skip')).toEqual([{ which: 'rebase' }]));
});

test('during a rebase (HEAD detached) the detached-HEAD banner gives way to the operation banner; an edit stop says so', async () => {
  await show({ operation: REBASE, conflicts: [], summary: summary({ head: { oid: OID('a'), branch: null, unborn: false } }) });
  await waitFor(() => expect(banner()).toBeTruthy());
  expect(screen.queryByText(/Detached HEAD at/)).toBeNull();
  expect(within(banner()).getByText(`Stopped at ${OID('d').slice(0, 7)}: amend if you like, then Continue`)).toBeTruthy();
});

test('conflicts with nothing in progress are counted, with no buttons', async () => {
  await show({ operation: null, conflicts: [conflict('a.txt')] });
  const c = await screen.findByRole('status', { name: 'Conflicts' });
  expect(c.textContent).toContain('1 conflicted file');
  expect(within(c).queryAllByRole('button')).toEqual([]);
  expect(screen.queryByRole('status', { name: 'Operation in progress' })).toBeNull();
});

test('an answer without operation and conflicts (an older backend) shows no banner', async () => {
  await show({ merging: true });
  expect(screen.queryByRole('status', { name: 'Operation in progress' })).toBeNull();
  expect(screen.queryByRole('status', { name: 'Conflicts' })).toBeNull();
});
