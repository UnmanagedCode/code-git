import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { Toasts } from '@/shell/Toasts';
import { updateRemotePrefs } from '@/state/remotePrefs';
import { getRemotes } from '@/state/remotes';
import { dispatchTabs } from '@/state/tabs';
import { activityStore } from '@/state/useActivity';
import { entry } from '@/test/fixtures';
import { refusal, remotesWorld, T } from '@/test/remotesWorld';
import { setRemoteClock } from './autoFetch';
import { RemotesHost } from './RemotesHost';

afterEach(() => {
  toast.dismiss();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
const toasts = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent ?? '');

/** A clock whose timers run only when the test ticks them. */
function manualClock() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  setRemoteClock({ setInterval: (fn, ms) => { timers.set(++next, { fn, ms }); return next; }, clearInterval: (id) => { timers.delete(id as number); } });
  return { timers, tick: () => act(() => { for (const t of timers.values()) t.fn(); }) };
}

function setup(answers: Record<string, unknown> = {}) {
  const clock = manualClock();
  const w = remotesWorld({ answers });
  act(() => dispatchTabs({ type: 'open', tab: T }));
  render(createElement('div', null, createElement(RemotesHost), createElement(Toasts)));
  return { ...clock, ...w };
}

test('off by default: no timer; turning it on starts one at the interval, which fetches every remote and never prunes', async () => {
  const w = setup();
  expect(w.timers.size).toBe(0);
  act(() => updateRemotePrefs('app', { autoFetchMinutes: 5 }));
  expect([...w.timers.values()].map((t) => t.ms)).toEqual([5 * 60_000]);
  w.tick();
  await waitFor(() => expect(w.posts('remote.fetch')).toEqual([{ remote: null }]));
  act(() => updateRemotePrefs('app', { autoFetchMinutes: 0 }));
  expect(w.timers.size).toBe(0);
});

test('one timer per project with an open tab, however many of its tabs are open', () => {
  const w = setup();
  act(() => updateRemotePrefs('app', { autoFetchMinutes: 1 }));
  act(() => dispatchTabs({ type: 'open', tab: { project: 'app', worktree: 'wt' } }));
  expect(w.timers.size).toBe(1);
  act(() => dispatchTabs({ type: 'open', tab: { project: 'other', worktree: null } }));
  expect(w.timers.size).toBe(1);
  act(() => updateRemotePrefs('other', { autoFetchMinutes: 15 }));
  expect([...w.timers.values()].map((t) => t.ms).sort()).toEqual([60_000, 15 * 60_000]);
});

test('a tick skips while the page is hidden, while a write of the project runs, and while a fetch of it is in flight; quiet on success', async () => {
  let release!: (v: unknown) => void;
  let hold = false;
  const ok = { remotes: [{ remote: 'origin', changes: [], pruned: [], symrefsResolved: [], partial: null }], undo: {} };
  const w = setup({ 'remote.fetch': () => (hold ? new Promise((r) => { release = r; }) : ok) });
  act(() => updateRemotePrefs('app', { autoFetchMinutes: 1 }));
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  w.tick();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  activityStore.set({ entries: [entry({ status: 'running', kind: 'write', op: 'commit.create' })], error: null });
  w.tick();
  expect(w.posts('remote.fetch')).toEqual([]);
  activityStore.set({ entries: [entry({ status: 'running', kind: 'write', target: { project: 'other', worktree: null } }), entry({ status: 'running', kind: 'read' })], error: null });
  hold = true;
  w.tick();
  await waitFor(() => expect(w.posts('remote.fetch')).toHaveLength(1), { timeout: 2000 });
  expect(getRemotes('app').busy.fetch).toBe(true);
  w.tick();
  expect(w.posts('remote.fetch')).toHaveLength(1);
  release(ok);
  await waitFor(() => expect(getRemotes('app').busy.fetch).toBe(false));
  expect(toasts()).toEqual([]);
});

test('one toast per failure streak, a per-remote error counts as a failure, and the toolbar\'s mark clears on success', async () => {
  let answer: () => unknown = () => refusal('REMOTE_UNREACHABLE', 'origin could not be reached', { reason: 'unavailable' }, 502);
  const w = setup({ 'remote.fetch': () => answer() });
  act(() => updateRemotePrefs('app', { autoFetchMinutes: 1 }));
  w.tick();
  await waitFor(() => expect(toasts().filter((t) => t.includes('Auto-fetch failed'))).toHaveLength(1));
  expect(toasts()[0]).toContain('origin could not be reached');
  expect(getRemotes('app').autoFetchError).toBe('origin could not be reached');
  answer = () => ({ remotes: [{ remote: 'origin', error: { code: 'REMOTE_AUTH_FAILED', message: 'origin refused the credentials', stderr: null } }], undo: {} });
  w.tick();
  await waitFor(() => expect(getRemotes('app').autoFetchError).toBe('origin: origin refused the credentials'));
  expect(toasts().filter((t) => t.includes('Auto-fetch failed'))).toHaveLength(1);
  answer = () => ({ remotes: [{ remote: 'origin', changes: [], pruned: [], symrefsResolved: [], partial: null }], undo: {} });
  w.tick();
  await waitFor(() => expect(getRemotes('app').autoFetchError).toBeNull());
  answer = () => refusal('REMOTE_UNREACHABLE', 'origin could not be reached again', {}, 502);
  w.tick();
  await waitFor(() => expect(toasts().filter((t) => t.includes('Auto-fetch failed'))).toHaveLength(2));
});

test("a project open only in a submodule tab is auto-fetched through its checkout (target without sub), the submodule never", async () => {
  const clock = manualClock();
  const w = remotesWorld({});
  act(() => dispatchTabs({ type: 'open', tab: { ...T, sub: ['libs/a'] } }));
  render(createElement('div', null, createElement(RemotesHost), createElement(Toasts)));
  act(() => updateRemotePrefs('app', { autoFetchMinutes: 5 }));
  expect(clock.timers.size).toBe(1);
  clock.tick();
  await waitFor(() => expect(w.fetch.calls.filter((c) => c.url.pathname.endsWith('/ops/remote.fetch'))).toHaveLength(1));
  const sent = w.fetch.calls.filter((c) => c.url.pathname.endsWith('/ops/remote.fetch')).map((c) => (c.body as { target: unknown }).target);
  expect(sent).toEqual([{ project: 'app' }]);
});
