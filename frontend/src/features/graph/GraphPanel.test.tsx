import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { entry, summary } from '@/test/fixtures';
import { commit, oid, ref } from '@/test/graphData';
import { linearWorld, paramsOf, stubGraph, type GraphWorld } from '@/test/graphBackend';
import { getGraph, loadUntil, PAGE } from '@/state/graph';
import { updatePrefs } from '@/state/graphPrefs';
import { getSelection } from '@/state/graphSelection';
import { activityStore } from '@/state/useActivity';
import { diffStore } from '@/state/diff';
import { shownPanelStore } from '@/state/shownPanel';
import { loadSummary } from '@/state/useRepoSummary';
import { workdirOf } from '@/state/workdir';
import { GraphPanel } from './GraphPanel';
import { requestJump } from './jump';
import { DISPLAY_MAX } from '@/lib/clip';
import { LANE_CAP } from './layout';
import { TIPS_MAX } from './visibility';
import { ROW_H } from './windowFor';

const TAB = { project: 'app', worktree: null };
afterEach(() => vi.useRealTimers());

async function show(world: GraphWorld) {
  const fetch = stubGraph(world);
  await loadSummary(TAB);
  render(<GraphPanel tab={TAB} />);
  await screen.findByRole('listbox', { name: 'Commits' });
  await waitFor(() => expect(document.querySelector('[data-row-id]')).not.toBeNull());
  return fetch;
}
const list = () => screen.getByRole('listbox', { name: 'Commits' });
const rowEls = () => [...document.querySelectorAll<HTMLElement>('[data-row-id]')];
const rowEl = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
/** Scrolls the list (happy-dom has no layout: the viewport height is given). */
async function scrollTo(top: number, height = 800) {
  const el = list();
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
  el.scrollTop = top;
  fireEvent.scroll(el);
  await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

test('the first page is read from the tips of refs + prefs at skip 0', async () => {
  const world = linearWorld(30);
  world.refs.refs.push(ref('refs/tags/t', oid(12)), ref('refs/heads/gone', oid(3)));
  updatePrefs('app', (p) => ({ ...p, hidden: ['refs/heads/gone'] }));
  const fetch = await show(world);
  expect(paramsOf(fetch, 'POST api/ops/graph.page')).toEqual([{ tips: [oid(12), oid(30)], skip: 0, limit: PAGE }]);
});

test('with 5,000 rows loaded the DOM holds at most 120 rows, at the top, the middle and the end', async () => {
  const world = linearWorld(5000);
  await show(world);
  await act(async () => { await loadUntil(TAB, oid(1)); });
  expect(getGraph(TAB).commits.length).toBe(5000);
  for (const top of [0, 2500 * ROW_H, 5000 * ROW_H - 800]) {
    await scrollTo(top);
    const n = rowEls().length;
    expect(n, `at ${top}`).toBeGreaterThan(20);
    expect(n, `at ${top}`).toBeLessThanOrEqual(120);
  }
  expect(rowEl(oid(1))).not.toBeNull();
});

test('nearing the end of the loaded rows requests the next page at skip 500', async () => {
  const fetch = await show(linearWorld(1200));
  expect(paramsOf(fetch, 'POST api/ops/graph.page')).toHaveLength(1);
  await scrollTo(380 * ROW_H);
  await waitFor(() => expect(paramsOf(fetch, 'POST api/ops/graph.page')).toHaveLength(2));
  expect(paramsOf(fetch, 'POST api/ops/graph.page')[1]).toMatchObject({ skip: PAGE, limit: PAGE });
});

test('a finished write reloads moved tips: the selection survives and the first visible row keeps its offset; unmoved tips reload nothing', async () => {
  const world = linearWorld(600);
  const fetch = await show(world);
  await scrollTo(100 * ROW_H + 5);
  fireEvent.click(rowEl(oid(500 - 0))!);
  expect(getSelection(TAB).ids).toEqual([oid(500)]);
  world.commits.unshift(commit(oid(601), [oid(600)]), commit(oid(602), [oid(601)]));
  [world.commits[0], world.commits[1]] = [world.commits[1], world.commits[0]];
  world.refs.refs[0] = ref('refs/heads/main', oid(602), { isHead: true });
  world.refs.head.oid = oid(602);
  act(() => activityStore.set({ entries: [entry({ id: 9, kind: 'write', op: 'commit.create' })], error: null }));
  await waitFor(() => expect(getGraph(TAB).tipsKey).toBe(oid(602)));
  await waitFor(() => expect(list().scrollTop).toBe(102 * ROW_H + 5));
  expect(getSelection(TAB).ids).toEqual([oid(500)]);
  const pages = paramsOf(fetch, 'POST api/ops/graph.page').length;
  act(() => activityStore.set({ entries: [entry({ id: 9, kind: 'write' }), entry({ id: 10, kind: 'write' })], error: null }));
  await waitFor(() => expect(fetch.count('POST api/ops/graph.refs')).toBe(3));
  expect(paramsOf(fetch, 'POST api/ops/graph.page')).toHaveLength(pages);
});

test('j/k and the arrows move the selection; Shift+J stays in the lane; Ctrl+End and Esc', async () => {
  const world = linearWorld(10);
  // A side branch: S1 → S0 → oid(5), unmerged, so it takes a second lane.
  world.commits.splice(2, 0, commit('a'.repeat(40), ['b'.repeat(40)], { subject: 'side 1' }), commit('b'.repeat(40), [oid(5)], { subject: 'side 0' }));
  world.refs.refs.push(ref('refs/heads/side', 'a'.repeat(40)));
  await show(world);
  const ids = rowEls().map((e) => e.dataset.rowId!);
  const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(list(), { key: k, ...init });
  key('j');
  expect(getSelection(TAB).ids).toEqual([ids[0]]);
  key('ArrowDown');
  key('j');
  expect(getSelection(TAB).ids).toEqual([ids[2]]);
  expect(rowEl(ids[2])!.getAttribute('aria-selected')).toBe('true');
  key('k');
  expect(getSelection(TAB).ids).toEqual([ids[1]]);
  const col = rowEl(ids[1])!.dataset.col;
  key('J', { shiftKey: true });
  const after = getSelection(TAB).ids[0];
  expect(rowEl(after)!.dataset.col).toBe(col);
  expect(ids.indexOf(after)).toBeGreaterThan(2);
  key('End', { ctrlKey: true });
  expect(getSelection(TAB).ids).toEqual([ids.at(-1)]);
  key('Escape');
  expect(getSelection(TAB).ids).toEqual([]);
});

test('search asks git with the mode and query and marks the matching rows; Enter moves to the next match', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const world = linearWorld(20);
  world.search = ({ query }) => ({ matches: query === 'fix' ? [oid(18), oid(11)] : [], truncated: false });
  const fetch = await show(world);
  const box = screen.getByRole('textbox', { name: 'Search commits' });
  fireEvent.change(box, { target: { value: 'fix' } });
  await act(async () => { vi.advanceTimersByTime(300); });
  await waitFor(() => expect(rowEl(oid(18))!.hasAttribute('data-match')).toBe(true));
  expect(paramsOf(fetch, 'POST api/ops/graph.search')).toEqual([{ mode: 'commits', query: 'fix', tips: [oid(20)] }]);
  expect(rowEl(oid(17))!.hasAttribute('data-match')).toBe(false);
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(getSelection(TAB).ids).toEqual([oid(18)]);
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(getSelection(TAB).ids).toEqual([oid(11)]);
  expect(screen.getByLabelText('Match position').textContent).toBe('2 / 2');
  fireEvent.click(screen.getByRole('button', { name: 'Path' }));
  await act(async () => { vi.advanceTimersByTime(300); });
  await waitFor(() => expect(paramsOf(fetch, 'POST api/ops/graph.search').at(-1)).toEqual({ mode: 'path', query: 'fix', tips: [oid(20)] }));
});

