import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Shell } from '@/shell/Shell';
import { diffStore } from '@/state/diff';
import { shownPanelStore } from '@/state/shownPanel';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { dfile } from '@/test/diffFixtures';
import { json, summary } from '@/test/fixtures';
import { workdirWorld, type WorkdirWorld } from '@/test/workdirWorld';

const APP = { project: 'app', worktree: null };
const M = dfile({ path: 'src/a.ts', status: 'M' });
const NEW = dfile({ path: 'notes.txt', status: '?', added: null, deleted: null });
const NEW2 = dfile({ path: 'todo.md', status: '?', added: null, deleted: null });
const STAGED = dfile({ path: 'src/b.ts', status: 'M' });
const RENAMED = dfile({ path: 'new/name.ts', oldPath: 'old/name.ts', status: 'R', similarity: 90 });

async function show(w: WorkdirWorld = {}) {
  const world = workdirWorld({ unstaged: [M, NEW], staged: [STAGED], ...w });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  await screen.findByRole('region', { name: 'Commit message' });
  await waitFor(() => expect(screen.queryByText('Loading changes…')).toBeNull());
  return world;
}
const section = (name: 'Unstaged Files' | 'Staged Files') => screen.getByRole('region', { name });
const commitBox = () => screen.getByRole('region', { name: 'Commit message' });
const summaryBox = () => within(commitBox()).getByRole('textbox', { name: 'Summary' }) as HTMLInputElement;
const descBox = () => within(commitBox()).getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
const dialog = () => screen.getByRole('dialog');

test('lists the unstaged (untracked included) and staged files with their counts', async () => {
  await show();
  expect(within(section('Unstaged Files')).getByRole('heading').textContent).toBe('Unstaged Files (2)');
  expect(within(section('Staged Files')).getByRole('heading').textContent).toBe('Staged Files (1)');
  expect(within(section('Unstaged Files')).getAllByRole('option').map((o) => o.getAttribute('data-path'))).toEqual(['src/a.ts', 'notes.txt']);
});

test('Stage sends the row path, Unstage of a rename sends both paths; each op refreshes the lists and the summary', async () => {
  const w = await show({ staged: [RENAMED] });
  const lists = w.fetch.count('POST api/ops/diff.files');
  const summaries = w.fetch.count('POST api/ops/repo.summary');
  await userEvent.click(screen.getByRole('button', { name: 'Stage src/a.ts' }));
  await waitFor(() => expect(w.posts('stage.files')).toEqual([{ paths: ['src/a.ts'] }]));
  await waitFor(() => expect(w.fetch.count('POST api/ops/diff.files')).toBe(lists + 2));
  expect(w.fetch.count('POST api/ops/repo.summary')).toBeGreaterThan(summaries);
  await userEvent.click(screen.getByRole('button', { name: 'Unstage new/name.ts' }));
  await waitFor(() => expect(w.posts('stage.unstageFiles')).toEqual([{ paths: ['old/name.ts', 'new/name.ts'] }]));
});

test('Stage all and Unstage all send {all: true}', async () => {
  const w = await show();
  await userEvent.click(within(section('Unstaged Files')).getByRole('button', { name: 'Stage all' }));
  await waitFor(() => expect(w.posts('stage.files')).toEqual([{ all: true }]));
  await userEvent.click(within(section('Staged Files')).getByRole('button', { name: 'Unstage all' }));
  await waitFor(() => expect(w.posts('stage.unstageFiles')).toEqual([{ all: true }]));
});

test('discarding a file asks first: no request on Cancel, the request only after Confirm', async () => {
  const w = await show();
  await userEvent.click(screen.getByRole('button', { name: 'Discard src/a.ts' }));
  expect(within(dialog()).getByText('Discard changes to src/a.ts?')).toBeTruthy();
  expect(within(dialog()).getByText('This cannot be undone.')).toBeTruthy();
  expect(w.posts('stage.discardFiles')).toEqual([]);
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(w.posts('stage.discardFiles')).toEqual([]);
  await userEvent.click(screen.getByRole('button', { name: 'Discard notes.txt' }));
  expect(within(dialog()).getByText('Delete notes.txt?')).toBeTruthy();
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Delete file' }));
  await waitFor(() => expect(w.posts('stage.discardFiles')).toEqual([{ tracked: [], untracked: ['notes.txt'] }]));
});

