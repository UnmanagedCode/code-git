import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { Ref, RefsResult } from '@/features/graph/types';
import { EMPTY_GRAPH, getGraph, graphStore } from '@/state/graph';
import { openRefDialog, refDialogStore, type RefDialog } from '@/state/refDialog';
import { tabKey } from '@/state/tabs';
import { checkout as checkoutFixture, oid, ref, refsResult } from '@/test/graphData';
import { json } from '@/test/fixtures';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { RefDialogHost } from './RefDialogHost';
import { NAMES_SHOWN } from './dialogs/Frame';

const T = { project: 'app', worktree: null };
const ccHeadRef = ref('refs/heads/code-conductor/wt', oid(8), { isHead: true });
const MAIN = ref('refs/heads/main', oid(9), { isHead: true });

function setHead(head: Ref, counts = { staged: 2, unstaged: 3, untracked: 1, conflicted: 0 }) {
  const refs: RefsResult = refsResult({ head: { oid: head.oid, branch: head.name, detached: false, unborn: false }, refs: [head] });
  graphStore.set(new Map([[tabKey(T), { ...EMPTY_GRAPH, status: 'ready', refs, checkouts: [checkoutFixture(null, { counts })] }]]));
}

/** The backend: the graph ops (answering the refs setHead seeded, so a refresh after an op keeps HEAD), plus `ops`. */
function backend(ops: Record<string, unknown>) {
  const world = linearWorld(2);
  world.refs = getGraph(T).refs ?? world.refs;
  return stubGraph(world, Object.fromEntries(Object.entries(ops).map(([n, r]) => [`POST api/ops/${n}`, r])));
}
const sent = (f: ReturnType<typeof backend>, op: string) => f.calls.filter((c) => c.url.pathname.endsWith(`/ops/${op}`)).map((c) => (c.body as { params: unknown }).params);
const opCalls = (f: ReturnType<typeof backend>) => f.calls.filter((c) => /\/ops\/(branch|tag|head)\./.test(c.url.pathname));

function show(d: RefDialog) {
  render(<RefDialogHost />);
  act(() => openRefDialog(d));
  return screen.getByRole('dialog');
}

const DESTRUCTIVE: [string, RefDialog, string][] = [
  ['delete', { kind: 'deleteBranches', tab: T, refs: [ref('refs/heads/old', oid(3))] }, 'Delete branch'],
  ['remote delete', { kind: 'deleteBranches', tab: T, refs: [ref('refs/remotes/origin/old', oid(3))] }, 'Delete branch'],
  ['tag remote delete', { kind: 'deleteTags', tab: T, names: ['v1'], remote: 'origin' }, 'Delete'],
  ['hard reset', { kind: 'reset', tab: T, to: { oid: oid(3), label: '0000003' }, mode: 'hard', branch: 'main', expect: oid(9) }, 'Reset hard'],
  ['force-move', { kind: 'moveBranch', tab: T, name: 'free', from: oid(5), to: { oid: oid(3), label: 'main' } }, 'Move branch'],
];

for (const [what, d, confirm] of DESTRUCTIVE) {
  test(`${what}: no request before Confirm — Cancel and Esc send nothing`, async () => {
    setHead(MAIN);
    const f = backend({});
    const dialog = show(d);
    expect(within(dialog).getByRole('button', { name: confirm })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openRefDialog(d));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opCalls(f)).toEqual([]);
  });
}

test('delete local + remote: branch.delete then branch.deleteRemote per remote; the dialog closes on success', async () => {
  setHead(MAIN);
  const f = backend({
    'branch.delete': { ok: true, result: { deleted: ['a'], notMerged: [], undo: {} } },
    'branch.deleteRemote': { ok: true, result: { deleted: ['b'], rejected: [], undo: {} } },
  });
  const dialog = show({ kind: 'deleteBranches', tab: T, refs: [ref('refs/heads/a', oid(1)), ref('refs/remotes/origin/b', oid(2))] });
  expect(within(dialog).getByRole('list', { name: 'Local branches to delete' }).textContent).toBe('a');
  expect(within(dialog).getByRole('list', { name: 'Branches to delete on origin' }).textContent).toBe('b');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 branches' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent(f, 'branch.delete')).toEqual([{ names: ['a'] }]);
  expect(sent(f, 'branch.deleteRemote')).toEqual([{ remote: 'origin', branches: ['b'] }]);
});

