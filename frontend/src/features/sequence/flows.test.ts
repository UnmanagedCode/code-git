import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { Toasts } from '@/shell/Toasts';
import { json } from '@/test/fixtures';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { workdirOf } from '@/state/workdir';
import { abortFlow, continueFlow, skipFlow } from './flows';

const T = { project: 'app', worktree: null };
afterEach(() => { toast.dismiss(); });
const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join('|');
const undo = { refs: [], remoteRefs: [], head: null, worktreeSnapshot: null, stashes: [], worktreePatch: null, remotes: [] };

/** The graph backend plus commit.state and the given op answers (a value or a Response). */
function world(answers: Record<string, unknown>) {
  const fetch = stubGraph(linearWorld(2), {
    'POST api/ops/commit.state': { ok: true, result: { merging: false, operation: null, conflicts: [] } },
    ...Object.fromEntries(Object.entries(answers).map(([op, v]) => [`POST api/ops/${op}`, v instanceof Response ? v : { ok: true, result: v }])),
  });
  render(createElement(Toasts));
  return { fetch, posts: (op: string) => paramsOf(fetch, `POST api/ops/${op}`) };
}

test('continue: done toasts the kind\'s success and reloads commit.state for the banner', async () => {
  const w = world({ 'head.continue': { outcome: 'done', files: [], oid: 'f'.repeat(40), undo } });
  await continueFlow(T, 'rebase');
  expect(w.posts('head.continue')).toEqual([{ which: 'rebase' }]);
  await waitFor(() => expect(toastText()).toContain('Rebase finished'));
  expect(w.fetch.count('POST api/ops/commit.state')).toBeGreaterThan(0);
});

test('continue stopping on new conflicts warns with the files, Resolve… (opens Changes) and Abort… (confirms, then aborts)', async () => {
  const w = world({ 'head.continue': { outcome: 'conflicts', files: ['a.txt', 'b.txt'], oid: null, undo }, 'head.abort': { undo } });
  await continueFlow(T, 'rebase');
  await waitFor(() => expect(toastText()).toContain('The rebase stopped on conflicts'));
  expect(toastText()).toContain('Conflicts in a.txt, b.txt.');
  await userEvent.click(screen.getByRole('button', { name: 'Resolve…' }));
  expect(workdirOf(T).focus).toBe('slot');
  await continueFlow(T, 'rebase');
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Abort…' }).length).toBeGreaterThan(0));
  await userEvent.click(screen.getAllByRole('button', { name: 'Abort…' })[0]);
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Abort rebase'));
  act(() => settleConfirm(true));
  await waitFor(() => expect(w.posts('head.abort')).toEqual([{ which: 'rebase' }]));
});

test('continue reaching an edit stop says which commit stopped', async () => {
  world({ 'head.continue': { outcome: 'stopped', files: [], oid: 'abcdef1234'.padEnd(40, '0'), undo } });
  await continueFlow(T, 'rebase');
  await waitFor(() => expect(toastText()).toContain('Stopped to edit abcdef1'));
});

test('continue refusals say what to do: CONFLICTED lists the files, NOTHING_TO_COMMIT suggests skip, DIRTY_WORKTREE staging', async () => {
  const answers: Record<string, Response> = {
    CONFLICTED: json({ error: 'x', code: 'CONFLICTED', files: ['c.txt'] }, 409),
    NOTHING_TO_COMMIT: json({ error: 'x', code: 'NOTHING_TO_COMMIT' }, 409),
    DIRTY_WORKTREE: json({ error: 'x', code: 'DIRTY_WORKTREE' }, 409),
  };
  const expected: Record<string, string> = {
    CONFLICTED: 'Resolve the conflicts first', NOTHING_TO_COMMIT: 'Nothing to commit here: skip this commit, or abort', DIRTY_WORKTREE: 'Stage or discard the unstaged changes first',
  };
  let current = 'CONFLICTED';
  stubGraph(linearWorld(2), {
    'POST api/ops/commit.state': { ok: true, result: { merging: false } },
    'POST api/ops/head.continue': () => answers[current].clone(),
  });
  render(createElement(Toasts));
  for (const code of Object.keys(answers)) {
    current = code;
    await continueFlow(T, 'merge');
    await waitFor(() => expect(toastText()).toContain(expected[code]));
  }
  expect(toastText()).toContain('Still conflicted: c.txt.');
});

test('skip and abort ask first: Cancel posts nothing', async () => {
  const w = world({ 'head.skip': { outcome: 'done', files: [], oid: null, undo }, 'head.abort': { undo } });
  const skipping = skipFlow(T, 'cherry-pick');
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Skip commit'));
  act(() => settleConfirm(false));
  await skipping;
  const aborting = abortFlow(T, 'merge');
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Abort merge'));
  act(() => settleConfirm(false));
  await aborting;
  expect([w.posts('head.skip'), w.posts('head.abort')]).toEqual([[], []]);
});
