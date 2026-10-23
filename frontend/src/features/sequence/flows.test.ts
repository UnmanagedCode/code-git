import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { Toasts } from '@/shell/Toasts';
import { json } from '@/test/fixtures';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { tabKey } from '@/state/tabs';
import { workdirOf } from '@/state/workdir';
import { ref, refsResult } from '@/test/graphData';
import { abortFlow, continueFlow, mergeFlow, rebaseFlow, skipFlow } from './flows';

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

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
/** HEAD on `head` (a code-conductor/* one needs the acknowledgement for a rebase). */
const setHead = (head: string) => graphStore.set(new Map([[tabKey(T), {
  ...EMPTY_GRAPH, status: 'ready', refs: refsResult({ head: { oid: A, branch: `refs/heads/${head}`, detached: false, unborn: false }, refs: [ref(`refs/heads/${head}`, A, { isHead: true })] }),
}]]));

test.each([
  ['upToDate', 'main is already up to date with feature'], ['fastForward', 'Fast-forwarded main to feature'], ['merged', 'Merged feature into main'],
])('merge outcome %s toasts "%s"', async (outcome, text) => {
  world({ 'merge.start': { outcome, files: [], oid: B, message: null, undo } });
  await mergeFlow(T, { ref: 'refs/heads/feature', oid: B, label: 'feature', into: 'main', expect: A, mode: 'ff' });
  await waitFor(() => expect(toastText()).toContain(text));
});

test('a merge that stops on conflicts warns with the files and Abort…; a squash\'s conflicts offer Resolve… only (nothing to abort)', async () => {
  world({ 'merge.start': { outcome: 'conflicts', files: ['m.txt'], oid: A, message: null, undo } });
  await mergeFlow(T, { ref: null, oid: B, label: 'bbbbbbb', into: 'main', expect: A, mode: 'noFf' });
  await waitFor(() => expect(toastText()).toContain('The merge stopped on conflicts'));
  expect(screen.getAllByRole('button', { name: 'Abort…' }).length).toBe(1);
  toast.dismiss();
  await waitFor(() => expect(toastText()).toBe(''));
  await mergeFlow(T, { ref: null, oid: B, label: 'bbbbbbb', into: 'main', expect: A, mode: 'squash' });
  await waitFor(() => expect(toastText()).toContain('The squash stopped on conflicts'));
  expect(screen.queryByRole('button', { name: 'Abort…' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Resolve…' })).toBeTruthy();
});

test('a squash pre-fills the commit box with git\'s prepared message (summary and description) and opens Changes', async () => {
  world({ 'merge.start': { outcome: 'squashed', files: [], oid: A, message: 'Squashed commit of the following:\n\ncommit b\n    feature change\n', undo } });
  await mergeFlow(T, { ref: 'refs/heads/feature', oid: B, label: 'feature', into: 'main', expect: A, mode: 'squash' });
  expect(workdirOf(T).draft).toEqual({ summary: 'Squashed commit of the following:', description: 'commit b\n    feature change' });
  expect(workdirOf(T).focus).toBe('slot');
  await waitFor(() => expect(toastText()).toContain('Squashed feature into the index'));
});

test('a rebase of a plain HEAD runs at once; of a code-conductor/* HEAD only after the warning, then with ccOwned', async () => {
  setHead('main');
  const w = world({ 'rebase.start': { outcome: 'done', files: [], oid: B, undo } });
  rebaseFlow(T, { onto: B, upstream: B, expect: A, branch: 'main', ontoLabel: 'feature' });
  await waitFor(() => expect(w.posts('rebase.start')).toEqual([{ onto: B, upstream: B, expect: A }]));
  await waitFor(() => expect(toastText()).toContain('Rebased main onto feature'));
  setHead('code-conductor/wt');
  rebaseFlow(T, { onto: B, upstream: B, expect: A, branch: 'code-conductor/wt', ontoLabel: 'feature' });
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Rebase anyway'));
  expect(w.posts('rebase.start')).toHaveLength(1);
  act(() => settleConfirm(true));
  await waitFor(() => expect(w.posts('rebase.start')[1]).toEqual({ onto: B, upstream: B, expect: A, ccOwned: true }));
});

test('rebase refusals say what to do: HAS_MERGES, DIRTY_WORKTREE, OPERATION_IN_PROGRESS', async () => {
  setHead('main');
  let code = 'HAS_MERGES';
  stubGraph(linearWorld(2), {
    'POST api/ops/commit.state': { ok: true, result: { merging: false } },
    'POST api/ops/rebase.start': () => json({ error: 'x', code }, 409),
  });
  render(createElement(Toasts));
  const expected: Record<string, string> = {
    HAS_MERGES: 'The commits to rebase include a merge: rebase them with git', DIRTY_WORKTREE: 'Commit or stash first',
    OPERATION_IN_PROGRESS: 'Something is already in progress: continue or abort it first',
  };
  for (const c of Object.keys(expected)) {
    code = c;
    rebaseFlow(T, { onto: B, upstream: B, expect: A, branch: 'main', ontoLabel: 'feature' });
    await waitFor(() => expect(toastText()).toContain(expected[c]));
  }
});