test('notMerged turns the dialog into "Delete anyway", which sends force: true for those branches only', async () => {
  setHead(MAIN);
  const f = backend({
    'branch.delete': (_u: URL, init?: RequestInit) => (JSON.parse(String(init?.body)).params.force
      ? { ok: true, result: { deleted: ['u'], notMerged: [], undo: {} } }
      : { ok: true, result: { deleted: ['m'], notMerged: ['u'], undo: {} } }),
  });
  const dialog = show({ kind: 'deleteBranches', tab: T, refs: [ref('refs/heads/m', oid(1)), ref('refs/heads/u', oid(2))] });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 branches' }));
  const again = await screen.findByRole('button', { name: 'Delete anyway' });
  expect(screen.getByRole('list', { name: 'Not fully merged' }).textContent).toBe('u');
  await userEvent.click(again);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent(f, 'branch.delete')).toEqual([{ names: ['m', 'u'] }, { names: ['u'], force: true }]);
});

test('a code-conductor/* name shows the warning and sends ccOwned: true; others send none', async () => {
  setHead(MAIN);
  const f = backend({ 'branch.delete': { ok: true, result: { deleted: ['code-conductor/old'], notMerged: [], undo: {} } }, 'branch.rename': { ok: true, result: { ref: 'x', undo: {} } } });
  let dialog = show({ kind: 'deleteBranches', tab: T, refs: [ref('refs/heads/code-conductor/old', oid(1))] });
  expect(within(dialog).getByRole('note').textContent).toContain('code-conductor/old belongs to code-conductor');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete branch' }));
  await waitFor(() => expect(sent(f, 'branch.delete')).toEqual([{ names: ['code-conductor/old'], ccOwned: true }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  act(() => openRefDialog({ kind: 'renameBranch', tab: T, name: 'plain' }));
  dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('note')).toBeNull();
  await userEvent.clear(within(dialog).getByRole('textbox'));
  await userEvent.type(within(dialog).getByRole('textbox'), 'code-conductor/new');
  expect(within(dialog).getByRole('note')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
  await waitFor(() => expect(sent(f, 'branch.rename')).toEqual([{ name: 'plain', newName: 'code-conductor/new', ccOwned: true }]));
});

test('on a cc HEAD the hard-reset dialog warns inline and sends ccOwned; it states what is discarded', async () => {
  setHead(ccHeadRef);
  const f = backend({ 'head.reset': { ok: true, result: { undo: {} } } });
  const dialog = show({ kind: 'reset', tab: T, to: { oid: oid(3), label: '0000003' }, mode: 'hard', branch: 'code-conductor/wt', expect: oid(8) });
  expect(dialog.textContent).toContain('Discards 2 staged changes and 3 unstaged changes (untracked files stay).');
  expect(within(dialog).getByRole('note').textContent).toContain("code-conductor's worktree on code-conductor/wt");
  await userEvent.click(within(dialog).getByRole('button', { name: 'Reset hard' }));
  await waitFor(() => expect(sent(f, 'head.reset')).toEqual([{ to: oid(3), mode: 'hard', expect: oid(8), ccOwned: true }]));
});

test('createBranch on a cc HEAD warns only while "Check out after creating" is on, and sends ccOwned only then', async () => {
  setHead(ccHeadRef);
  const f = backend({ 'branch.create': { ok: true, result: { ref: 'x', oid: oid(8), checkedOut: false, undo: {} } } });
  let dialog = show({ kind: 'createBranch', tab: T, from: null });
  expect(within(dialog).getByRole('note')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Check out after creating' }));
  expect(within(dialog).queryByRole('note')).toBeNull();
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Branch name' }), 'side');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create branch' }));
  await waitFor(() => expect(sent(f, 'branch.create')).toEqual([{ name: 'side', checkout: false }]));
  act(() => openRefDialog({ kind: 'createBranch', tab: T, from: { oid: oid(3), label: '0000003' } }));
  dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Branch name' }), 'on');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create branch' }));
  await waitFor(() => expect(sent(f, 'branch.create')[1]).toEqual({ name: 'on', from: oid(3), checkout: true, ccOwned: true }));
});

