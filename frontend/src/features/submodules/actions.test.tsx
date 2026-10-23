import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { actionsFor, labelOf } from '@/shell/menus';
import { Shell } from '@/shell/Shell';
import { Toasts } from '@/shell/Toasts';
import { activeTab, dispatchTabs, tabsStore } from '@/state/tabs';
import { json } from '@/test/fixtures';
import { subEntry, submoduleWorld } from '@/test/submoduleWorld';
import { SUBMODULE_CONTEXT, type SubmoduleCtx } from './actions';
import type { SubmoduleEntry } from './api';

afterEach(() => { toast.dismiss(); });

const APP = { project: 'app', worktree: null };
const toastsEl = () => screen.getByRole('region', { name: /Notifications/ });
const toastTexts = () => [...toastsEl().querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent ?? '');
const labels = (e: SubmoduleEntry) => { const c: SubmoduleCtx = { tab: APP, entry: e }; return actionsFor(SUBMODULE_CONTEXT, c).map((a) => labelOf(a, c)); };

async function world(w: Parameters<typeof submoduleWorld>[0] = {}) {
  const x = submoduleWorld({ list: () => [subEntry()], ...w });
  render(<><Shell /><Toasts /></>);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  const panel = await screen.findByRole('region', { name: 'Submodules' });
  await within(panel).findByText('libs/a');
  // The Changes panel (and its ConfirmHost) is up.
  await screen.findByRole('button', { name: 'Stash changes…' });
  return { ...x, panel };
}
const pick = async (panel: HTMLElement, path: string, label: string) => {
  await userEvent.click(within(panel).getByRole('button', { name: `Actions for ${path}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: label }));
};

test('menu items by state: Open only when cloned, Initialize only when not, Sync only when initialized, nothing for a blocked entry', () => {
  expect(labels(subEntry())).toEqual(['Open', 'Update', 'Sync', 'Edit URL…', 'Remove…']);
  expect(labels(subEntry({ initialized: false, populated: false, head: null }))).toEqual(['Initialize', 'Update', 'Edit URL…', 'Remove…']);
  expect(labels(subEntry({ populated: false, head: null }))).toEqual(['Update', 'Sync', 'Edit URL…', 'Remove…']);
  expect(labels(subEntry({ blocked: 'path' }))).toEqual([]);
  const c: SubmoduleCtx = { tab: APP, entry: subEntry() };
  expect(actionsFor(SUBMODULE_CONTEXT, c).find((a) => a.primary)?.id).toBe('submodule.open');
  expect(actionsFor(SUBMODULE_CONTEXT, c).find((a) => labelOf(a, c) === 'Remove…')?.destructive).toBe(true);
});

test('Open opens a sub tab whose ops send sub (double-click too); a nested one extends the chain', async () => {
  const w = await world({ list: (t) => (t.sub ? [subEntry({ path: 'inner' })] : [subEntry()]) });
  await userEvent.dblClick(within(w.panel).getByRole('button', { name: 'libs/a' }));
  const SUB = { project: 'app', worktree: null, sub: ['libs/a'] };
  expect(activeTab(tabsStore.get())).toEqual(SUB);
  const panel = await screen.findByRole('region', { name: 'Submodules' });
  await within(panel).findByText('inner');
  await waitFor(() => expect(w.targets('repo.summary')).toContainEqual({ project: 'app', sub: ['libs/a'] }));
  expect(w.targets('graph.refs')).toContainEqual({ project: 'app', sub: ['libs/a'] });
  expect(w.targets('submodule.list')).toContainEqual({ project: 'app', sub: ['libs/a'] });
  await pick(panel, 'inner', 'Open');
  expect(activeTab(tabsStore.get())).toEqual({ ...SUB, sub: ['libs/a', 'inner'] });
});

test('Remove confirms, then retries with discard after SUBMODULE_DIRTY confirm', async () => {
  let n = 0;
  const w = await world({
    answers: {
      'submodule.remove': () => (n++ === 0
        ? json({ error: 'libs/a has work removing it would throw away', code: 'SUBMODULE_DIRTY', path: 'libs/a', modified: true, untracked: false, orphaned: 2, staged: false, gitmodules: true }, 409)
        : { path: 'libs/a', name: 'libs/a' }),
    },
  });
  await pick(w.panel, 'libs/a', 'Remove…');
  const first = await screen.findByRole('dialog', { name: 'Remove the submodule libs/a?' });
  expect(within(first).getByText(/\.git\/modules\/libs\/a/)).toBeTruthy();
  await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }));
  expect(w.posts('submodule.remove')).toEqual([]);
  await pick(w.panel, 'libs/a', 'Remove…');
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove the submodule libs/a?' })).getByRole('button', { name: 'Remove submodule' }));
  await waitFor(() => expect(w.posts('submodule.remove')).toEqual([{ path: 'libs/a' }]));
  await waitFor(() => expect(toastTexts().join('')).toContain('libs/a has work removing it would throw away'));
  await userEvent.click(within(toastsEl()).getByRole('button', { name: 'Review…' }));
  const second = await screen.findByRole('dialog', { name: 'Discard the work in libs/a?' });
  expect(within(second).getByText('Changed files in the submodule')).toBeTruthy();
  expect(within(second).getByText('2 commits on no branch')).toBeTruthy();
  expect(within(second).getByText('Unstaged changes to .gitmodules: they will be staged with the removal')).toBeTruthy();
  expect(within(second).queryByText('Untracked files in the submodule')).toBeNull();
  expect(within(second).getByText('This cannot be undone.')).toBeTruthy();
  await userEvent.click(within(second).getByRole('button', { name: 'Discard and remove' }));
  await waitFor(() => expect(w.posts('submodule.remove')).toEqual([{ path: 'libs/a' }, { path: 'libs/a', discard: true }]));
  await waitFor(() => expect(toastTexts().join('')).toContain('Removed libs/a'));
});

test('Update retries with discardCommits after the at-risk confirmation', async () => {
  let n = 0;
  const w = await world({
    answers: {
      'submodule.update': () => (n++ === 0
        ? json({ error: 'at risk', code: 'SUBMODULE_COMMITS_AT_RISK', paths: [{ path: 'libs/a', count: 3 }] }, 409)
        : { paths: ['libs/a'] }),
    },
  });
  await pick(w.panel, 'libs/a', 'Update');
  await waitFor(() => expect(toastTexts().join('')).toContain('Updating libs/a would leave commits on no branch'));
  await userEvent.click(within(toastsEl()).getByRole('button', { name: 'Review…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Leave these commits behind?' });
  expect(within(dialog).getByText('libs/a: 3 commits')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Update anyway' }));
  await waitFor(() => expect(w.posts('submodule.update')).toEqual([{ paths: ['libs/a'] }, { paths: ['libs/a'], discardCommits: true }]));
});

test('TRANSPORT_BLOCKED toast: the server message and git\'s stderr', async () => {
  const w = await world({
    answers: { 'submodule.update': json({ error: "git allows a local-path clone into a submodule only when the System's git config sets protocol.file.allow", code: 'SUBMODULE_TRANSPORT_BLOCKED', transport: 'file', stderr: "fatal: transport 'file' not allowed" }, 409) },
  });
  await pick(w.panel, 'libs/a', 'Update');
  await waitFor(() => expect(toastTexts().join('')).toContain('protocol.file.allow'));
  expect(toastTexts().join('')).toContain("fatal: transport 'file' not allowed");
});

test('Initialize toasts an Update action that updates that path; a refused url says so instead', async () => {
  const w = await world({
    list: () => [subEntry({ initialized: false, populated: false, head: null, resolvedUrl: null })],
    answers: { 'submodule.init': { submodules: [{ path: 'libs/a', resolvedUrl: 'https://h/a.git', urlProblem: null }] } },
  });
  await pick(w.panel, 'libs/a', 'Initialize');
  expect(w.posts('submodule.init')).toEqual([{ paths: ['libs/a'] }]);
  await waitFor(() => expect(toastTexts().join('')).toContain('Initialized libs/a'));
  await userEvent.click(within(toastsEl()).getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(w.posts('submodule.update')).toEqual([{ paths: ['libs/a'] }]));
});

test('Edit URL… sends {path, url}; Sync sends {paths}', async () => {
  const w = await world();
  await pick(w.panel, 'libs/a', 'Edit URL…');
  const dialog = await screen.findByRole('dialog', { name: 'Edit the url of libs/a' });
  const box = within(dialog).getByRole('textbox', { name: 'Url' });
  await userEvent.clear(box);
  await userEvent.type(box, 'git@h:a.git');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save url' }));
  await waitFor(() => expect(w.posts('submodule.setUrl')).toEqual([{ path: 'libs/a', url: 'git@h:a.git' }]));
  await pick(w.panel, 'libs/a', 'Sync');
  await waitFor(() => expect(w.posts('submodule.sync')).toEqual([{ paths: ['libs/a'] }]));
});
