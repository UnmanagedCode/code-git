import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { App } from './App';
import { fileHistoryStore } from '@/features/history/state';
import { cancelLink } from '@/features/links/inbound';
import { getSelection } from '@/state/graphSelection';
import { dispatchTabs, tabKey, tabsStore } from '@/state/tabs';
import { summary } from '@/test/fixtures';
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
