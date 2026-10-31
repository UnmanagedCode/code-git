import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { App } from './App';
import { fileHistoryStore } from '@/features/history/state';
import { cancelLink } from '@/features/links/inbound';
import { cancelMenuTarget } from '@/features/links/menu';
import type { Repo, Worktree } from '@/lib/endpoints';
import { Toasts } from '@/shell/Toasts';
import { getSelection } from '@/state/graphSelection';
import { dispatchTabs, tabKey, tabsStore, type Tab } from '@/state/tabs';
import { reposStore } from '@/state/useRepos';
import { json, repo, summary } from '@/test/fixtures';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { oid } from '@/test/graphData';
import { stubFetch } from '@/test/stubFetch';

function stub() {
  return stubFetch({
    'GET api/repos': { repos: [] },
    'GET api/activity': { entries: [], runs: [] },
    'POST api/ops/repo.summary': { ok: true, result: summary() },
  });
}

test('with no tabs, the shell offers the picker', async () => {
  stub();
  render(<App />);
  expect(await screen.findByText('No repository open.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open a repository' }));
  expect(await screen.findByRole('dialog', { name: 'Open a repository' })).toBeTruthy();
});

test('the URL names the tab to open on load, beside the persisted ones', async () => {
  stub();
  localStorage.setItem('code-git:tabs', JSON.stringify({ open: [{ project: 'kept', worktree: null }], active: 0 }));
  history.replaceState(null, '', '?project=app&worktree=feat');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'app/feat' })).toBeTruthy();
  expect(tabsStore.get().open.map((t) => t.project)).toEqual(['kept', 'app']);
});

test('the active tab is mirrored into the query string, and popstate opens the tab it names', async () => {
  stub();
  render(<App />);
  act(() => dispatchTabs({ type: 'open', tab: { project: 'one', worktree: null } }));
  expect(location.search).toBe('?project=one');
  act(() => dispatchTabs({ type: 'open', tab: { project: 'two', worktree: 'wt' } }));
  expect(location.search).toBe('?project=two&worktree=wt');
  history.replaceState(null, '', '?project=one');
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(tabsStore.get().active).toBe(0);
  expect(await screen.findByRole('heading', { name: 'one' })).toBeTruthy();
});

// ---- links from code-review (lib/route.ts → consumeLink, features/links/inbound.ts) ----

afterEach(() => cancelLink());

const APP = { project: 'app', worktree: null };
const linkWorld = () => stubGraph(linearWorld(5), {
  'GET api/repos': { repos: [] },
  'GET api/activity': { entries: [], runs: [] },
  'GET api/repos/other/worktrees': { worktrees: [] },
  'POST api/ops/history.file': { ok: true, result: { items: [], nextCursor: null, truncated: false } },
});

test('a commit link on load is stripped from the URL in place and selects the commit once the graph is ready', async () => {
  linkWorld();
  history.replaceState(null, '', `?project=app&commit=${oid(2)}`);
  const before = history.length;
  render(<App />);
  expect(location.search).toBe('?project=app');
  expect(history.length).toBe(before);
  await waitFor(() => expect(getSelection(APP).ids).toEqual([oid(2)]));
});

// Each pop switches tabs: stripped after the tab opened, the tab store's writeRoute would push an entry holding the link.
test('a link arriving by popstate is applied and stripped before its tab opens, with no history entry left holding it', async () => {
  linkWorld();
  const OTHER = { project: 'other', worktree: null };
  history.replaceState(null, '', '?project=other');
  render(<App />);
  await screen.findByRole('region', { name: 'Commit graph' });
  const before = history.length;
  history.replaceState(null, '', `?project=app&commit=${oid(3)}&path=a.txt`);
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(tabsStore.get().open[tabsStore.get().active].project).toBe('app');
  expect(location.search).toBe('?project=app');
  expect(history.length).toBe(before);
  expect(fileHistoryStore.get().get(tabKey(APP))).toMatchObject({ path: 'a.txt', rev: oid(3) });
  history.replaceState(null, '', `?project=other&commit=${oid(4)}`);
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(location.search).toBe('?project=other');
  expect(history.length).toBe(before);
  await waitFor(() => expect(getSelection(OTHER).ids).toEqual([oid(4)]));
});

