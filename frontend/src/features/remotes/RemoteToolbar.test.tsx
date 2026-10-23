import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { Toasts } from '@/shell/Toasts';
import { remotesStore } from '@/state/remotes';
import { refusal, remote, remotesWorld, T } from '@/test/remotesWorld';
import { RemoteToolbar } from './RemoteToolbar';

afterEach(() => { toast.dismiss(); });
const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join('|');
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const show = () => render(<><RemoteToolbar tab={T} /><Toasts /></>);
const openOptions = () => userEvent.click(button('Pull options'));
/** A route answer held until `release(value)`. */
function held() {
  let release!: (v: unknown) => void;
  const p = new Promise((r) => { release = r; });
  return { answer: () => p, release };
}

test('disabled states: Fetch without a remote, Pull without an upstream on a remote, Push and Pull on a detached HEAD', async () => {
  remotesWorld();
  const { unmount } = show();
  expect([button('Fetch').disabled, button('Pull').disabled, button('Push').disabled]).toEqual([false, false, false]);
  unmount();
  remotesWorld({ remotes: [] });
  const second = show();
  await waitFor(() => expect(button('Fetch').disabled).toBe(true));
  second.unmount();
  remotesWorld({ upstream: false });
  const third = show();
  expect([button('Pull').disabled, button('Push').disabled]).toEqual([true, false]);
  third.unmount();
  remotesWorld({ head: null });
  show();
  expect([button('Pull').disabled, button('Push').disabled]).toEqual([true, true]);
});

test('a running fetch shows its button busy and disabled until it answers; the remotes are listed again after', async () => {
  const h = held();
  const w = remotesWorld({ answers: { 'remote.fetch': h.answer } });
  show();
  await userEvent.click(button('Fetch'));
  await waitFor(() => expect(button('Fetch').getAttribute('aria-busy')).toBe('true'));
  expect(button('Fetch').disabled).toBe(true);
  expect(w.posts('remote.fetch')).toEqual([{ remote: null }]);
  const listed = w.posts('remote.list').length;
  h.release({ remotes: [{ remote: 'origin', changes: [{ ref: 'refs/remotes/origin/main', old: 'a'.repeat(40), new: 'b'.repeat(40) }], pruned: [], symrefsResolved: [], partial: null }], undo: {} });
  await waitFor(() => expect(button('Fetch').disabled).toBe(false));
  expect(button('Fetch').getAttribute('aria-busy')).toBeNull();
  await waitFor(() => expect(toastText()).toContain('Fetched all remotes: 1 updated'));
  await waitFor(() => expect(w.posts('remote.list').length).toBeGreaterThan(listed));
});

test('the default pull mode is chosen in the menu, persisted per project, and run by the Pull button', async () => {
  const w = remotesWorld({ answers: { 'remote.pull': (p: { mode: string }) => ({ mode: p.mode, upstream: 'refs/remotes/origin/main', outcome: 'rebased', files: [], oid: 'x', fetch: {}, undo: {} }) } });
  show();
  await userEvent.click(button('Pull'));
  await waitFor(() => expect(w.posts('remote.pull')).toEqual([{ mode: 'ff' }]));
  await openOptions();
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Rebase' }));
  expect(JSON.parse(localStorage.getItem('code-git:remotes:app')!)).toMatchObject({ pullMode: 'rebase' });
  await userEvent.click(button('Pull'));
  await waitFor(() => expect(w.posts('remote.pull')).toEqual([{ mode: 'ff' }, { mode: 'rebase' }]));
  await waitFor(() => expect(toastText()).toContain('Rebased main onto origin/main'));
  await openOptions();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Pull (fast-forward only)' }));
  await waitFor(() => expect(w.posts('remote.pull').at(-1)).toEqual({ mode: 'ffOnly' }));
});

test('Fetch all (prune)… asks first: cancel sends nothing, confirm sends prune', async () => {
  const w = remotesWorld();
  show();
  await openOptions();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Fetch all (prune)…' }));
  await waitFor(() => expect(confirmStore.get()?.opts.body).toContain('local branches and tags are untouched'));
  settleConfirm(false);
  await new Promise((r) => setTimeout(r, 0));
  expect(w.posts('remote.fetch')).toEqual([]);
  await openOptions();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Fetch all (prune)…' }));
  await waitFor(() => expect(confirmStore.get()).toBeTruthy());
  settleConfirm(true);
  await waitFor(() => expect(w.posts('remote.fetch')).toEqual([{ remote: null, prune: true }]));
});

