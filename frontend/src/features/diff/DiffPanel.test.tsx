import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Shell } from '@/shell/Shell';
import { diffStore, prefsStore, setPrefs } from '@/state/diff';
import { shownPanelStore } from '@/state/shownPanel';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { dfile, fdiff, filesResult, hunk, OID } from '@/test/diffFixtures';
import { json, summary } from '@/test/fixtures';
import { refsResult } from '@/test/graphData';
import { stubFetch } from '@/test/stubFetch';
import type { DiffFile, DiffFilesResult, FileDiff } from './api';
import { LG_QUERY } from '@/lib/useMediaQuery';
import { setFileView } from '@/state/fileView';
import { openDiff } from './openDiff';

const APP = { project: 'app', worktree: null };
const OTHER = { project: 'other', worktree: null };
const original = Element.prototype.scrollIntoView;
let scrolled: Element[] = [];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
});
afterEach(() => { Element.prototype.scrollIntoView = original; });

/** Stubs the shell's own requests plus diff.files / diff.file answered by `list` and `byPath`. */
function world(list: DiffFilesResult | Response | ((body: { target: { project: string } }) => DiffFilesResult), byPath: Record<string, FileDiff | Response> = {}) {
  const fetch = stubFetch({
    'GET api/activity': { entries: [], runs: [] },
    'POST api/ops/repo.summary': { ok: true, result: summary() },
    // The graph the diff replaces: an empty repo.
    'POST api/ops/graph.refs': { ok: true, result: refsResult({ head: { oid: null, branch: 'refs/heads/main', detached: false, unborn: true } }) },
    'GET api/repos/app/worktrees': { worktrees: [] },
    'GET api/repos/other/worktrees': { worktrees: [] },
    'POST api/ops/diff.files': (_u: URL, init?: RequestInit) => {
      // A fresh copy per request: the Changes panel lists through diff.files too, and a body is read once.
      if (list instanceof Response) return list.clone();
      return { ok: true, result: typeof list === 'function' ? list(JSON.parse(String(init?.body))) : list };
    },
    'POST api/ops/diff.file': (_u: URL, init?: RequestInit) => {
      const p = JSON.parse(String(init?.body)).params.path as string;
      const r = byPath[p];
      if (!r) throw new Error(`no diff stubbed for ${p}`);
      return r instanceof Response ? r.clone() : { ok: true, result: r };
    },
  });
  const posts = (op: string) => fetch.calls.filter((c) => c.url.pathname.endsWith(`/ops/${op}`)).map((c) => (c.body as { params: Record<string, unknown> }).params);
  return { fetch, posts };
}

const A_DIFF = fdiff([hunk(1, 1, [' a', '-foo(bar)', '+foo(baz)', ' b']), hunk(10, 10, ['-x', '+y', ' z']), hunk(20, 20, [' q', '+r'])]);

function show(tab = APP) {
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab }));
}

async function openA(files: DiffFile[] = [dfile()], byPath: Record<string, FileDiff | Response> = { 'src/a.ts': A_DIFF }) {
  const w = world(filesResult(files), byPath);
  show();
  act(() => openDiff(APP, { kind: 'commit', rev: 'HEAD' }));
  await screen.findByRole('listbox', { name: 'Changed files' });
  return w;
}

async function openANarrow(files: DiffFile[], byPath: Record<string, FileDiff | Response>) {
  const w = world(filesResult(files), byPath);
  show();
  act(() => openDiff(APP, { kind: 'commit', rev: 'HEAD' }));
  await within(await screen.findByRole('region', { name: 'Diff' })).findByRole('button', { name: `Files (${files.length})` });
  return w;
}

const panel = () => screen.getByRole('region', { name: 'Diff' });
const viewed = () => diffStore.get().get(tabKey(APP))?.viewed;

function screenWidth(wide: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === LG_QUERY ? wide : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
}

