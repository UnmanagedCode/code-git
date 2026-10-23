import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
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
const row = (name: 'Unstaged Files' | 'Staged Files', path: string) => section(name).querySelector<HTMLElement>(`li[role="option"][data-path="${CSS.escape(path)}"]`)!;

test('lists the unstaged (untracked included) and staged files with their counts', async () => {
  await show({ unstaged: [dfile({ path: 'src/a.ts', added: 7, deleted: 2 }), NEW], staged: [dfile({ path: 'src/b.ts', added: 3, deleted: 0 })] });
  expect(within(section('Unstaged Files')).getByRole('heading').textContent).toBe('Unstaged Files (2)');
  expect(within(section('Staged Files')).getByRole('heading').textContent).toBe('Staged Files (1)');
  expect(within(section('Unstaged Files')).getAllByRole('option').map((o) => o.getAttribute('data-path'))).toEqual(['src/a.ts', 'notes.txt']);
  // Line counts per section; none for an untracked file.
  expect(within(row('Unstaged Files', 'src/a.ts')).getByLabelText('7 added, 2 deleted')).toBeTruthy();
  expect(within(row('Staged Files', 'src/b.ts')).getByLabelText('3 added, 0 deleted')).toBeTruthy();
  expect(row('Unstaged Files', 'notes.txt').textContent).not.toMatch(/[+−]\d/);
});

const TREE_UNSTAGED = [
  dfile({ path: 'src/a.ts' }), dfile({ path: 'src/b/c.ts' }), dfile({ path: 'src/x.ts', status: 'U' }), dfile({ path: 'conf/y.ts', status: 'U' }),
  dfile({ path: 'src/mv.ts', oldPath: 'src/old.ts', status: 'R' }), NEW,
];
const TREE_STAGED = [dfile({ path: 'src/s.ts' }), dfile({ path: 'lib/t.ts' })];

test('Tree: one toggle for both sections; rows nest and keep Stage / Unstage / Discard / ⋮ and the S / U keys', async () => {
  const w = await show({ unstaged: TREE_UNSTAGED, staged: TREE_STAGED });
  const toggles = screen.getAllByRole('group', { name: 'File view' });
  expect(toggles).toHaveLength(1);
  await userEvent.click(within(toggles[0]).getByRole('button', { name: 'Tree' }));
  const src = within(section('Unstaged Files')).getByRole('group', { name: 'src' });
  expect(within(within(src).getByRole('group', { name: 'src/b' })).getByRole('option', { name: /c\.ts/ })).toBeTruthy();
  expect(within(section('Staged Files')).getByRole('group', { name: 'lib' })).toBeTruthy();
  expect(within(row('Unstaged Files', 'src/a.ts')).getByRole('button', { name: 'Stage src/a.ts' })).toBeTruthy();
  expect(within(row('Unstaged Files', 'src/a.ts')).getByRole('button', { name: 'Discard src/a.ts' })).toBeTruthy();
  expect(within(row('Unstaged Files', 'src/a.ts')).getByRole('button', { name: 'Actions for src/a.ts' })).toBeTruthy();
  expect(within(row('Staged Files', 'src/s.ts')).getByRole('button', { name: 'Unstage src/s.ts' })).toBeTruthy();
  await userEvent.click(within(row('Unstaged Files', 'src/b/c.ts')).getByRole('button', { name: 'Stage src/b/c.ts' }));
  await waitFor(() => expect(w.posts('stage.files')).toEqual([{ paths: ['src/b/c.ts'] }]));
  row('Unstaged Files', 'src/a.ts').focus();
  fireEvent.keyDown(row('Unstaged Files', 'src/a.ts'), { key: 's' });
  await waitFor(() => expect(w.posts('stage.files').at(-1)).toEqual({ paths: ['src/a.ts'] }));
  fireEvent.keyDown(row('Staged Files', 'lib/t.ts'), { key: 'u' });
  await waitFor(() => expect(w.posts('stage.unstageFiles')).toEqual([{ paths: ['lib/t.ts'] }]));
});