test('an auth failure toasts the backend\'s readable message with git\'s stderr', async () => {
  remotesWorld({ answers: { 'remote.fetch': () => refusal('REMOTE_AUTH_FAILED', 'origin needs credentials and code-git cannot prompt: configure a credential helper or an ssh key/agent on the project\'s System', { reason: 'prompt', stderr: 'fatal: could not read Username' }, 502) } });
  show();
  await userEvent.click(button('Fetch'));
  await waitFor(() => expect(toastText()).toContain('origin needs credentials and code-git cannot prompt'));
  expect(toastText()).toContain('fatal: could not read Username');
});

test('pull outcomes: diverged under ff-only says what to pick; a merge conflict offers Abort merge…, which asks before head.abort merge', async () => {
  const w = remotesWorld({ answers: {
    'remote.pull': (p: { mode: string }) => (p.mode === 'ffOnly'
      ? refusal('NOT_FAST_FORWARD', 'main and origin/main have diverged')
      : { mode: 'ff', upstream: 'refs/remotes/origin/main', outcome: 'conflicts', files: ['f.txt'], oid: 'x', fetch: {}, undo: {} }),
  } });
  show();
  await openOptions();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Pull (fast-forward only)' }));
  await waitFor(() => expect(toastText()).toContain('Diverged: pick Pull (fast-forward if possible) or Pull (rebase)'));
  await userEvent.click(button('Pull'));
  await waitFor(() => expect(toastText()).toContain('The pull stopped on conflicts'));
  expect(toastText()).toContain('Conflicts in f.txt.');
  await userEvent.click(screen.getByRole('button', { name: 'Abort merge…' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Abort merge'));
  expect(w.posts('head.abort')).toEqual([]);
  settleConfirm(true);
  await waitFor(() => expect(w.posts('head.abort')).toEqual([{ which: 'merge' }]));
});

test('a rebase pull on a code-conductor/* HEAD asks first and then sends ccOwned; DIRTY_WORKTREE says what happened', async () => {
  const w = remotesWorld({ head: 'code-conductor/wt', answers: { 'remote.pull': (p: { ccOwned?: boolean }) => (p.ccOwned
    ? { mode: 'rebase', upstream: 'refs/remotes/origin/code-conductor/wt', outcome: 'rebased', files: [], oid: 'x', fetch: {}, undo: {} }
    : refusal('DIRTY_WORKTREE', 'commit or stash the local changes first')) } });
  show();
  await openOptions();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Pull (rebase)' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Rebase anyway'));
  expect(w.posts('remote.pull')).toEqual([]);
  settleConfirm(true);
  await waitFor(() => expect(w.posts('remote.pull')).toEqual([{ mode: 'rebase', ccOwned: true }]));
  await waitFor(() => expect(toastText()).toContain('Rebased'));
  await userEvent.click(button('Pull'));
  await waitFor(() => expect(toastText()).toContain('Commit or stash first'));
});

test('a rebase pull that stops on conflicts toasts "The pull stopped on conflicts" with Abort rebase…, which confirms, then aborts the rebase', async () => {
  const w = remotesWorld({ answers: {
    'remote.pull': { mode: 'rebase', upstream: 'refs/remotes/origin/main', outcome: 'conflicts', files: ['g.txt'], oid: 'x', fetch: {}, undo: {} },
  } });
  show();
  await openOptions();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Pull (rebase)' }));
  await waitFor(() => expect(toastText()).toContain('The pull stopped on conflicts'));
  expect(toastText()).toContain('Conflicts in g.txt.');
  await userEvent.click(screen.getByRole('button', { name: 'Abort rebase…' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Abort rebase'));
  expect(w.posts('head.abort')).toEqual([]);
  settleConfirm(true);
  await waitFor(() => expect(w.posts('head.abort')).toEqual([{ which: 'rebase' }]));
});

test('an auto-fetch failure marks Fetch with a warning naming the reason', async () => {
  remotesWorld();
  show();
  expect(document.querySelector('[data-fetch-warning]')).toBeNull();
  remotesStore.set((m) => new Map(m).set('app', { ...m.get('app')!, autoFetchError: 'origin could not be reached' }));
  await waitFor(() => expect(document.querySelector('[data-fetch-warning]')).not.toBeNull());
  expect(button(/^Fetch/).getAttribute('aria-label')).toBe('Fetch (auto-fetch failed: origin could not be reached)');
});

test('the auto-fetch interval is chosen in a submenu and persisted', async () => {
  remotesWorld({ remotes: [remote('origin'), remote('upstream')] });
  show();
  await openOptions();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Auto-fetch: Off' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Every 5 min' }));
  expect(JSON.parse(localStorage.getItem('code-git:remotes:app')!)).toMatchObject({ autoFetchMinutes: 5 });
});