test('an invalid link opens the tab, applies nothing and is stripped', async () => {
  linkWorld();
  history.replaceState(null, '', '?project=app&commit=xyz&path=../x');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'app' })).toBeTruthy();
  expect(location.search).toBe('?project=app');
  expect(fileHistoryStore.get().size).toBe(0);
  await screen.findByRole('region', { name: 'Commit graph' });
  expect(getSelection(APP).ids).toEqual([]);
});

// main.tsx renders App under StrictMode, whose dev double mount runs the effect twice: the first run consumes the link,
// so its cleanup must not drop the wait the second run cannot restart.
test('under StrictMode a commit link survives the double mount and selects the commit once the graph is ready', async () => {
  linkWorld();
  history.replaceState(null, '', `?project=app&commit=${oid(2)}`);
  render(<StrictMode><App /></StrictMode>);
  expect(location.search).toBe('?project=app');
  await waitFor(() => expect(getSelection(APP).ids).toEqual([oid(2)]));
});

test('under StrictMode a path link opens the file\'s history', async () => {
  linkWorld();
  history.replaceState(null, '', `?project=app&commit=${oid(3)}&path=a.txt`);
  render(<StrictMode><App /></StrictMode>);
  expect(location.search).toBe('?project=app');
  expect(await screen.findByRole('region', { name: 'File history panel' })).toBeTruthy();
  expect(fileHistoryStore.get().get(tabKey(APP))).toMatchObject({ path: 'a.txt', rev: oid(3) });
});

// ---- cc row ⋮ menus (lib/route.ts → consumeMenuTarget, features/links/menu.ts) ----
// `?ccProject=…&ccWorktree=…` on load, or after cc's navigate (a replace + popstate).

afterEach(() => { cancelMenuTarget(); toast.dismiss(); });

const wt = (worktreeName: string): Worktree => ({ worktreeName, branch: null, baseBranch: null, locked: false });
const LISTING = [
  repo({ project: 'kept' }), repo({ project: 'app' }), repo({ project: 'box', system: 'docker', remoteId: 'cc-box' }),
  repo({ project: 'gone', systemUnreachable: 'cc-gone is unreachable' }), repo({ project: 'plain', isGitRepo: false }),
];
type Routes = Parameters<typeof stubFetch>[0];
// The summary is refused, so no tab's graph starts: every worktree listing requested is the menu's own.
const menuWorld = (over: Routes = {}) => stubFetch({
  'GET api/repos': { repos: LISTING },
  'GET api/repos/app/worktrees': { worktrees: [wt('feat')] },
  'GET api/repos/box/worktrees': { worktrees: [wt('w')] },
  'GET api/activity': { entries: [], runs: [] },
  'POST api/ops/repo.summary': () => json({ error: 'no summary here' }, 503),
  ...over,
});
/**
 * An `api/repos` responder that answers `initial` at once until armed, then holds each request until its gate (in request
 * order) is called. The mount's own listings (App's and the picker's) are all requested during render: arm right after it.
 */
function gatedListings(initial: Repo[]) {
  const gates: Array<(repos: Repo[]) => void> = [];
  let armed = false;
  const respond = () => (armed ? new Promise((r) => { gates.push((repos) => r({ repos })); }) : { repos: initial });
  return { gates, respond, arm: () => { armed = true; } };
}
const persist = (open: Tab[], active = 0) => localStorage.setItem('code-git:tabs', JSON.stringify({ open, active }));
const at = (search: string) => history.replaceState(null, '', search);
const navigate = (search: string) => act(() => { at(search); window.dispatchEvent(new PopStateEvent('popstate')); });
const renderApp = () => render(<><App /><Toasts /></>);
const keys = () => tabsStore.get().open.map(tabKey);
const activeKey = () => tabKey(tabsStore.get().open[tabsStore.get().active]);
const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join('|');
const KEPT: Tab = { project: 'kept', worktree: null };
const APP_FEAT: Tab = { project: 'app', worktree: 'feat' };