test('a label appears once its tip row is loaded; a jump pages to it and selects it', async () => {
  const world = linearWorld(900);
  world.refs.refs.push(ref('refs/heads/old', oid(200)));
  await show(world);
  expect(screen.queryByText('old')).toBeNull();
  expect(getGraph(TAB).commits.some((c) => c.oid === oid(200))).toBe(false);
  act(() => requestJump(TAB, oid(200)));
  await waitFor(() => expect(getSelection(TAB).ids).toEqual([oid(200)]));
  await scrollTo(list().scrollTop);
  expect(within(rowEl(oid(200))!).getByText('old')).toBeTruthy();
});

test('a jump to a commit outside the snapshot says so', async () => {
  const world = linearWorld(10);
  await show(world);
  act(() => requestJump(TAB, oid(99999)));
  expect(await screen.findByText('Not in the visible graph.')).toBeTruthy();
});

test('an HTML subject renders as text', async () => {
  const world = linearWorld(3);
  world.commits[0].subject = '<img src=x onerror=alert(1)>';
  await show(world);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
});

test('WIP rows of dirty checkouts come first, the own one on top; a clean checkout has none', async () => {
  const world = linearWorld(5);
  world.worktrees = [{ worktreeName: 'wt', branch: 'code-conductor/wt', baseBranch: 'main', locked: false }, { worktreeName: 'clean', branch: null, baseBranch: null, locked: false }];
  world.refs.refs.push(ref('refs/heads/code-conductor/wt', oid(3)));
  world.summaries[''] = summary({ head: { oid: oid(5), branch: 'main', unborn: false }, counts: { staged: 0, unstaged: 2, untracked: 0, conflicted: 0 } });
  world.summaries.wt = summary({ head: { oid: oid(3), branch: 'code-conductor/wt', unborn: false }, counts: { staged: 1, unstaged: 0, untracked: 0, conflicted: 0 } });
  world.summaries.clean = summary({ head: { oid: oid(2), branch: null, unborn: false } });
  await show(world);
  await waitFor(() => expect(rowEls().map((e) => e.dataset.rowId).slice(0, 3)).toEqual(['wip:', 'wip:wt', oid(5)]));
  expect(rowEl('wip:')!.textContent).toContain('// WIP');
  expect(rowEl('wip:')!.querySelector('[data-edge=bottom]')!.getAttribute('stroke-dasharray')).toBe('3 3');
});