test('Tree: Stage folder sends one stage.files with the section\'s files beneath it, conflicted ones left out; Unstage folder likewise; no folder Discard', async () => {
  const w = await show({ unstaged: TREE_UNSTAGED, staged: TREE_STAGED });
  await userEvent.click(within(screen.getByRole('group', { name: 'File view' })).getByRole('button', { name: 'Tree' }));
  // Nothing stageable under conf/ (only a conflicted file): no button there.
  expect(within(section('Unstaged Files')).queryByRole('button', { name: 'Stage folder conf' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Discard folder/ })).toBeNull();
  await userEvent.click(within(section('Unstaged Files')).getByRole('button', { name: 'Stage folder src' }));
  await waitFor(() => expect(w.posts('stage.files')).toHaveLength(1));
  expect((w.posts('stage.files')[0] as { paths: string[] }).paths.sort()).toEqual(['src/a.ts', 'src/b/c.ts', 'src/mv.ts', 'src/old.ts']);
  await waitFor(() => expect(screen.queryByText('Loading changes…')).toBeNull());
  await userEvent.click(within(section('Unstaged Files')).getByRole('button', { name: 'Stage folder src/b' }));
  await waitFor(() => expect(w.posts('stage.files').at(-1)).toEqual({ paths: ['src/b/c.ts'] }));
  await userEvent.click(within(section('Staged Files')).getByRole('button', { name: 'Unstage folder src' }));
  await waitFor(() => expect(w.posts('stage.unstageFiles')).toEqual([{ paths: ['src/s.ts'] }]));
  expect(within(section('Staged Files')).queryByRole('button', { name: /^Stage folder/ })).toBeNull();
  expect(within(section('Unstaged Files')).queryByRole('button', { name: /^Unstage folder/ })).toBeNull();
});

test('Tree: folder buttons are disabled while an op runs', async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  await show({ unstaged: TREE_UNSTAGED, staged: TREE_STAGED });
  // stage.files answers only once released.
  const stubbed = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/ops/stage.files')) await held;
    return stubbed(input, init);
  });
  await userEvent.click(within(screen.getByRole('group', { name: 'File view' })).getByRole('button', { name: 'Tree' }));
  await userEvent.click(within(section('Unstaged Files')).getByRole('button', { name: 'Stage folder src/b' }));
  await waitFor(() => expect((within(section('Unstaged Files')).getByRole('button', { name: 'Stage folder src' }) as HTMLButtonElement).disabled).toBe(true));
  expect((within(section('Staged Files')).getByRole('button', { name: 'Unstage folder src' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { release(); await held; });
  await waitFor(() => expect((within(section('Unstaged Files')).getByRole('button', { name: 'Stage folder src' }) as HTMLButtonElement).disabled).toBe(false));
});

test('a second row clicked before the unstaged diff\'s list answers is the one viewed once it does', async () => {
  await show({ unstaged: [M, NEW, dfile({ path: 'z.ts' })] });
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  const stubbed = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/ops/diff.files')) await held;
    return stubbed(input, init);
  });
  await userEvent.click(within(section('Unstaged Files')).getByText('src/a.ts'));
  expect(diffStore.get().get(tabKey(APP))).toMatchObject({ viewed: 'src/a.ts', list: { loading: true } });
  await userEvent.click(within(section('Unstaged Files')).getByText('z.ts'));
  expect(diffStore.get().get(tabKey(APP))?.viewed).toBe('z.ts');
  await act(async () => { release(); await held; });
  await waitFor(() => expect(diffStore.get().get(tabKey(APP))?.list.loading).toBe(false));
  expect(diffStore.get().get(tabKey(APP))).toMatchObject({ source: { kind: 'unstaged' }, viewed: 'z.ts', selected: ['z.ts'] });
  expect(row('Unstaged Files', 'z.ts').getAttribute('aria-current')).toBe('true');
});

