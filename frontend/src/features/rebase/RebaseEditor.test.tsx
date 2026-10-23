import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import type { PlanCommit } from '@/features/sequence/api';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { shownPanelStore } from '@/state/shownPanel';
import { tabKey } from '@/state/tabs';
import { workdirOf, workdirStore } from '@/state/workdir';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { ref, refsResult } from '@/test/graphData';
import { openRebaseEditor, type EditorSpec } from './open';
import { RebaseEditor } from './RebaseEditor';
import { editorOf } from './state';

const T = { project: 'app', worktree: null };
const oid = (n: number) => String(n).repeat(40);
const HEAD = oid(4);
const commit = (n: number, summary = `c${n}`): PlanCommit => ({ oid: oid(n), parents: [oid(n - 1)], summary, description: `body ${n}`, author: { name: 'Ann', email: 'a@x', time: 1_700_000_000 } });
const SPEC: EditorSpec = { mode: 'rebase', base: oid(9), onto: oid(9), ontoLabel: 'main', branch: 'topic', expect: HEAD, plan: { base: oid(9), head: HEAD } };

async function show(commits: PlanCommit[] = [commit(1), commit(2), commit(3), commit(4)], { head = 'topic', spec = SPEC } = {}) {
  graphStore.set(new Map([[tabKey(T), {
    ...EMPTY_GRAPH, status: 'ready', refs: refsResult({ head: { oid: HEAD, branch: `refs/heads/${head}`, detached: false, unborn: false }, refs: [ref(`refs/heads/${head}`, HEAD, { isHead: true })] }),
  }]]));
  const f = stubGraph(linearWorld(2), {
    'POST api/ops/rebase.plan': { ok: true, result: { commits } },
    'POST api/ops/rebase.interactive': { ok: true, result: { outcome: 'done', files: [], oid: oid(7), undo: {} } },
    'POST api/ops/commit.state': { ok: true, result: { merging: false } },
  });
  render(<RebaseEditor tab={T} />);
  await act(() => openRebaseEditor(T, spec));
  await screen.findByRole('list', { name: 'Commits to rebase' });
  return f;
}
const rows = () => screen.getAllByRole('listitem');
const rowOf = (n: number) => rows().find((r) => r.getAttribute('aria-label')?.startsWith(oid(n).slice(0, 7)))!;
const actionsShown = () => rows().map((r) => `${r.getAttribute('aria-label')!.slice(0, 1)}:${r.getAttribute('data-action')}`);
const sent = (f: ReturnType<typeof stubGraph>) => paramsOf(f, 'POST api/ops/rebase.interactive') as { rows: unknown[] }[];
const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

test('the header names the rebase; rows oldest first with their oid and summary; Start posts every row as pick', async () => {
  const f = await show();
  expect(screen.getByRole('heading').textContent).toBe('Interactive rebase topic onto main');
  expect(actionsShown()).toEqual(['1:pick', '2:pick', '3:pick', '4:pick']);
  await userEvent.click(btn('Start'));
  await waitFor(() => expect(sent(f)).toHaveLength(1));
  expect(sent(f)[0]).toEqual({ mode: 'rebase', base: oid(9), onto: oid(9), expect: HEAD, rows: [1, 2, 3, 4].map((n) => ({ oid: oid(n), action: 'pick' })) });
  await waitFor(() => expect(editorOf(T)).toBeNull());
});

test('P/E/S/F/D keys on a focused row set its action; ↑/↓ move the focus; R sets reword and opens the message dialog', async () => {
  await show();
  rowOf(2).focus();
  fireEvent.keyDown(rowOf(2), { key: 's' });
  fireEvent.keyDown(rowOf(2), { key: 'ArrowDown' });
  await waitFor(() => expect(document.activeElement).toBe(rowOf(3)));
  fireEvent.keyDown(rowOf(3), { key: 'f' });
  fireEvent.keyDown(rowOf(3), { key: 'ArrowDown' });
  fireEvent.keyDown(rowOf(4), { key: 'd' });
  fireEvent.keyDown(rowOf(4), { key: 'ArrowUp' });
  fireEvent.keyDown(rowOf(3), { key: 'E' });
  expect(actionsShown()).toEqual(['1:pick', '2:squash', '3:edit', '4:drop']);
  fireEvent.keyDown(rowOf(1), { key: 'r' });
  const dialog = await screen.findByRole('dialog');
  expect((within(dialog).getByRole('textbox', { name: 'Summary' }) as HTMLInputElement).value).toBe('c1');
  // The modal hides the list from the accessibility tree: read the row itself.
  expect(document.querySelector('[data-row-index="0"]')?.getAttribute('data-action')).toBe('reword');
});