// Invariant: the cc keys are replaced in place by the active tab's route before the listing answers; the tab opens beside
// the persisted ones once it does, after one worktree listing, with one history entry for the tab.
test('menu: ?ccProject&ccWorktree on load is replaced in place by the active tab\'s route, then opens that worktree beside the persisted tabs', async () => {
  persist([KEPT]);
  const { gates, respond, arm } = gatedListings(LISTING);
  arm();
  const f = menuWorld({ 'GET api/repos': respond });
  at('?ccProject=app&ccWorktree=feat');
  const before = history.length;
  renderApp();
  expect(location.search).toBe('?project=kept');
  expect(history.length).toBe(before);
  expect(keys()).toEqual([tabKey(KEPT)]);
  await waitFor(() => expect(gates.length).toBe(f.count('GET api/repos')));
  await act(async () => gates.forEach((g) => g(LISTING)));
  expect(await screen.findByRole('heading', { name: 'app/feat' })).toBeTruthy();
  expect(keys()).toEqual([tabKey(KEPT), tabKey(APP_FEAT)]);
  expect(activeKey()).toBe(tabKey(APP_FEAT));
  expect(location.search).toBe('?project=app&worktree=feat');
  expect(history.length).toBe(before + 1);
  expect(f.count('GET api/repos/app/worktrees')).toBe(1);
});

// Invariant: project scope (an empty ccWorktree included) opens the main checkout without asking for worktrees.
test.each(['?ccProject=app', '?ccProject=app&ccWorktree='])('menu: %s opens the project\'s main checkout and requests no worktree listing', async (search) => {
  const f = menuWorld();
  at(search);
  renderApp();
  expect(await screen.findByRole('heading', { name: 'app' })).toBeTruthy();
  expect(keys()).toEqual([tabKey({ project: 'app', worktree: null })]);
  expect(location.search).toBe('?project=app');
  expect(f.calls.filter((c) => c.url.pathname.endsWith('/worktrees'))).toEqual([]);
});

// Invariant: an open tab is activated, never duplicated.
test('menu: an already-open checkout is activated, never duplicated', async () => {
  persist([{ project: 'app', worktree: null }, KEPT], 1);
  menuWorld();
  at('?ccProject=app');
  renderApp();
  expect(await screen.findByRole('heading', { name: 'app' })).toBeTruthy();
  expect(keys()).toEqual([tabKey({ project: 'app', worktree: null }), tabKey(KEPT)]);
  expect(tabsStore.get().active).toBe(0);
});

// Invariant: a cc row names a checkout, never a submodule: the checkout's own tab opens (or activates) beside an active
// submodule tab of it, which stays; the replace keeps that submodule tab's route.
test('menu: from an active submodule tab, a project row opens the checkout\'s own tab beside it', async () => {
  const SUB: Tab = { project: 'app', worktree: null, sub: ['libs/a'] };
  persist([SUB]);
  const { gates, respond, arm } = gatedListings(LISTING);
  arm();
  const f = menuWorld({ 'GET api/repos': respond, 'POST api/ops/submodule.list': { ok: true, result: { submodules: [] } } });
  at('?ccProject=app');
  renderApp();
  expect(location.search).toBe('?project=app&sub=libs%2Fa');
  await waitFor(() => expect(gates.length).toBe(f.count('GET api/repos')));
  await act(async () => gates.forEach((g) => g(LISTING)));
  await waitFor(() => expect(keys()).toEqual([tabKey(SUB), tabKey({ project: 'app', worktree: null })]));
  expect(tabsStore.get().active).toBe(1);
  expect(location.search).toBe('?project=app');
});

test('menu: with the checkout\'s tab already open beside an active submodule tab, a project row activates it', async () => {
  const SUB: Tab = { project: 'app', worktree: null, sub: ['libs/a'] };
  persist([SUB, { project: 'app', worktree: null }]);
  menuWorld({ 'POST api/ops/submodule.list': { ok: true, result: { submodules: [] } } });
  at('?ccProject=app');
  renderApp();
  await waitFor(() => expect(tabsStore.get().active).toBe(1));
  expect(keys()).toEqual([tabKey(SUB), tabKey({ project: 'app', worktree: null })]);
});

// Invariant: a reachable remote System opens like a local one, and the fresh listing feeds the header's System badge.
test('menu: a project on a remote System opens like a local one', async () => {
  menuWorld();
  at('?ccProject=box&ccWorktree=w');
  renderApp();
  expect(await screen.findByRole('heading', { name: 'box/w' })).toBeTruthy();
  expect(screen.getByText('docker · cc-box')).toBeTruthy();
});