test('Discard all names every untracked file with the count and "cannot be undone", and sends exactly the listed files', async () => {
  const conflicted = dfile({ path: 'c.ts', status: 'U' });
  const w = await show({ unstaged: [M, conflicted, NEW, NEW2] });
  await userEvent.click(screen.getByRole('button', { name: 'Discard all…' }));
  const d = dialog();
  expect(within(within(d).getByRole('list', { name: 'Affected files' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['notes.txt', 'todo.md']);
  expect(within(d).getByText('2 files')).toBeTruthy();
  expect(within(d).getByText('This cannot be undone.')).toBeTruthy();
  expect(w.posts('stage.discardFiles')).toEqual([]);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(w.posts('stage.discardFiles')).toEqual([]);
  await userEvent.click(screen.getByRole('button', { name: 'Discard all…' }));
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Discard all' }));
  // The conflicted file is not discardable (the backend would refuse CONFLICTED for the whole request).
  await waitFor(() => expect(w.posts('stage.discardFiles')).toEqual([{ tracked: ['src/a.ts'], untracked: ['notes.txt', 'todo.md'] }]));
});

test('commit button: needs a summary and something staged (or a merge); its label counts the staged files', async () => {
  await show({ staged: [STAGED, RENAMED] });
  const btn = () => within(commitBox()).getByRole('button', { name: /^Commit/ }) as HTMLButtonElement;
  expect(btn().disabled).toBe(true);
  await userEvent.type(summaryBox(), 'Fix');
  expect(btn().disabled).toBe(false);
  expect(btn().textContent).toBe('Commit changes to 2 files');
  await userEvent.clear(summaryBox());
  await userEvent.type(summaryBox(), '   ');
  expect(btn().disabled).toBe(true);
});

test('nothing staged: disabled unless a merge is in progress', async () => {
  await show({ staged: [] });
  await userEvent.type(summaryBox(), 'Fix');
  expect((within(commitBox()).getByRole('button', { name: 'Commit' }) as HTMLButtonElement).disabled).toBe(true);
});

test('nothing staged during a merge: the commit is allowed', async () => {
  await show({ staged: [], merging: true });
  await userEvent.type(summaryBox(), 'Merge');
  expect((within(commitBox()).getByRole('button', { name: 'Commit' }) as HTMLButtonElement).disabled).toBe(false);
});

test('Ctrl+Enter commits summary + description; the box then empties', async () => {
  const w = await show();
  await userEvent.type(summaryBox(), 'Fix it');
  await userEvent.type(descBox(), 'Because');
  fireEvent.keyDown(descBox(), { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(w.posts('commit.create')).toEqual([{ summary: 'Fix it', description: 'Because' }]));
  await waitFor(() => expect(summaryBox().value).toBe(''));
  expect(descBox().value).toBe('');
});

test('Ctrl+Shift+Enter stages everything, then commits', async () => {
  const w = await show({ staged: [] });
  await userEvent.type(summaryBox(), 'All of it');
  fireEvent.keyDown(summaryBox(), { key: 'Enter', ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(w.posts('commit.create')).toHaveLength(1));
  expect(w.posts('stage.files')).toEqual([{ all: true }]);
  const order = w.fetch.calls.map((c) => c.url.pathname).filter((p) => p.endsWith('stage.files') || p.endsWith('commit.create'));
  expect(order.map((p) => p.split('/').pop())).toEqual(['stage.files', 'commit.create']);
});

test('Skip Git hooks sends noVerify', async () => {
  const w = await show();
  await userEvent.type(summaryBox(), 'x');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Skip Git hooks' }));
  await userEvent.click(within(commitBox()).getByRole('button', { name: /^Commit changes/ }));
  await waitFor(() => expect(w.posts('commit.create')).toEqual([{ summary: 'x', description: '', noVerify: true }]));
});

test('Amend loads HEAD\'s message and keeps the draft aside; unticking restores the draft', async () => {
  await show({ head: { summary: 'Old title', description: 'Old body' } });
  await userEvent.type(summaryBox(), 'my draft');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Amend previous commit' }));
  await waitFor(() => expect(summaryBox().value).toBe('Old title'));
  expect(descBox().value).toBe('Old body');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Amend previous commit' }));
  expect(summaryBox().value).toBe('my draft');
  expect(descBox().value).toBe('');
});

test('amend mode: Amend commit sends amend; Update message only is disabled until the message changes, then sends messageOnly', async () => {
  const w = await show({ head: { summary: 'Old title', description: '' } });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Amend previous commit' }));
  await waitFor(() => expect(summaryBox().value).toBe('Old title'));
  const msgOnly = () => within(commitBox()).getByRole('button', { name: 'Update message only' }) as HTMLButtonElement;
  expect(msgOnly().disabled).toBe(true);
  await userEvent.type(summaryBox(), ' (reworded)');
  expect(msgOnly().disabled).toBe(false);
  await userEvent.click(msgOnly());
  await waitFor(() => expect(w.posts('commit.create')).toEqual([{ summary: 'Old title (reworded)', description: '', amend: true, messageOnly: true }]));
  // After success amend is off again.
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Amend previous commit' }) as HTMLInputElement).checked).toBe(false));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Amend previous commit' }));
  await waitFor(() => expect(summaryBox().value).toBe('Old title'));
  await userEvent.click(within(commitBox()).getByRole('button', { name: 'Amend commit' }));
  await waitFor(() => expect(w.posts('commit.create').at(-1)).toEqual({ summary: 'Old title', description: '', amend: true }));
});

test('a commit template pre-fills the box once; the unedited template cannot be committed; after a commit it pre-fills again', async () => {
  const w = await show({ template: { summary: 'feat:', description: 'Why:' } });
  await waitFor(() => expect(summaryBox().value).toBe('feat:'));
  expect(descBox().value).toBe('Why:');
  const btn = () => within(commitBox()).getByRole('button', { name: /^Commit changes/ }) as HTMLButtonElement;
  expect(btn().disabled).toBe(true);
  await userEvent.type(summaryBox(), ' add x');
  expect(btn().disabled).toBe(false);
  await userEvent.click(btn());
  await waitFor(() => expect(w.posts('commit.create')).toEqual([{ summary: 'feat: add x', description: 'Why:' }]));
  await waitFor(() => expect(summaryBox().value).toBe('feat:'));
  // Cleared by the user: stays cleared (the template is read once per tab).
  await userEvent.clear(summaryBox());
  await userEvent.clear(descBox());
  await userEvent.click(screen.getByRole('button', { name: 'Refresh changes' }));
  await waitFor(() => expect(w.fetch.count('POST api/ops/commit.template')).toBe(1));
  expect(summaryBox().value).toBe('');
});

test('a failing hook is shown with its output as text', async () => {
  await show({ answers: { 'commit.create': json({ error: 'git commit exited with 1', code: 'GIT_FAILED', stderr: 'lint: <b>3</b> problems' }, 422) } });
  await userEvent.type(summaryBox(), 'x');
  await userEvent.click(within(commitBox()).getByRole('button', { name: /^Commit changes/ }));
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('lint: <b>3</b> problems', { selector: 'pre' })).toBeTruthy();
  expect(alert.querySelector('b')).toBeNull();
  // The draft is kept for another try.
  expect(summaryBox().value).toBe('x');
});

test('the detached banner shows only on a detached HEAD, and the button says so', async () => {
  await show({ summary: summary({ head: { oid: '0123456789abcdef', branch: null, unborn: false } }) });
  const banner = await screen.findByRole('status');
  expect(banner.textContent).toBe('Detached HEAD at 0123456789. A commit made here is on no branch.');
  await userEvent.type(summaryBox(), 'x');
  expect(within(commitBox()).getByRole('button', { name: /^Commit/ }).textContent).toBe('Commit changes to 1 file (detached HEAD)');
});

test('no banner on a branch or an unborn HEAD', async () => {
  await show();
  expect(screen.queryByRole('status')).toBeNull();
  act(() => dispatchTabs({ type: 'close', index: 0 }));
});

test('a path holding markup renders as text', async () => {
  await show({ unstaged: [dfile({ path: '<img src=x onerror=alert(1)>', status: '?' })] });
  expect(within(section('Unstaged Files')).getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
});

test('clicking a row opens its unstaged or staged diff at that path', async () => {
  await show();
  await userEvent.click(within(section('Staged Files')).getByText('src/b.ts'));
  expect(shownPanelStore.get().get(tabKey(APP))).toBe('diff');
  expect(diffStore.get().get(tabKey(APP))?.source).toEqual({ kind: 'staged' });
  await waitFor(() => expect(diffStore.get().get(tabKey(APP))?.viewed).toBe('src/b.ts'));
});

test('keys: ↓ moves between rows, S stages and U unstages the focused row; Ctrl+Shift+S / U stage / unstage all', async () => {
  const w = await show();
  const rows = within(section('Unstaged Files')).getAllByRole('option');
  rows[0].focus();
  fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(rows[1]);
  fireEvent.keyDown(rows[1], { key: 's' });
  await waitFor(() => expect(w.posts('stage.files')).toEqual([{ paths: ['notes.txt'] }]));
  const staged = within(section('Staged Files')).getAllByRole('option')[0];
  fireEvent.keyDown(staged, { key: 'u' });
  await waitFor(() => expect(w.posts('stage.unstageFiles')).toEqual([{ paths: ['src/b.ts'] }]));
  // S while typing in the summary is just a letter.
  fireEvent.keyDown(summaryBox(), { key: 's' });
  fireEvent.keyDown(window, { key: 'S', ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(w.posts('stage.files')).toEqual([{ paths: ['notes.txt'] }, { all: true }]));
  fireEvent.keyDown(window, { key: 'U', ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(w.posts('stage.unstageFiles')).toEqual([{ paths: ['src/b.ts'] }, { all: true }]));
});

test('an op that changes the files reloads an open unstaged diff, keeping the viewed file', async () => {
  const w = await show();
  await userEvent.click(within(section('Unstaged Files')).getByText('src/a.ts'));
  await waitFor(() => expect(diffStore.get().get(tabKey(APP))?.viewed).toBe('src/a.ts'));
  const before = w.fetch.count('POST api/ops/diff.files');
  await userEvent.click(screen.getByRole('button', { name: 'Stage notes.txt' }));
  // Two panel lists + the diff's own list.
  await waitFor(() => expect(w.fetch.count('POST api/ops/diff.files')).toBe(before + 3));
  expect(diffStore.get().get(tabKey(APP))?.viewed).toBe('src/a.ts');
});

test('untracked rows offer Ignore by name, extension and folder; each sends ignore.add without stopTracking', async () => {
  const w = await show({ unstaged: [dfile({ path: 'logs/debug.log', status: '?' })] });
  const menu = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Actions for logs/debug.log' }));
    return screen.getAllByRole('menuitem').map((m) => m.textContent);
  };
  expect(await menu()).toEqual(['Stage', 'Discard…', 'Copy path', "Ignore 'debug.log'", "Ignore all '*.log' files", "Ignore folder 'logs/'"]);
  await userEvent.click(screen.getByRole('menuitem', { name: "Ignore all '*.log' files" }));
  await waitFor(() => expect(w.posts('ignore.add')).toEqual([{ kind: 'ext', value: 'log' }]));
  await menu();
  await userEvent.click(screen.getByRole('menuitem', { name: "Ignore folder 'logs/'" }));
  await waitFor(() => expect(w.posts('ignore.add').at(-1)).toEqual({ kind: 'dir', value: 'logs' }));
  await menu();
  await userEvent.click(screen.getByRole('menuitem', { name: "Ignore 'debug.log'" }));
  await waitFor(() => expect(w.posts('ignore.add').at(-1)).toEqual({ kind: 'path', value: 'logs/debug.log' }));
});

test('a dotfile has no extension to ignore; a root file no folder', async () => {
  await show({ unstaged: [dfile({ path: '.env', status: '?' })] });
  await userEvent.click(screen.getByRole('button', { name: 'Actions for .env' }));
  expect(screen.getAllByRole('menuitem').map((m) => m.textContent).filter((t) => t?.startsWith('Ignore'))).toEqual(["Ignore '.env'"]);
});

test('a tracked row offers Ignore and stop tracking…, confirmed first; Cancel sends nothing', async () => {
  const w = await show();
  await userEvent.click(screen.getByRole('button', { name: 'Actions for src/a.ts' }));
  await userEvent.click(screen.getByRole('menuitem', { name: "Ignore and stop tracking all '*.ts' files…" }));
  expect(within(dialog()).getByText("Ignore and stop tracking all '*.ts' files?")).toBeTruthy();
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
  expect(w.posts('ignore.add')).toEqual([]);
  await userEvent.click(screen.getByRole('button', { name: 'Actions for src/a.ts' }));
  await userEvent.click(screen.getByRole('menuitem', { name: "Ignore and stop tracking 'a.ts'…" }));
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Ignore and stop tracking' }));
  await waitFor(() => expect(w.posts('ignore.add')).toEqual([{ kind: 'path', value: 'src/a.ts', stopTracking: true }]));
});