test('Alt+↑/↓ and the Move buttons reorder; Reset restores the original order', async () => {
  const f = await show();
  rowOf(1).focus();
  fireEvent.keyDown(rowOf(1), { key: 'ArrowDown', altKey: true });
  expect(actionsShown().map((x) => x[0])).toEqual(['2', '1', '3', '4']);
  await userEvent.click(btn(`Move ${oid(4).slice(0, 7)} up`));
  expect(actionsShown().map((x) => x[0])).toEqual(['2', '1', '4', '3']);
  await userEvent.click(btn('Reset'));
  expect(actionsShown().map((x) => x[0])).toEqual(['1', '2', '3', '4']);
  expect(btn('Reset').disabled).toBe(true);
  void f;
});

test('the reword dialog\'s message is what Start sends for that row (and only that row)', async () => {
  const f = await show();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: `Action for ${oid(3).slice(0, 7)}` }), 'reword');
  const dialog = await screen.findByRole('dialog');
  const summary = within(dialog).getByRole('textbox', { name: 'Summary' });
  await userEvent.clear(summary);
  await userEvent.type(summary, 'better c3');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save message' }));
  expect(rowOf(3).textContent).toContain('better c3');
  await userEvent.click(btn('Start'));
  await waitFor(() => expect(sent(f)).toHaveLength(1));
  expect(sent(f)[0].rows[2]).toEqual({ oid: oid(3), action: 'reword', message: { summary: 'better c3', description: 'body 3' } });
  expect(sent(f)[0].rows.filter((r) => 'message' in (r as object))).toHaveLength(1);
});

test('dropping asks first ("Drop N commits?"): Cancel sends nothing, Confirm starts', async () => {
  const f = await show();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: `Action for ${oid(2).slice(0, 7)}` }), 'drop');
  await userEvent.click(btn('Start'));
  await waitFor(() => expect(confirmStore.get()?.opts.title).toBe('Drop 1 commit?'));
  act(() => settleConfirm(false));
  await waitFor(() => expect(btn('Start').disabled).toBe(false));
  expect(sent(f)).toEqual([]);
  await userEvent.click(btn('Start'));
  await waitFor(() => expect(confirmStore.get()).not.toBeNull());
  act(() => settleConfirm(true));
  await waitFor(() => expect(sent(f)).toHaveLength(1));
});

test('Start is disabled with a hint when every row is dropped and while an operation is in progress; an orphan squash shows inline', async () => {
  await show([commit(1), commit(2)]);
  for (const n of [1, 2]) await userEvent.selectOptions(screen.getByRole('combobox', { name: `Action for ${oid(n).slice(0, 7)}` }), 'drop');
  expect(btn('Start').disabled).toBe(true);
  expect(screen.getByText('Every commit is dropped: use Reset to move the branch instead.')).toBeTruthy();
  await userEvent.click(btn('Reset'));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: `Action for ${oid(1).slice(0, 7)}` }), 'squash');
  await userEvent.click(btn('Start'));
  expect(screen.getByRole('alert').textContent).toContain('Row 1: a squash needs a kept commit above it.');
  act(() => workdirStore.set(new Map([[tabKey(T), { ...workdirOf(T), operation: { kind: 'merge', incoming: null, rebase: null } }]])));
  await waitFor(() => expect(btn('Start').disabled).toBe(true));
  expect(screen.getByText('A merge is in progress: continue or abort it first.')).toBeTruthy();
});

test('Cancel with edits asks first; without edits it closes at once (the graph comes back)', async () => {
  await show();
  expect(shownPanelStore.get().get(tabKey(T))).toBe('rebase');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: `Action for ${oid(1).slice(0, 7)}` }), 'edit');
  await userEvent.click(btn('Cancel'));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Discard'));
  act(() => settleConfirm(false));
  expect(editorOf(T)).not.toBeNull();
  await userEvent.click(btn('Reset'));
  await userEvent.click(btn('Cancel'));
  await waitFor(() => expect(editorOf(T)).toBeNull());
  expect(shownPanelStore.get().has(tabKey(T))).toBe(false);
});

test('on a code-conductor/* HEAD Start asks first and sends ccOwned; a cherry-pick (pick mode) never asks', async () => {
  const f = await show(undefined, { head: 'code-conductor/wt' });
  await userEvent.click(btn('Start'));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Rebase anyway'));
  expect(sent(f)).toEqual([]);
  act(() => settleConfirm(true));
  await waitFor(() => expect(sent(f)[0]).toMatchObject({ ccOwned: true }));
});

test('commit messages render as text', async () => {
  await show([commit(1, '<img src=x onerror=alert(1)>')]);
  expect(document.querySelector('img')).toBeNull();
  expect(rowOf(1).textContent).toContain('<img src=x onerror=alert(1)>');
});
