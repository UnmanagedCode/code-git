import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { Toasts } from '@/shell/Toasts';
import { remoteDialogStore } from '@/state/remoteDialog';
import { HEAD_OID, ORIGIN_MAIN, refusal, remotesWorld, T } from '@/test/remotesWorld';
import { pushFlow, pushHead } from './pushFlow';

afterEach(() => { toast.dismiss(); });
const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join('|');
const clickToastAction = async (name: string) => userEvent.click(within(screen.getByRole('region', { name: /Notifications/ })).getByRole('button', { name }));
const pending = () => confirmStore.get()?.opts;

const REJECTED = (tracking = ORIGIN_MAIN) => refusal('PUSH_REJECTED', 'origin rejected the push: refs/heads/main: fetch first', {
  rejected: [{ ref: 'refs/heads/main', reason: 'fetch first' }], remote: 'origin', to: 'main', tracking: { ref: 'refs/remotes/origin/main', oid: tracking },
});

test('a rejected push offers Force with lease: it peeks, confirms naming both commits, and re-pushes leasing on the remote oid it showed', async () => {
  render(createElement(Toasts));
  let n = 0;
  const w = remotesWorld({ answers: { 'remote.push': () => (n++ === 0 ? REJECTED() : { remote: 'origin', branch: 'main', to: 'main', created: false, forced: true, upToDate: false, upstreamSet: false, unrequested: [], undo: {} }) } });
  await pushFlow(T, { branch: 'main' });
  await waitFor(() => expect(toastText()).toContain('refs/heads/main: fetch first'));
  expect(w.posts('remote.push')).toEqual([{ branch: 'main' }]);
  await clickToastAction('Force with lease…');
  await waitFor(() => expect(pending()?.confirmLabel).toBe('Force push'));
  expect(w.posts('remote.peek')).toEqual([{ remote: 'origin', branch: 'main' }]);
  expect(pending()!.body).toContain(`origin/main (at ${ORIGIN_MAIN.slice(0, 7)}) with main (${HEAD_OID.slice(0, 7)})`);
  expect(pending()!.irreversible).toBe(true);
  settleConfirm(true);
  await waitFor(() => expect(w.posts('remote.push')).toHaveLength(2));
  expect(w.posts('remote.push')[1]).toEqual({ branch: 'main', remote: 'origin', to: 'main', forceWithLease: { expect: ORIGIN_MAIN } });
  await waitFor(() => expect(toastText()).toContain('Force-pushed main to origin/main'));
});

test('a stale tracking ref offers Fetch, never force: confirming fetches that remote and sends no push', async () => {
  render(createElement(Toasts));
  const moved = 'e'.repeat(40);
  const w = remotesWorld({ answers: { 'remote.push': () => REJECTED(), 'remote.peek': { oid: moved, tracking: { ref: 'refs/remotes/origin/main', oid: ORIGIN_MAIN }, stale: true } } });
  await pushFlow(T, { branch: 'main' });
  await waitFor(() => expect(toastText()).toContain('rejected'));
  await clickToastAction('Force with lease…');
  await waitFor(() => expect(pending()?.confirmLabel).toBe('Fetch origin'));
  expect(pending()!.title).toBe('origin/main moved since the last fetch');
  expect(pending()!.body).toContain(`at ${moved.slice(0, 7)}; the remote-tracking ref here says ${ORIGIN_MAIN.slice(0, 7)}`);
  settleConfirm(true);
  await waitFor(() => expect(w.posts('remote.fetch')).toEqual([{ remote: 'origin' }]));
  expect(w.posts('remote.push')).toHaveLength(1);
});

test('cancelling the force confirmation sends nothing more', async () => {
  render(createElement(Toasts));
  const w = remotesWorld({ answers: { 'remote.push': () => REJECTED() } });
  await pushFlow(T, { branch: 'main' });
  await waitFor(() => expect(toastText()).toContain('rejected'));
  await clickToastAction('Force with lease…');
  await waitFor(() => expect(pending()).toBeTruthy());
  settleConfirm(false);
  await new Promise((r) => setTimeout(r, 0));
  expect(w.posts('remote.push')).toHaveLength(1);
  expect(w.posts('remote.fetch')).toHaveLength(0);
});

test('a lease the remote refused again offers no second force', async () => {
  render(createElement(Toasts));
  remotesWorld({ answers: { 'remote.push': () => REJECTED() } });
  await pushFlow(T, { branch: 'main', remote: 'origin', to: 'main' });
  await waitFor(() => expect(toastText()).toContain('rejected'));
  await clickToastAction('Force with lease…');
  await waitFor(() => expect(pending()).toBeTruthy());
  settleConfirm(true);
  await waitFor(() => expect(toastText()).toContain('the lease refused the force push'));
  const second = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')].find((t) => t.textContent?.includes('the lease refused'))!;
  expect(within(second).queryByRole('button', { name: 'Force with lease…' })).toBeNull();
});

test('a code-conductor/* source or destination asks first: cancel sends nothing, confirm sends ccOwned', async () => {
  const w = remotesWorld();
  const first = pushFlow(T, { branch: 'code-conductor/wt' });
  await waitFor(() => expect(pending()?.confirmLabel).toBe('Push anyway'));
  expect(pending()!.body).toContain('code-conductor/wt is owned by code-conductor');
  settleConfirm(false);
  await first;
  expect(w.posts('remote.push')).toEqual([]);
  const second = pushFlow(T, { branch: 'main', remote: 'origin', to: 'code-conductor/x' });
  await waitFor(() => expect(pending()).toBeTruthy());
  settleConfirm(true);
  await second;
  expect(w.posts('remote.push')).toEqual([{ branch: 'main', remote: 'origin', to: 'code-conductor/x', ccOwned: true }]);
  await pushFlow(T, { branch: 'feature', remote: 'origin', to: 'feature' });
  expect(w.posts('remote.push')[1]).toEqual({ branch: 'feature', remote: 'origin', to: 'feature' });
  expect(pending()).toBeFalsy();
});

test('pushHead: a branch with an upstream pushes at once; one without opens the Push dialog; a detached HEAD does nothing', async () => {
  let w = remotesWorld();
  pushHead(T);
  await waitFor(() => expect(w.posts('remote.push')).toEqual([{ branch: 'main' }]));
  w = remotesWorld({ upstream: false });
  pushHead(T);
  expect(remoteDialogStore.get()).toEqual({ kind: 'push', tab: T, branch: 'main', remote: null });
  remoteDialogStore.set(null);
  w = remotesWorld({ head: null });
  pushHead(T);
  expect(remoteDialogStore.get()).toBeNull();
  expect(w.posts('remote.push')).toEqual([]);
});