// Invariant: an untrusted name is checked against cc's listing before any use: a refusal toasts the names (and the
// picker's reason), changes no tab, and no request is built from an unvouched name.
test.each([
  ['an unknown project', '?ccProject=ghost&ccWorktree=w', ['ghost'], []],
  ['an unknown worktree', '?ccProject=app&ccWorktree=ghost', ['app', 'ghost'], ['/api/repos/app/worktrees']],
  ['ccWorktree without ccProject', '?ccWorktree=feat', ['no project'], []],
  ['an empty ccProject', '?ccProject=&ccWorktree=feat', ['no project'], []],
  ['a project on an unreachable System', '?ccProject=gone&ccWorktree=w', ['gone', 'cc-gone is unreachable'], []],
  ['a project that is not a git repo', '?ccProject=plain&ccWorktree=w', ['plain', 'not a git repo'], []],
])('menu: %s toasts, keeps the tabs and builds no request from the name', async (_n, search, needles, worktreeRequests) => {
  persist([KEPT]);
  const f = menuWorld();
  at(search);
  renderApp();
  await waitFor(() => { for (const n of needles) expect(toastText()).toContain(n); });
  expect(keys()).toEqual([tabKey(KEPT)]);
  expect(tabsStore.get().active).toBe(0);
  expect(location.search).toBe('?project=kept');
  expect(f.calls.filter((c) => c.url.pathname.endsWith('/worktrees')).map((c) => c.url.pathname)).toEqual(worktreeRequests);
  expect(f.calls.filter((c) => /ghost|gone|plain/.test(c.url.pathname))).toEqual([]);
});

// Invariant: a name is shown as text, never parsed as markup.
test('menu: a name holding markup is shown as text', async () => {
  const name = '<img src=x onerror=alert(1)>';
  menuWorld();
  at(`?ccProject=${encodeURIComponent(name)}`);
  renderApp();
  await waitFor(() => expect(toastText()).toContain(name));
  expect(document.querySelector('img')).toBeNull();
  expect(keys()).toEqual([]);
});

// Invariant: a failed check is a visible, safe failure.
test.each([
  ['the project listing', '?ccProject=app', { 'GET api/repos': () => json({ error: 'code-conductor is not reachable', code: 'CONDUCTOR_UNAVAILABLE' }, 503) }, 'code-conductor is not reachable'],
  ['the worktree listing', '?ccProject=app&ccWorktree=feat', { 'GET api/repos/app/worktrees': () => json({ error: 'bad gateway from cc' }, 502) }, 'bad gateway from cc'],
])('menu: a failing %s toasts and leaves the tabs alone', async (_n, search, over, message) => {
  persist([KEPT]);
  menuWorld(over);
  at(search);
  renderApp();
  await waitFor(() => expect(toastText()).toContain(message));
  expect(keys()).toEqual([tabKey(KEPT)]);
  expect(location.search).toBe('?project=kept');
});

// Invariant: an open page retargets in place on cc's navigate (no remount), judged by a fresh listing, not reposStore.
test('menu: a popstate with cc params retargets without a remount, using a fresh listing', async () => {
  // The mount's listings (App's and the picker's) lack `app`; only a listing fetched for the navigate has it.
  let mounted = false;
  const f = menuWorld({ 'GET api/repos': () => ({ repos: mounted ? LISTING : [repo({ project: 'kept' })] }) });
  at('?project=kept');
  renderApp();
  mounted = true;
  expect(await screen.findByRole('heading', { name: 'kept' })).toBeTruthy();
  await waitFor(() => expect(reposStore.get().repos?.map((r) => r.project)).toEqual(['kept']));
  const tablist = screen.getByRole('tablist');
  const before = f.count('GET api/repos');
  navigate('?ccProject=app&ccWorktree=feat');
  expect(await screen.findByRole('heading', { name: 'app/feat' })).toBeTruthy();
  expect(screen.getByRole('tablist')).toBe(tablist);
  expect(f.count('GET api/repos')).toBe(before + 1);
  expect(location.search).toBe('?project=app&worktree=feat');
});