test('with the unstaged diff open its section drives it: viewed row current, a click or ↓ views a file without a new list; a staged row opens the staged diff', async () => {
  const w = await show({ unstaged: [M, NEW, dfile({ path: 'z.ts' })] });
  await userEvent.click(within(section('Unstaged Files')).getByText('src/a.ts'));
  await waitFor(() => expect(diffStore.get().get(tabKey(APP))?.list.result).toBeTruthy());
  expect(row('Unstaged Files', 'src/a.ts').getAttribute('aria-current')).toBe('true');
  const lists = w.fetch.count('POST api/ops/diff.files');
  await userEvent.click(within(section('Unstaged Files')).getByText('notes.txt'));
  expect(diffStore.get().get(tabKey(APP))).toMatchObject({ source: { kind: 'unstaged' }, viewed: 'notes.txt', selected: ['notes.txt'] });
  expect(row('Unstaged Files', 'notes.txt').getAttribute('aria-current')).toBe('true');
  fireEvent.keyDown(row('Unstaged Files', 'notes.txt'), { key: 'ArrowDown' });
  expect(diffStore.get().get(tabKey(APP))?.viewed).toBe('z.ts');
  expect(document.activeElement).toBe(row('Unstaged Files', 'z.ts'));
  fireEvent.click(row('Unstaged Files', 'src/a.ts'), { ctrlKey: true });
  expect(diffStore.get().get(tabKey(APP))?.selected).toEqual(['z.ts', 'src/a.ts']);
  expect(w.fetch.count('POST api/ops/diff.files')).toBe(lists);
  // The staged section is not bound: its row opens the staged diff.
  expect(row('Staged Files', 'src/b.ts').getAttribute('aria-current')).toBeNull();
  await userEvent.click(within(section('Staged Files')).getByText('src/b.ts'));
  expect(diffStore.get().get(tabKey(APP))?.source).toEqual({ kind: 'staged' });
  await waitFor(() => expect(row('Staged Files', 'src/b.ts').getAttribute('aria-current')).toBe('true'));
  expect(row('Unstaged Files', 'z.ts').getAttribute('aria-current')).toBeNull();
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
  await userEvent.click(screen.getByRole('button', { name: 'Reload changes' }));
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
  // No diff is open: ↓ moves the focus only.
  expect(shownPanelStore.get().get(tabKey(APP))).toBeUndefined();
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
  expect(await menu()).toEqual(['Stash this file…', 'Stage', 'Discard…', 'Copy path', "Ignore 'debug.log'", "Ignore all '*.log' files", "Ignore folder 'logs/'"]);
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

test('Discard all says how many conflicted files it leaves untouched', async () => {
  await show({ unstaged: [M, dfile({ path: 'c1.ts', status: 'U' }), dfile({ path: 'c2.ts', status: 'U' })] });
  await userEvent.click(screen.getByRole('button', { name: 'Discard all…' }));
  expect(within(dialog()).getByText(/2 conflicted files are left untouched/)).toBeTruthy();
});

test('a template draft shows the template file it was read from', async () => {
  workdirWorld({ unstaged: [M], staged: [STAGED], template: { summary: 'feat:', description: '' } });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: APP }));
  const hint = await within(await screen.findByRole('region', { name: 'Commit message' })).findByText('/t');
  expect(hint.parentElement?.textContent).toBe('Template: /t');
});

test('a click on a conflicted (U) row opens the merge tool for it instead of a diff', async () => {
  const w = await show({ unstaged: [M, dfile({ path: 'c.ts', status: 'U' })], answers: {
    'conflict.read': { path: 'c.ts', kind: 'bothModified', content: 'binary', base: null, ours: null, theirs: null, worktree: null },
  } });
  await userEvent.click(within(section('Unstaged Files')).getByText('c.ts'));
  await waitFor(() => expect(shownPanelStore.get().get(tabKey(APP))).toBe('conflicts'));
  expect(w.posts('conflict.read')).toEqual([{ path: 'c.ts' }]);
  expect(diffStore.get().get(tabKey(APP))).toBeUndefined();
});