test('hovering a ref chip dims the rows outside its ancestry', async () => {
  const world = linearWorld(6);
  world.commits.splice(1, 0, commit('c'.repeat(40), [oid(4)], { subject: 'feature tip' }));
  world.refs.refs.push(ref('refs/heads/feature', 'c'.repeat(40)));
  await show(world);
  fireEvent.mouseEnter(screen.getByText('feature'));
  expect(rowEl(oid(6))!.hasAttribute('data-dimmed')).toBe(true);
  expect(rowEl('c'.repeat(40))!.hasAttribute('data-dimmed')).toBe(false);
  expect(rowEl(oid(4))!.hasAttribute('data-dimmed')).toBe(false);
  expect(rowEl(oid(1))!.hasAttribute('data-dimmed')).toBe(false);
  fireEvent.mouseLeave(screen.getByText('feature'));
  expect(rowEls().some((e) => e.hasAttribute('data-dimmed'))).toBe(false);
});

test('a checkout that is not a repo shows no graph', async () => {
  const fetch = stubGraph({ ...linearWorld(3), summaries: { '': new Response(JSON.stringify({ error: 'not a git repository', code: 'NOT_A_REPO' }), { status: 409 }) } });
  await loadSummary(TAB);
  const { container } = render(<GraphPanel tab={TAB} />);
  await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toBe('');
  expect(fetch.count('POST api/ops/graph.refs')).toBe(0);
});

test('right-click: a commit row offers the commit menu, a branch chip the branch menu, a multi-selection the commits menu', async () => {
  const world = linearWorld(5);
  world.refs.refs.push(ref('refs/heads/feat', oid(3)));
  await show(world);
  fireEvent.contextMenu(rowEl(oid(4))!, { clientX: 10, clientY: 20 });
  let menu = await screen.findByRole('menu');
  // The graph's own items close the menu; write actions (features/branches) come before them.
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent).slice(-5)).toEqual(['Show details', 'View changes', 'Compare with working directory', 'Copy SHA', 'Copy message']);
  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  fireEvent.contextMenu(screen.getByText('feat'));
  menu = await screen.findByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent).slice(-5)).toEqual(['Jump to commit', 'Copy name', 'Hide', 'Solo', 'Pin to left']);
  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  fireEvent.click(rowEl(oid(5))!);
  fireEvent.click(rowEl(oid(3))!, { shiftKey: true });
  fireEvent.contextMenu(rowEl(oid(4))!);
  menu = await screen.findByRole('menu');
  // The merge/rebase card's items for a run of HEAD's newest commits come first.
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Squash 3 commits…', 'Rebase 3 commits onto…', 'View combined diff', 'Copy 3 SHAs']);
});

test('Shift+F10 opens the focused row menu; the checked-out branch chip has no Hide', async () => {
  await show(linearWorld(3));
  fireEvent.keyDown(list(), { key: 'j' });
  fireEvent.keyDown(list(), { key: 'F10', shiftKey: true });
  const menu = await screen.findByRole('menu');
  // The focused row is HEAD: C4's "Edit HEAD message…" (order 300) sorts above the graph's own items.
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(expect.arrayContaining(['Edit HEAD message…', 'Show details']));
  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  fireEvent.contextMenu(screen.getByText('main'));
  expect(within(await screen.findByRole('menu')).queryByRole('menuitem', { name: 'Hide' })).toBeNull();
});

