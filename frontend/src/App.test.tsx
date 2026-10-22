import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App';
import { dispatchTabs, tabsStore } from '@/state/tabs';
import { summary } from '@/test/fixtures';
import { stubFetch } from '@/test/stubFetch';

function stub() {
  return stubFetch({
    'GET api/repos': { repos: [] },
    'GET api/activity': { entries: [] },
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
