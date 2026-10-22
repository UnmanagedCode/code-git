import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Shell } from '@/shell/Shell';
import { diffStore } from '@/state/diff';
import { shownPanelStore } from '@/state/shownPanel';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { dfile, fdiff, filesResult, hunk, OID } from '@/test/diffFixtures';
import { json, summary } from '@/test/fixtures';
import { refsResult } from '@/test/graphData';
import { stubFetch } from '@/test/stubFetch';
import type { DiffFile, DiffFilesResult, FileDiff } from './api';
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
    'GET api/activity': { entries: [] },
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
      return r instanceof Response ? r : { ok: true, result: r };
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

const panel = () => screen.getByRole('region', { name: 'Diff' });

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
  act(() => openDiff(APP, { kind: 'unstaged' }));
  await screen.findByRole('option', { name: /app\.ts/ });
  act(() => dispatchTabs({ type: 'open', tab: OTHER }));
  expect(screen.queryByRole('region', { name: 'Diff' })).toBeNull();
  act(() => openDiff(OTHER, { kind: 'staged' }));
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

test('a file is loaded against the pinned pair diff.files returned, not the original source', async () => {
  const { posts } = await openA();
  await waitFor(() => expect(posts('diff.file')).toHaveLength(1));
  // The Changes panel's own unstaged/staged lists are not the diff's.
  expect(posts('diff.files').filter((p) => (p.source as { kind: string }).kind === 'commit')[0].source).toEqual({ kind: 'commit', rev: 'HEAD' });
  expect(posts('diff.file')[0]).toEqual({
    source: { kind: 'pair', old: { type: 'tree', oid: OID('a') }, new: { type: 'tree', oid: OID('b') } }, path: 'src/a.ts', context: 3, whitespace: 'none',
  });
});

test('Inline asks for the full file; Hunk asks for the chosen context', async () => {
  const { posts } = await openA();
  await waitFor(() => expect(posts('diff.file')).toHaveLength(1));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Context lines' }), '10');
  await waitFor(() => expect(posts('diff.file').at(-1)?.context).toBe(10));
  await userEvent.click(screen.getByRole('button', { name: 'Inline' }));
  await waitFor(() => expect(posts('diff.file').at(-1)?.context).toBe('full'));
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
