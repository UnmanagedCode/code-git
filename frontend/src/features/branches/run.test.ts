import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { Toasts } from '@/shell/Toasts';
import { json } from '@/test/fixtures';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { checkoutBranch, cherryPick, pushTags } from './api';
import { applyToast, CONFLICT_FILES_SHOWN, runRefOp } from './run';

const T = { project: 'app', worktree: null };
afterEach(() => { toast.dismiss(); });
const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join('|');

test('runRefOp refreshes the tab\'s graph (refs and summaries) after a success and after a failure', async () => {
  const fetch = stubGraph(linearWorld(2), {
    'POST api/ops/branch.checkout': (_u: URL, init?: RequestInit) => (JSON.parse(String(init?.body)).params.ref === 'refs/heads/ok'
      ? { ok: true, result: { branch: 'refs/heads/ok' } }
      : json({ error: 'no branch nope', code: 'REF_UNKNOWN' }, 404)),
  });
  const ok = await runRefOp(T, { running: 'Checking out…', done: () => 'Checked out' }, () => checkoutBranch(T, 'refs/heads/ok'));
  expect(ok.ok).toBe(true);
  await waitFor(() => expect(fetch.count('POST api/ops/graph.refs')).toBe(1));
  const bad = await runRefOp(T, { running: 'Checking out…', done: () => 'Checked out' }, () => checkoutBranch(T, 'refs/heads/nope'));
  expect(bad.ok).toBe(false);
  await waitFor(() => expect(fetch.count('POST api/ops/graph.refs')).toBe(2));
  expect(fetch.count('POST api/ops/repo.summary')).toBeGreaterThanOrEqual(2);
});

test('a CHECKOUT_CONFLICT toast lists the first files, counts the rest and says what to do', async () => {
  render(createElement(Toasts));
  const files = Array.from({ length: CONFLICT_FILES_SHOWN + 2 }, (_, i) => `f${i}.txt`);
  stubGraph(linearWorld(2), {
    'POST api/ops/branch.checkout': json({ error: 'local changes would be overwritten', code: 'CHECKOUT_CONFLICT', files, stderr: 'error: …' }, 409),
  });
  await runRefOp(T, { running: 'Checking out…', done: () => 'x' }, () => checkoutBranch(T, 'refs/heads/b'));
  await waitFor(() => expect(toastText()).toContain('Local changes would be overwritten'));
  expect(toastText()).toContain(`f0.txt, f1.txt, f2.txt, f3.txt, f4.txt and 2 more. Commit, stash or discard these changes first.`);
});

test('a cherry-pick that stops on conflicts toasts a warning whose Abort runs head.abort', async () => {
  render(createElement(Toasts));
  const fetch = stubGraph(linearWorld(2), {
    'POST api/ops/head.cherryPick': { ok: true, result: { conflicts: true, files: ['f.txt'], oid: null, undo: {} } },
    'POST api/ops/head.abort': { ok: true, result: { undo: {} } },
  });
  await runRefOp(T, { running: 'Cherry-picking…', done: applyToast(T, 'cherry-pick', 'Cherry-picked') }, () => cherryPick(T, 'a'.repeat(40)));
  await waitFor(() => expect(toastText()).toContain('Cherry-pick stopped on conflicts'));
  expect(toastText()).toContain('Conflicts in f.txt.');
  const region = screen.getByRole('region', { name: /Notifications/ });
  await userEvent.click(within(region).getByRole('button', { name: 'Abort' }));
  await waitFor(() => expect(fetch.count('POST api/ops/head.abort')).toBe(1));
  const body = fetch.calls.find((c) => c.url.pathname.endsWith('head.abort'))!.body as { params: unknown };
  expect(body.params).toEqual({ which: 'cherry-pick' });
});

test('a fully rejected push toasts each rejected ref with its reason', async () => {
  render(createElement(Toasts));
  stubGraph(linearWorld(2), {
    'POST api/ops/tag.push': json({ error: 'origin rejected the push: …', code: 'PUSH_REJECTED', rejected: [{ ref: 'refs/tags/v1', reason: 'already exists' }] }, 409),
  });
  await runRefOp(T, { running: 'Pushing v1…', done: () => 'x' }, () => pushTags(T, 'origin', ['v1']));
  await waitFor(() => expect(toastText()).toContain('The remote rejected the push'));
  expect(toastText()).toContain('refs/tags/v1: already exists');
});