// Invariant: the latest target wins: an older target's listing resolving last opens nothing, toasts nothing and does
// not overwrite the newer target's listing in reposStore.
test('menu: when an older target\'s listing resolves last, only the newer target opens, and its listing stays in reposStore', async () => {
  const { gates, respond, arm } = gatedListings([repo({ project: 'kept' })]);
  menuWorld({ 'GET api/repos': respond });
  at('?project=kept');
  renderApp();
  arm();
  await screen.findByRole('heading', { name: 'kept' });
  await waitFor(() => expect(reposStore.get().repos).not.toBeNull());
  navigate('?ccProject=ghost');
  navigate('?ccProject=box');
  await waitFor(() => expect(gates.length).toBe(2));
  await act(async () => gates[1](LISTING));
  expect(await screen.findByRole('heading', { name: 'box' })).toBeTruthy();
  await act(async () => gates[0]([repo({ project: 'kept' })]));
  expect(activeKey()).toBe(tabKey({ project: 'box', worktree: null }));
  expect(keys()).toEqual([tabKey(KEPT), tabKey({ project: 'box', worktree: null })]);
  expect(reposStore.get().repos!.map((r) => r.project)).toEqual(LISTING.map((r) => r.project));
  expect(toastText()).toBe('');
});

// Invariant: a Back/Forward to a tab route supersedes a pending menu target.
test('menu: a Back popstate while a menu listing is pending drops the menu target', async () => {
  persist([KEPT, { project: 'app', worktree: null }]);
  const { gates, respond, arm } = gatedListings([repo({ project: 'kept' }), repo({ project: 'app' })]);
  menuWorld({ 'GET api/repos': respond });
  at('?project=kept');
  renderApp();
  arm();
  await screen.findByRole('heading', { name: 'kept' });
  await waitFor(() => expect(reposStore.get().repos).not.toBeNull());
  navigate('?ccProject=box');
  navigate('?project=app');
  expect(activeKey()).toBe(tabKey({ project: 'app', worktree: null }));
  await waitFor(() => expect(gates.length).toBe(1));
  await act(async () => gates[0](LISTING));
  expect(keys()).toEqual([tabKey(KEPT), tabKey({ project: 'app', worktree: null })]);
  expect(activeKey()).toBe(tabKey({ project: 'app', worktree: null }));
  expect(reposStore.get().repos!.map((r) => r.project)).toEqual(['kept', 'app']);
  expect(toastText()).toBe('');
});

// Invariant: consuming a menu target swaps the cc keys in place; only the tab change itself adds one entry.
test('menu: a valid cc navigate adds exactly one history entry (the new tab), none for the cc params', async () => {
  menuWorld();
  at('?project=kept');
  renderApp();
  await screen.findByRole('heading', { name: 'kept' });
  const length = history.length;
  navigate('?ccProject=app&ccWorktree=feat');
  expect(await screen.findByRole('heading', { name: 'app/feat' })).toBeTruthy();
  expect(location.search).toBe('?project=app&worktree=feat');
  expect(history.length).toBe(length + 1);
});

// Invariant: the cc keys give way to the tab route even when nothing opens or changes, with no history entry.
test.each([
  ['a refusal', '?ccProject=ghost', 'ghost'],
  ['the already-active tab', '?ccProject=kept', null],
])('menu: after %s, a cc navigate leaves the tab route in the URL and adds no history entry', async (_n, search, toastNeedle) => {
  const f = menuWorld();
  at('?project=kept');
  renderApp();
  await screen.findByRole('heading', { name: 'kept' });
  await waitFor(() => expect(reposStore.get().repos).not.toBeNull());
  const length = history.length;
  const listings = f.count('GET api/repos');
  navigate(search);
  expect(location.search).toBe('?project=kept');
  await waitFor(() => expect(f.count('GET api/repos')).toBe(listings + 1));
  if (toastNeedle) await waitFor(() => expect(toastText()).toContain(toastNeedle));
  else await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(location.search).toBe('?project=kept');
  expect(history.length).toBe(length);
  expect(keys()).toEqual([tabKey(KEPT)]);
});

// main.tsx renders App under StrictMode: the first mount consumes the cc keys, so its cleanup must not drop the target.
test('menu: under StrictMode a cc target survives the double mount and opens its tab once', async () => {
  menuWorld();
  at('?ccProject=app&ccWorktree=feat');
  render(<StrictMode><App /><Toasts /></StrictMode>);
  expect(await screen.findByRole('heading', { name: 'app/feat' })).toBeTruthy();
  expect(keys()).toEqual([tabKey(APP_FEAT)]);
  expect(location.search).toBe('?project=app&worktree=feat');
});