test('ccHeadMove names the branch as text; only Switch anyway runs, with the acknowledgement', async () => {
  setHead(MAIN);
  backend({});
  const run = vi.fn(async () => {});
  const d: RefDialog = { kind: 'ccHeadMove', tab: T, branch: 'code-conductor/<img src=x>', action: 'checkout', label: 'Switching to free', run };
  let dialog = show(d);
  expect(dialog.querySelector('img')).toBeNull();
  expect(within(dialog).getByRole('note').textContent).toContain('code-conductor/<img src=x>');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(run).not.toHaveBeenCalled();
  act(() => openRefDialog(d));
  dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Switch anyway' }));
  expect(run).toHaveBeenCalledWith(true);
  expect(refDialogStore.get()).toBeNull();
});

test('REF_EXISTS shows inline and keeps the dialog open; the running state disables submit', async () => {
  setHead(MAIN);
  let answer!: (r: Response) => void;
  backend({ 'branch.create': () => new Promise<Response>((r) => { answer = r; }) });
  const dialog = show({ kind: 'createBranch', tab: T, from: null });
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Branch name' }), 'main');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create branch' }));
  const busy = await within(dialog).findByRole('button', { name: 'Creating…' });
  expect((busy as HTMLButtonElement).disabled).toBe(true);
  await act(async () => answer(json({ error: 'branch main already exists', code: 'REF_EXISTS' }, 409)));
  expect((await within(dialog).findByRole('alert')).textContent).toContain('branch main already exists');
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect((within(dialog).getByRole('button', { name: 'Create branch' }) as HTMLButtonElement).disabled).toBe(false);
});

test('names and messages render as text', () => {
  setHead(MAIN);
  backend({});
  const dialog = show({ kind: 'deleteBranches', tab: T, refs: [ref('refs/heads/<img src=x onerror=1>', oid(1))] });
  expect(dialog.querySelector('img')).toBeNull();
  expect(dialog.textContent).toContain('<img src=x onerror=1>');
});

test('createTag: a message makes it annotated; it is sent as typed', async () => {
  setHead(MAIN);
  const f = backend({ 'tag.create': { ok: true, result: { ref: 'refs/tags/v1', oid: oid(1), undo: {} } } });
  const dialog = show({ kind: 'createTag', tab: T, at: { oid: oid(3), label: '0000003' } });
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tag name' }), 'v1');
  expect(within(dialog).getByRole('button', { name: 'Create tag' })).toBeTruthy();
  await userEvent.type(within(dialog).getByRole('textbox', { name: /Message/ }), '# keep');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create annotated tag' }));
  await waitFor(() => expect(sent(f, 'tag.create')).toEqual([{ name: 'v1', oid: oid(3), message: '# keep' }]));
});

const REJECTED = [{ ref: 'refs/heads/b', reason: 'deletion of the current branch prohibited' }];

test('a fully rejected remote delete keeps the dialog open with each ref and its reason; nothing is reported as deleted', async () => {
  setHead(MAIN);
  const f = backend({ 'branch.deleteRemote': json({ error: 'origin rejected the push: …', code: 'PUSH_REJECTED', rejected: REJECTED }, 409) });
  const dialog = show({ kind: 'deleteBranches', tab: T, refs: [ref('refs/remotes/origin/b', oid(2))] });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete branch' }));
  const alert = await within(dialog).findByRole('alert');
  expect(alert.textContent).toContain('Not deleted: b');
  expect(within(alert).getByRole('list').textContent).toBe('refs/heads/b: deletion of the current branch prohibited');
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(sent(f, 'branch.deleteRemote')).toHaveLength(1);
});