test('the diff holds no file list of its own: the right slot\'s list drives it', async () => {
  await openA([dfile(), dfile({ path: 'src/b.ts' })], { 'src/a.ts': A_DIFF, 'src/b.ts': A_DIFF });
  expect(within(panel()).queryByRole('listbox')).toBeNull();
  const list = within(document.querySelector<HTMLElement>('[data-slot-name=right]')!).getByRole('listbox', { name: 'Changed files' });
  await userEvent.click(within(list).getByRole('option', { name: /src\/b\.ts/ }));
  expect(viewed()).toBe('src/b.ts');
  expect(screen.getByLabelText('Viewed file').textContent).toContain('src/b.ts');
});

test('Previous / Next file follow the displayed order: the tree\'s when Tree is chosen', async () => {
  // Path order: b.ts, a/x.ts; Tree order: a/x.ts, b.ts.
  await openA([dfile({ path: 'b.ts' }), dfile({ path: 'a/x.ts' })], { 'b.ts': A_DIFF, 'a/x.ts': A_DIFF });
  await waitFor(() => expect(viewed()).toBe('b.ts'));
  expect((screen.getByRole('button', { name: 'Previous file' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Next file' }));
  expect(viewed()).toBe('a/x.ts');
  await userEvent.click(screen.getByRole('button', { name: 'Previous file' }));
  expect(viewed()).toBe('b.ts');
  act(() => setFileView('tree'));
  expect((screen.getByRole('button', { name: 'Next file' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Previous file' }));
  expect(viewed()).toBe('a/x.ts');
  expect((screen.getByRole('button', { name: 'Previous file' }) as HTMLButtonElement).disabled).toBe(true);
});

test('narrow: Files (n) in the diff header opens the list as a dialog; a plain click views a file and closes it, Ctrl-click keeps it open', async () => {
  screenWidth(false);
  await openANarrow([dfile(), dfile({ path: 'src/b.ts' }), dfile({ path: 'src/c.ts' })], { 'src/a.ts': A_DIFF, 'src/b.ts': A_DIFF, 'src/c.ts': A_DIFF });
  expect(screen.queryByRole('listbox')).toBeNull();
  await userEvent.click(within(panel()).getByRole('button', { name: 'Files (3)' }));
  let dialog = await screen.findByRole('dialog', { name: 'Changed files' });
  expect(within(dialog).getAllByRole('option')).toHaveLength(3);
  expect(within(dialog).getByRole('group', { name: 'File view' })).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('option', { name: /src\/b\.ts/ }));
  expect(viewed()).toBe('src/b.ts');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Changed files' })).toBeNull());
  await userEvent.click(within(panel()).getByRole('button', { name: 'Files (3)' }));
  dialog = await screen.findByRole('dialog', { name: 'Changed files' });
  fireEvent.click(within(dialog).getByRole('option', { name: /src\/c\.ts/ }), { ctrlKey: true });
  expect(diffStore.get().get(tabKey(APP))?.selected).toEqual(['src/b.ts', 'src/c.ts']);
  expect(screen.getByRole('dialog', { name: 'Changed files' })).toBeTruthy();
  // ↓ in the dialog moves without closing it; Esc closes the dialog, not the diff.
  fireEvent.keyDown(within(screen.getByRole('dialog', { name: 'Changed files' })).getByRole('option', { name: /src\/b\.ts/ }), { key: 'ArrowDown' });
  expect(viewed()).toBe('src/c.ts');
  expect(screen.getByRole('dialog', { name: 'Changed files' })).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Changed files' })).toBeNull());
  expect(panel()).toBeTruthy();
  expect(shownPanelStore.get().get(tabKey(APP))).toBe('diff');
});

test('openDiff shows the diff instead of the commit graph; Close diff restores it, and so does Esc', async () => {
  world(filesResult([dfile()]), { 'src/a.ts': A_DIFF });
  show();
  const graph = () => screen.queryByRole('region', { name: 'Commit graph' });
  expect(await screen.findByRole('region', { name: 'Commit graph' })).toBeTruthy();
  act(() => openDiff(APP, { kind: 'commit', rev: 'HEAD' }));
  expect(await screen.findByRole('region', { name: 'Diff' })).toBeTruthy();
  expect(graph()).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Close diff' }));
  expect(screen.queryByRole('region', { name: 'Diff' })).toBeNull();
  expect(graph()).toBeTruthy();
  act(() => openDiff(APP, { kind: 'commit', rev: 'HEAD' }));
  await screen.findByRole('listbox', { name: 'Changed files' });
  fireEvent.keyDown(panel(), { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Diff' })).toBeNull();
  expect(graph()).toBeTruthy();
  expect(diffStore.get().size).toBe(0);
});

test('each tab keeps its own diff; closing a tab prunes its diff and shown-panel state', async () => {
  world((body) => filesResult([dfile({ path: body.target.project === 'other' ? 'other.ts' : 'app.ts' })]), {
    'app.ts': fdiff([hunk(1, 1, ['+app'])]), 'other.ts': fdiff([hunk(1, 1, ['+other'])]),
  });
  show();
  act(() => openDiff(APP, { kind: 'commit', rev: 'HEAD' }));
  await screen.findByRole('option', { name: /app\.ts/ });
  act(() => dispatchTabs({ type: 'open', tab: OTHER }));
  expect(screen.queryByRole('region', { name: 'Diff' })).toBeNull();
  act(() => openDiff(OTHER, { kind: 'commit', rev: 'HEAD~1' }));
  await screen.findByRole('option', { name: /other\.ts/ });
  act(() => dispatchTabs({ type: 'activateIndex', index: 0 }));
  expect(await screen.findByRole('option', { name: /app\.ts/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /other\.ts/ })).toBeNull();
  act(() => dispatchTabs({ type: 'close', index: 1 }));
  expect([...diffStore.get().keys()]).toEqual([tabKey(APP)]);
  expect([...shownPanelStore.get().keys()]).toEqual([tabKey(APP)]);
});

test('a file list over the cap is an alert saying it is too large, with no file list', async () => {
  world(json({ error: 'git output exceeded', code: 'OUTPUT_TOO_LARGE', limitBytes: 32 * 1024 * 1024 }, 422));
  show();
  act(() => openDiff(APP, { kind: 'unstaged' }));
  const alert = await within(await screen.findByRole('region', { name: 'Diff' })).findByRole('alert');
  expect(alert.textContent).toMatch(/too large/);
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('a list error shows in the diff; the right slot\'s Changed files panel stays empty', async () => {
  world(json({ error: 'git output exceeded', code: 'OUTPUT_TOO_LARGE', limitBytes: 32 * 1024 * 1024 }, 422));
  show();
  act(() => openDiff(APP, { kind: 'commit', rev: 'HEAD' }));
  await within(await screen.findByRole('region', { name: 'Diff' })).findByRole('alert');
  const right = within(document.querySelector<HTMLElement>('[data-slot-name=right]')!);
  expect(right.getByRole('complementary', { name: 'Changed files panel' })).toBeTruthy();
  expect(right.queryByRole('listbox')).toBeNull();
  expect(right.queryByText('Loading files…')).toBeNull();
  expect(within(panel()).queryByRole('button', { name: /^Files \(/ })).toBeNull();
});

test('a file is loaded against the pinned pair diff.files returned, not the original source', async () => {
  const { posts } = await openA();
  await waitFor(() => expect(posts('diff.file')).toHaveLength(1));
  // The Changes panel's own unstaged/staged lists are not the diff's.
  expect(posts('diff.files').filter((p) => (p.source as { kind: string }).kind === 'commit')[0].source).toEqual({ kind: 'commit', rev: 'HEAD' });
  expect(posts('diff.file')[0]).toEqual({
    source: { kind: 'pair', old: { type: 'tree', oid: OID('a') }, new: { type: 'tree', oid: OID('b') } }, path: 'src/a.ts', context: 3, whitespace: 'none',
  });
});

const group = (name: string) => within(panel()).getByRole('group', { name });
const pick = (g: string, name: string) => userEvent.click(within(group(g)).getByRole('button', { name }));
const pressed = (g: string) => within(group(g)).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
const ignoreWs = () => within(panel()).getByRole('button', { name: 'Ignore whitespace' });

// Invariant: the toolbar offers independent Diff scope (Hunk | Full) and Diff layout (Inline | Split) groups and one
// Ignore whitespace toggle, in place of Diff mode and the Whitespace select; each keeps its own pressed state.
test('Diff scope and Diff layout groups and an Ignore whitespace button replace Diff mode and the Whitespace select', async () => {
  await openA();
  expect(within(panel()).queryByRole('group', { name: 'Diff mode' })).toBeNull();
  expect(within(panel()).queryByRole('combobox', { name: 'Whitespace' })).toBeNull();
  expect(within(group('Diff scope')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hunk', 'Full']);
  expect(within(group('Diff layout')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Inline', 'Split']);
  expect([pressed('Diff scope'), pressed('Diff layout'), ignoreWs().getAttribute('aria-pressed')]).toEqual([['Hunk'], ['Inline'], 'false']);
  await pick('Diff scope', 'Full');
  expect([pressed('Diff scope'), pressed('Diff layout')]).toEqual([['Full'], ['Inline']]);
  await pick('Diff layout', 'Split');
  expect([pressed('Diff scope'), pressed('Diff layout')]).toEqual([['Full'], ['Split']]);
  await userEvent.click(ignoreWs());
  expect([pressed('Diff scope'), pressed('Diff layout'), ignoreWs().getAttribute('aria-pressed')]).toEqual([['Full'], ['Split'], 'true']);
  await pick('Diff scope', 'Hunk');
  expect([pressed('Diff scope'), pressed('Diff layout'), ignoreWs().getAttribute('aria-pressed')]).toEqual([['Hunk'], ['Split'], 'true']);
});

// Invariant: scope alone decides the request (Full: the whole file; Hunk: the chosen context); layout is render-only,
// so flipping it posts no diff.file.
test('Full asks for the full file; Hunk asks for the chosen context; a layout flip posts no new diff.file', async () => {
  const { posts } = await openA();
  await waitFor(() => expect(posts('diff.file')).toHaveLength(1));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Context lines' }), '10');
  await waitFor(() => expect(posts('diff.file').at(-1)?.context).toBe(10));
  const n = posts('diff.file').length;
  await pick('Diff layout', 'Split');
  await waitFor(() => expect(panel().querySelector('[data-view=split]')).toBeTruthy());
  await pick('Diff layout', 'Inline');
  await waitFor(() => expect(panel().querySelector('[data-view=unified]')).toBeTruthy());
  expect(posts('diff.file')).toHaveLength(n);
  await pick('Diff scope', 'Full');
  await waitFor(() => expect(posts('diff.file').at(-1)?.context).toBe('full'));
  const m = posts('diff.file').length;
  await pick('Diff layout', 'Split');
  await waitFor(() => expect(panel().querySelector('[data-view=split]')).toBeTruthy());
  expect(posts('diff.file')).toHaveLength(m);
});

// Invariant: Ignore whitespace on reloads the file list and the file with whitespace "all"; off asks with "none" again.
test('Ignore whitespace on reloads the list and the file with whitespace all; off asks with none', async () => {
  const { posts } = await openA();
  const commitLists = () => posts('diff.files').filter((p) => (p.source as { kind: string }).kind === 'commit');
  await waitFor(() => expect(posts('diff.file')).toHaveLength(1));
  expect(commitLists().map((p) => p.whitespace)).toEqual(['none']);
  expect(posts('diff.file')[0].whitespace).toBe('none');
  await userEvent.click(ignoreWs());
  await waitFor(() => expect(posts('diff.file').at(-1)?.whitespace).toBe('all'));
  expect(commitLists().map((p) => p.whitespace)).toEqual(['none', 'all']);
  await userEvent.click(ignoreWs());
  await waitFor(() => expect(posts('diff.file').at(-1)?.whitespace).toBe('none'));
  expect(commitLists().map((p) => p.whitespace)).toEqual(['none', 'all', 'none']);
});

// Invariant: Hunk scope in Split layout shows a hunk header above each hunk, and the old and new sides in two columns.
test('Hunk+Split renders a hunk header per hunk and both columns', async () => {
  await openA();
  await pick('Diff layout', 'Split');
  await waitFor(() => expect(panel().querySelector('[data-view=split]')).toBeTruthy());
  const view = panel().querySelector('[data-view=split]')!;
  expect(view.querySelectorAll('[data-hunk-header]')).toHaveLength(3);
  expect([...view.querySelectorAll('[data-hunk-header]')].map((h) => h.textContent)).toEqual(A_DIFF.hunks.map((h) => h.header));
  expect(view.querySelectorAll('[data-side=old]').length).toBe(view.querySelectorAll('[data-side=new]').length);
  expect(view.querySelectorAll('[data-side=old]').length).toBeGreaterThan(0);
  await pick('Diff scope', 'Full');
  await waitFor(() => expect(panel().querySelectorAll('[data-hunk-header]')).toHaveLength(0));
  expect(panel().querySelector('[data-view=split]')).toBeTruthy();
});

// Invariant: Context lines applies to Hunk scope only; File view disables scope and layout but not Ignore whitespace.
test('Context lines is disabled in Full scope; scope and layout are disabled in File view while Ignore whitespace stays enabled', async () => {
  await openA();
  const contextSelect = () => screen.getByRole('combobox', { name: 'Context lines' }) as HTMLSelectElement;
  expect(contextSelect().disabled).toBe(false);
  await pick('Diff layout', 'Split');
  expect(contextSelect().disabled).toBe(false);
  await pick('Diff scope', 'Full');
  expect(contextSelect().disabled).toBe(true);
  await userEvent.click(within(group('View')).getByRole('button', { name: 'File' }));
  const disabled = (g: string) => within(group(g)).getAllByRole('button').map((b) => (b as HTMLButtonElement).disabled);
  expect([...disabled('Diff scope'), ...disabled('Diff layout')]).toEqual([true, true, true, true]);
  expect((ignoreWs() as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(ignoreWs());
  expect(ignoreWs().getAttribute('aria-pressed')).toBe('true');
});

// Invariant: File view renders the file layout ([data-view=file]), never an inline or split diff, whatever the layout
// and scope chosen for Diff view.
test.each([
  ['hunk', 'Hunk', 'inline', 'Inline'], ['hunk', 'Hunk', 'split', 'Split'], ['full', 'Full', 'inline', 'Inline'], ['full', 'Full', 'split', 'Split'],
] as const)('File view renders the file layout, not a diff, from $0 scope with $2 layout', async (scope, scopeLabel, layout, layoutLabel) => {
  await openA();
  await pick('Diff scope', scopeLabel);
  await pick('Diff layout', layoutLabel);
  await userEvent.click(within(group('View')).getByRole('button', { name: 'File' }));
  await waitFor(() => expect(panel().querySelector('[data-view=file]')).toBeTruthy());
  expect(panel().querySelector('[data-view=unified]')).toBeNull();
  expect(panel().querySelector('[data-view=split]')).toBeNull();
  expect(panel().querySelectorAll('[data-hunk-header]')).toHaveLength(0);
  expect(prefsStore.get()).toMatchObject({ view: 'file', scope, layout });
});

// Invariant: a file over the output cap in Full scope offers Switch to Hunk, which sets Hunk scope and Diff view and
// keeps the layout.
test('over the cap, Switch to Hunk sets scope hunk and view diff and keeps the layout', async () => {
  const tooLarge = json({ error: 'git output exceeded', code: 'OUTPUT_TOO_LARGE', limitBytes: 32 * 1024 * 1024 }, 422);
  await openA([dfile()], { 'src/a.ts': tooLarge });
  await pick('Diff layout', 'Split');
  await screen.findByText(/^Too large to display/);
  expect(screen.queryByRole('button', { name: 'Switch to Hunk' })).toBeNull();
  await pick('Diff scope', 'Full');
  await userEvent.click(await screen.findByRole('button', { name: 'Switch to Hunk' }));
  expect(prefsStore.get()).toMatchObject({ scope: 'hunk', layout: 'split', view: 'diff' });
  act(() => setPrefs({ view: 'file' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Switch to Hunk' }));
  expect(prefsStore.get()).toMatchObject({ scope: 'hunk', layout: 'split', view: 'diff' });
});

test('Split renders the old and the new side in their own columns', async () => {
  await openA();
  await userEvent.click(screen.getByRole('button', { name: 'Split' }));
  await waitFor(() => expect(panel().querySelector('[data-view=split]')).toBeTruthy());
  const olds = [...panel().querySelectorAll('[data-side=old]')].map((e) => e.textContent);
  const news = [...panel().querySelectorAll('[data-side=new]')].map((e) => e.textContent);
  expect(olds.some((t) => t?.includes('foo(bar)'))).toBe(true);
  expect(news.some((t) => t?.includes('foo(baz)'))).toBe(true);
  expect(olds.some((t) => t?.includes('foo(baz)'))).toBe(false);
});

test('Split renders every added line of an add-heavy block, with an empty old cell beside each extra one', async () => {
  await openA([dfile()], { 'src/a.ts': fdiff([hunk(1, 1, ['-one', '+ONE', '+two', '+three']), hunk(9, 11, [' k', '+only'])]) });
  await userEvent.click(screen.getByRole('button', { name: 'Split' }));
  await waitFor(() => expect(panel().querySelector('[data-view=split]')).toBeTruthy());
  const news = [...panel().querySelectorAll('[data-side=new]')].map((e) => e.textContent);
  for (const t of ['ONE', 'two', 'three', 'only']) expect(news.some((x) => x?.includes(t))).toBe(true);
  expect(panel().querySelectorAll('[data-side=old][data-empty]')).toHaveLength(3);
});

test('the Wrap toggle flips aria-pressed', async () => {
  await openA();
  const wrap = screen.getByRole('button', { name: 'Wrap lines' });
  expect(wrap.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(wrap);
  expect(wrap.getAttribute('aria-pressed')).toBe('true');
});

test('Alt+↓ moves to the next change: it is scrolled into view and the counter follows', async () => {
  await openA();
  await screen.findByText('change 1 of 3');
  fireEvent.keyDown(panel(), { key: 'ArrowDown', altKey: true });
  expect(screen.getByLabelText('Change position').textContent).toBe('change 2 of 3');
  expect(scrolled.at(-1)?.getAttribute('data-change-index')).toBe('1');
  fireEvent.keyDown(panel(), { key: 'ArrowUp', altKey: true });
  expect(screen.getByLabelText('Change position').textContent).toBe('change 1 of 3');
});

test('Ctrl+F opens Find in file; matches are counted and marked; Esc closes the search, not the diff', async () => {
  const d = fdiff([hunk(1, 1, [' const a', '-const b', '+let b', ' x const'])]);
  await openA([dfile()], { 'src/a.ts': d });
  await screen.findByText('change 1 of 1');
  fireEvent.keyDown(panel(), { key: 'f', ctrlKey: true });
  const input = await screen.findByRole('textbox', { name: 'Find in file' });
  await userEvent.type(input, 'CONST');
  expect(screen.getByLabelText('Match').textContent).toBe('1/3');
  expect(panel().querySelectorAll('[data-match]')).toHaveLength(3);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByLabelText('Match').textContent).toBe('2/3');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Find in file' })).toBeNull();
  expect(panel()).toBeTruthy();
});

test('an oversized file is not requested until Show anyway', async () => {
  const { posts } = await openA([dfile({ path: 'huge.txt', added: 20000, deleted: 0, oversized: true })], { 'huge.txt': fdiff([hunk(1, 1, ['+x'])]) });
  expect(await screen.findByText('Large diff (20000 changed lines)')).toBeTruthy();
  expect(posts('diff.file')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Show anyway' }));
  await waitFor(() => expect(posts('diff.file')).toHaveLength(1));
});

test('file states: binary, LFS, conflicted, rename-only, submodule pointer', async () => {
  const files = [
    dfile({ path: 'bin.dat', binary: true, added: null, deleted: null }),
    dfile({ path: 'big.bin' }),
    dfile({ path: 'c.txt', status: 'U' }),
    dfile({ path: 'new.js', oldPath: 'old.js', status: 'R', similarity: 100, added: 0, deleted: 0 }),
    dfile({ path: 'vendor/lib', submodule: true, oldMode: '160000', newMode: '160000' }),
  ];
  const { posts } = await openA(files, {
    'big.bin': fdiff([hunk(1, 1, [' version x', '-oid sha256:a', '+oid sha256:b'])], { lfs: { old: { oid: 'a'.repeat(64), size: 10 }, new: { oid: 'b'.repeat(64), size: 20 } } }),
    'new.js': fdiff([], { path: 'new.js', oldPath: 'old.js' }),
    'vendor/lib': fdiff([], { oldMode: '160000', newMode: '160000', submodule: { old: OID('1'), new: OID('2'), dirty: true } }),
  });
  const pick = (name: RegExp) => userEvent.click(screen.getByRole('option', { name }));
  expect(await screen.findByText('Binary file — not shown')).toBeTruthy();
  await pick(/big\.bin/);
  const lfs = await screen.findByLabelText('Git LFS pointer');
  expect(lfs.textContent).toContain('a'.repeat(12));
  expect(lfs.textContent).toContain('b'.repeat(12));
  expect(panel().querySelector('[data-view]')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Show pointer' }));
  expect(panel().querySelector('[data-view]')).toBeTruthy();
  await pick(/c\.txt/);
  expect(await screen.findByText('Conflicted file — resolve it first')).toBeTruthy();
  // A commit's diff: no working-tree conflict to open.
  expect(screen.queryByRole('button', { name: 'Open in merge tool' })).toBeNull();
  await pick(/old\.js/);
  expect(await screen.findByText('No content changes')).toBeTruthy();
  expect(screen.getByText('renamed from old.js (100% similar)')).toBeTruthy();
  await pick(/vendor/);
  const sub = await screen.findByText(/Submodule pointer/);
  expect(sub.textContent).toContain('1111111 → 2222222');
  expect(screen.getByText('dirty')).toBeTruthy();
  expect(panel().querySelector('[data-view]')).toBeNull();
  expect(posts('diff.file').map((p) => p.path)).not.toContain('bin.dat');
  expect(posts('diff.file').map((p) => p.path)).not.toContain('c.txt');
});

test('an empty file added or deleted says so, not "No content changes"', async () => {
  await openA([dfile({ path: 'new-empty', status: 'A', added: 0, deleted: 0 }), dfile({ path: 'gone-empty', status: 'D', added: 0, deleted: 0 })], {
    'new-empty': fdiff([], { oldMode: null, newMode: '100644' }), 'gone-empty': fdiff([], { oldMode: '100644', newMode: null }),
  });
  expect(await screen.findByText('Empty file added')).toBeTruthy();
  await userEvent.click(screen.getByRole('option', { name: /gone-empty/ }));
  expect(await screen.findByText('Empty file deleted')).toBeTruthy();
  expect(screen.queryByText('No content changes')).toBeNull();
});

test("a merge commit's parent select refetches the list with parent 2", async () => {
  const { posts } = world(filesResult([dfile()], { commit: { oid: OID('m'), parents: [OID('1'), OID('2')] } }), { 'src/a.ts': A_DIFF });
  show();
  act(() => openDiff(APP, { kind: 'commit', rev: 'HEAD' }));
  const select = await screen.findByRole('combobox', { name: 'Compare with parent' });
  await userEvent.selectOptions(select, '2');
  await waitFor(() => expect(posts('diff.files').at(-1)?.source).toEqual({ kind: 'commit', rev: 'HEAD', parent: 2 }));
});

test('untrusted text — a diff line and a path holding markup — renders as text, never as elements', async () => {
  await openA([dfile({ path: '<b>p</b>' })], { '<b>p</b>': fdiff([hunk(1, 1, ['+<img src=x onerror=alert(1)>'])]) });
  await waitFor(() => expect(panel().textContent).toContain('<img src=x onerror=alert(1)>'));
  expect(panel().textContent).toContain('<b>p</b>');
  expect(panel().querySelector('img')).toBeNull();
  expect(panel().querySelector('b')).toBeNull();
});