test('Enter opens the selection diff: a commit, a multi-selection as the commits source; a WIP row opens the Changes panel', async () => {
  const world = linearWorld(5);
  world.summaries[''] = summary({ head: { oid: oid(5), branch: 'main', unborn: false }, counts: { staged: 0, unstaged: 1, untracked: 0, conflicted: 0 } });
  await show(world);
  await waitFor(() => expect(rowEl('wip:')).not.toBeNull());
  const source = () => diffStore.get().get('app\0')?.source;
  fireEvent.click(rowEl(oid(4))!);
  fireEvent.keyDown(list(), { key: 'Enter' });
  expect(source()).toEqual({ kind: 'commit', rev: oid(4) });
  expect(shownPanelStore.get().get('app\0')).toBe('diff');
  fireEvent.click(rowEl(oid(2))!, { shiftKey: true });
  fireEvent.keyDown(list(), { key: 'Enter' });
  expect(source()).toEqual({ kind: 'commits', oids: [oid(4), oid(3), oid(2)], wip: false });
  fireEvent.click(rowEl('wip:')!);
  // The click shows the Changes panel without taking the focus; Enter asks it to focus its summary. No diff opens.
  expect(workdirOf(TAB).focus).toBeNull();
  fireEvent.keyDown(list(), { key: 'Enter' });
  expect(source()).toEqual({ kind: 'commits', oids: [oid(4), oid(3), oid(2)], wip: false });
  expect(workdirOf(TAB).focus).toBe('slot');
});

test('below lg the toolbar opens Refs and Compare as dialogs', async () => {
  const happy = (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM;
  happy.setViewport({ width: 390, height: 844 });
  try {
    await show(linearWorld(3));
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    const dialog = await screen.findByRole('dialog', { name: 'Compare' });
    expect(within(dialog).getByRole('textbox', { name: 'Commit (sha or ref)' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Unstaged changes/ }));
    expect(diffStore.get().get('app\0')?.source).toEqual({ kind: 'unstaged' });
  } finally {
    happy.setViewport({ width: 1024, height: 768 });
  }
});

test('a commit with an impossible timestamp renders — in the Date column instead of crashing', async () => {
  const world = linearWorld(3);
  world.commits[1].time = Number('99999999999999999999');
  updatePrefs('app', (p) => ({ ...p, columns: { ...p.columns, visible: ['date'] } }));
  await show(world);
  expect(within(rowEl(oid(2))!).getByText('—')).toBeTruthy();
  expect(within(rowEl(oid(3))!).queryByText('—')).toBeNull();
});

test('2,000 parallel branches: drawn paths per row stay bounded by the drawn lanes, at the top, middle and end', async () => {
  const n = 2000;
  const base = oid(99999);
  const world = linearWorld(1);
  world.commits = [...Array.from({ length: n }, (_, i) => commit(oid(i + 1), [base], { subject: `tip ${i}` })), commit(base)];
  world.refs.refs = Array.from({ length: n }, (_, i) => ref(`refs/heads/b${i}`, oid(i + 1)));
  world.refs.head = { oid: oid(1), branch: 'refs/heads/b0', detached: false, unborn: false };
  await show(world);
  await act(async () => { await loadUntil(TAB, base); });
  expect(getGraph(TAB).commits.length).toBe(n + 1);
  let most = 0;
  for (const top of [0, 1000 * ROW_H, (n + 1) * ROW_H - 800]) {
    await scrollTo(top);
    for (const r of rowEls()) most = Math.max(most, r.querySelectorAll('path').length);
  }
  expect(most).toBeGreaterThan(LANE_CAP);
  expect(most).toBeLessThanOrEqual(3 * (LANE_CAP + 1));
  expect(rowEl(base)!.querySelectorAll('[data-edge=top]').length).toBe(LANE_CAP + 1);
});

test('more ref tips than one request takes: the graph pages the first TIPS_MAX and says so', async () => {
  const world = linearWorld(3);
  world.refs.refs.push(...Array.from({ length: TIPS_MAX + 7 }, (_, i) => ref(`refs/tags/t${i}`, `${i}`.padStart(40, 'a'))));
  const fetch = await show(world);
  expect((paramsOf(fetch, 'POST api/ops/graph.page')[0] as { tips: string[] }).tips).toHaveLength(TIPS_MAX);
  expect(screen.getByRole('status').textContent).toContain(`of ${(TIPS_MAX + 8).toLocaleString()} ref tips`);
});

test('a 1 MB subject, author and ref name are shown cut to DISPLAY_MAX, in the text and the title', async () => {
  const huge = 'x'.repeat(1_000_000);
  const world = linearWorld(2);
  world.commits[0].subject = huge;
  world.commits[0].author = { name: `N${huge}`, email: `e${huge}` };
  world.refs.refs.push(ref(`refs/heads/${huge}`, oid(2)));
  updatePrefs('app', (p) => ({ ...p, columns: { ...p.columns, visible: ['author'] } }));
  await show(world);
  const row = rowEl(oid(2))!;
  expect(row.textContent!.length).toBeLessThan(4 * DISPLAY_MAX);
  for (const el of row.querySelectorAll('[title]')) expect(el.getAttribute('title')!.length).toBeLessThanOrEqual(DISPLAY_MAX + 1);
  expect(row.querySelector('[data-cell=message] [title]')!.getAttribute('title')).toBe(`${'x'.repeat(DISPLAY_MAX)}…`);
});