test('a partly rejected remote delete names what was deleted and what was refused, and stays open', async () => {
  setHead(MAIN);
  backend({ 'branch.deleteRemote': { ok: true, result: { deleted: ['c'], rejected: REJECTED, unrequested: [], undo: {} } } });
  const dialog = show({ kind: 'deleteBranches', tab: T, refs: [ref('refs/remotes/origin/b', oid(2)), ref('refs/remotes/origin/c', oid(3))] });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 branches' }));
  const alert = await within(dialog).findByRole('alert');
  expect(dialog.querySelector('[data-outcome="remote:origin"]')!.textContent).toContain('Deleted: origin/c');
  expect(alert.textContent).toContain('refs/heads/b: deletion of the current branch prohibited');
});

test('after locals succeed and a remote fails, Retry re-sends only the failed remote step, then closes', async () => {
  setHead(MAIN);
  let remoteCalls = 0;
  const f = backend({
    'branch.delete': { ok: true, result: { deleted: ['a'], notMerged: [], undo: {} } },
    'branch.deleteRemote': () => (++remoteCalls === 1
      ? json({ error: 'git push exited with 1', code: 'GIT_FAILED', stderr: 'pre-push hook said no' }, 422)
      : { ok: true, result: { deleted: ['b'], rejected: [], unrequested: [], undo: {} } }),
  });
  const dialog = show({ kind: 'deleteBranches', tab: T, refs: [ref('refs/heads/a', oid(1)), ref('refs/remotes/origin/b', oid(2))] });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 branches' }));
  await within(dialog).findByRole('alert');
  expect(dialog.querySelector('[data-outcome="local"]')!.textContent).toBe('Deleted: a');
  expect(dialog.querySelector('[data-outcome="remote:origin"]')!.textContent).toContain('git push exited with 1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent(f, 'branch.delete')).toEqual([{ names: ['a'] }]);
  expect(sent(f, 'branch.deleteRemote')).toEqual([{ remote: 'origin', branches: ['b'] }, { remote: 'origin', branches: ['b'] }]);
});

test('remote tag delete: a full rejection lists the refused refs inline; a partial one keeps the dialog open on them', async () => {
  setHead(MAIN);
  const rej = [{ ref: 'refs/tags/v1', reason: 'hook declined' }];
  let calls = 0;
  backend({
    'tag.deleteRemote': () => (++calls === 1
      ? json({ error: 'origin rejected the push: refs/tags/v1: hook declined', code: 'PUSH_REJECTED', rejected: rej }, 409)
      : { ok: true, result: { deleted: ['v2'], rejected: rej, unrequested: [], undo: {} } }),
  });
  const dialog = show({ kind: 'deleteTags', tab: T, names: ['v1', 'v2'], remote: 'origin' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  const alert = await within(dialog).findByRole('alert');
  expect(within(alert).getByRole('list', { name: 'Rejected' }).textContent).toBe('refs/tags/v1: hook declined');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('origin rejected:'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(within(within(dialog).getByRole('alert')).getByRole('list').textContent).toBe('refs/tags/v1: hook declined');
});

test('a capped delete says how many were left out, and a long name list ends with "…and N more"', () => {
  setHead(MAIN);
  backend({});
  const refs = Array.from({ length: NAMES_SHOWN + 3 }, (_, i) => ref(`refs/heads/b${i}`, oid(1)));
  const dialog = show({ kind: 'deleteBranches', tab: T, refs, omitted: 7 });
  expect(dialog.querySelector('[data-omitted]')!.textContent).toContain('7 more stay selected');
  const items = within(within(dialog).getByRole('list', { name: 'Local branches to delete' })).getAllByRole('listitem');
  expect(items).toHaveLength(NAMES_SHOWN + 1);
  expect(items.at(-1)!.textContent).toBe('…and 3 more');
});
