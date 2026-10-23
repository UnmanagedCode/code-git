import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test, vi } from 'vitest';
import { Toasts } from '@/shell/Toasts';
import { ApiError } from './api';
import { trackOp } from './opToast';

afterEach(() => { toast.dismiss(); });

const toastsEl = () => screen.getByRole('region', { name: /Notifications/ });
const toastTexts = () => [...toastsEl().querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent);

test('trackOp shows the running text, then the success text in the same toast, and resolves ok with the result', async () => {
  render(<Toasts />);
  let finish!: (v: number) => void;
  const p = trackOp(() => new Promise<number>((r) => { finish = r; }), { running: 'Pushing v1…', done: (n) => `Pushed ${n} tag` });
  await waitFor(() => expect(toastTexts()).toEqual(['Pushing v1…']));
  await act(async () => finish(1));
  await expect(p).resolves.toEqual({ ok: true, result: 1 });
  await waitFor(() => expect(toastTexts()).toEqual(['Pushed 1 tag']));
});

test('a failure turns the toast into the error message with git\'s stderr, an optional action, and resolves ok: false', async () => {
  render(<Toasts />);
  const onClick = vi.fn();
  const err = new ApiError(422, 'git push exited with 1', 'GIT_FAILED', { stderr: 'pre-push hook refuses\n' });
  const r = await trackOp(() => Promise.reject(err), {
    running: 'Pushing…', done: () => 'never', failed: () => ({ action: { label: 'Retry', onClick } }),
  });
  expect(r).toEqual({ ok: false, error: err });
  await waitFor(() => expect(toastTexts().join('')).toContain('git push exited with 1'));
  expect(toastTexts().join('')).toContain('pre-push hook refuses');
  await userEvent.click(within(toastsEl()).getByRole('button', { name: 'Retry' }));
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('toastRunning false shows no running or error toast, only success', async () => {
  render(<Toasts />);
  const r = await trackOp(() => Promise.reject(new Error('boom')), { running: 'Deleting…', done: () => 'x', toastRunning: false });
  expect(r.ok).toBe(false);
  expect(!r.ok && r.error instanceof ApiError && r.error.message).toBe('boom');
  await trackOp(() => Promise.resolve(2), { running: 'Deleting…', done: () => 'Deleted 2 branches', toastRunning: false });
  await waitFor(() => expect(toastTexts()).toEqual(['Deleted 2 branches']));
});

test('a warning outcome keeps its action; untrusted text renders as text', async () => {
  render(<Toasts />);
  await trackOp(() => Promise.resolve(0), {
    running: 'r', done: () => ({ tone: 'warning', title: '<img src=x onerror=alert(1)>', description: '<b>files</b>', action: { label: 'Abort', onClick: () => {} } }),
  });
  await waitFor(() => expect(toastTexts().join('')).toContain('<img src=x onerror=alert(1)>'));
  expect(toastsEl().querySelector('img, b')).toBeNull();
  expect(within(toastsEl()).getByRole('button', { name: 'Abort' })).toBeTruthy();
});
