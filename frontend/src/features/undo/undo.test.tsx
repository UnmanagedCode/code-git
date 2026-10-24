import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { ConfirmHost } from '@/features/workdir/ConfirmDialog';
import { useShellKeys } from '@/shell/useShellKeys';
import { Toasts } from '@/shell/Toasts';
import { dispatchTabs, tabKey } from '@/state/tabs';
import { undoOf } from '@/state/undo';
import { workdirStore, workdirOf } from '@/state/workdir';
import { json } from '@/test/fixtures';
import { activityStore } from '@/state/useActivity';
import { opRun } from '@/test/fixtures';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import type { UndoSlot, UndoState } from './api';
import { confirmOptions, UNDO_SHELL_KEYS } from './flows';
import { UndoButtons } from './UndoButtons';

const TAB = { project: 'app', worktree: null };
afterEach(() => { toast.dismiss(); });
const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join('|');
const slot = (over: Partial<UndoSlot> = {}): UndoSlot => ({ id: 7, op: 'commit.create', label: 'Commit “x”', confirm: null, ...over });

function Harness() {
  useShellKeys(UNDO_SHELL_KEYS);
  return <><input aria-label="Field" /><div role="group" aria-label="Header"><UndoButtons tab={TAB} /></div><ConfirmHost /><Toasts /></>;
}

/** The graph backend, undo.state answering `states` in turn (the last repeats), undo.undo / undo.redo answering `run`, and `extra` routes. */
function world(states: UndoState[], run: (dir: 'undo' | 'redo') => Response | unknown = (dir) => ({ ok: true, result: { entry: states[0][dir], warnings: [] } }), extra: Parameters<typeof stubGraph>[1] = {}) {
  let n = 0;
  const fetch = stubGraph(linearWorld(2), {
    'POST api/ops/undo.state': () => ({ ok: true, result: states[Math.min(n++, states.length - 1)] }),
    'POST api/ops/undo.undo': () => run('undo'),
    'POST api/ops/undo.redo': () => run('redo'),
    'POST api/ops/commit.state': { ok: true, result: { merging: false, operation: null, conflicts: [] } },
    ...extra,
  });
  act(() => dispatchTabs({ type: 'open', tab: TAB }));
  render(<Harness />);
  return { fetch, posts: (op: string) => paramsOf(fetch, `POST api/ops/${op}`) };
}
const button = (name: string) => within(screen.getByRole('group', { name: 'Header' })).getByRole('button', { name });

// Invariant: the header buttons follow undo.state: enabled with the entry's label, disabled with "Nothing to …" as the reason.
test('Undo / Redo follow undo.state', async () => {
  world([{ undo: slot(), redo: null }]);
  await waitFor(() => expect(button('Undo').hasAttribute('disabled')).toBe(false));
  expect(button('Undo').getAttribute('title')).toBe('Undo Commit “x” (Ctrl/⌘+Z)');
  expect(button('Redo').hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Nothing to redo').id).toBe(button('Redo').getAttribute('aria-describedby'));
});

// Invariant: Ctrl/⌘+Z posts undo.undo with the slot's id; Ctrl/⌘+Shift+Z and Ctrl/⌘+Y post undo.redo; nothing from a text field.
test('the keys post the slot id; ignored in a text field', async () => {
  const w = world([{ undo: slot({ id: 3 }), redo: slot({ id: 4, label: 'Commit “y”' }) }]);
  await waitFor(() => expect(undoOf(TAB).data).not.toBe(null));
  screen.getByRole('textbox', { name: 'Field' }).focus();
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  expect(w.posts('undo.undo')).toEqual([]);
  (document.activeElement as HTMLElement).blur();
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  await waitFor(() => expect(w.posts('undo.undo')).toEqual([{ id: 3 }]));
  fireEvent.keyDown(window, { key: 'Z', metaKey: true, shiftKey: true });
  fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
  await waitFor(() => expect(w.posts('undo.redo')).toEqual([{ id: 4 }, { id: 4 }]));
});

// Invariant: an entry with a confirmation asks first, listing what it deletes; Cancel sends nothing, Confirm sends it.
test('a deletesRefs entry asks first; cancel sends nothing', async () => {
  const w = world([{ undo: slot({ label: 'Create branch side', confirm: { kind: 'deletesRefs', refs: ['refs/heads/side'] } }), redo: null }]);
  await waitFor(() => expect(button('Undo').hasAttribute('disabled')).toBe(false));
  await userEvent.click(button('Undo'));
  await waitFor(() => expect(confirmStore.get()?.opts).toMatchObject({ title: 'Undo Create branch side?', items: ['side'], confirmLabel: 'Undo' }));
  act(() => settleConfirm(false));
  await act(async () => {});
  expect(w.posts('undo.undo')).toEqual([]);
  await userEvent.click(button('Undo'));
  await waitFor(() => expect(confirmStore.get()).not.toBe(null));
  act(() => settleConfirm(true));
  await waitFor(() => expect(w.posts('undo.undo')).toEqual([{ id: 7 }]));
});

// Invariant: a hard-reset entry always confirms, in both directions (D4), naming the hard reset.
test('a resetHard entry always confirms', async () => {
  world([{ undo: slot({ confirm: { kind: 'resetHard' } }), redo: slot({ id: 8, confirm: { kind: 'resetHard' } }) }]);
  await waitFor(() => expect(button('Redo').hasAttribute('disabled')).toBe(false));
  await userEvent.click(button('Redo'));
  await waitFor(() => expect(confirmStore.get()?.opts.body).toMatch(/hard reset/));
  act(() => settleConfirm(false));
  await userEvent.click(button('Undo'));
  await waitFor(() => expect(confirmStore.get()?.opts.title).toBe('Undo Commit “x”?'));
  act(() => settleConfirm(false));
});

// Invariant: done toasts "Undid <label>" with a Redo action that runs the redo; the slots are refetched after.
test('the done toast offers the counter-action', async () => {
  const w = world([{ undo: slot(), redo: null }, { undo: null, redo: slot() }]);
  await waitFor(() => expect(button('Undo').hasAttribute('disabled')).toBe(false));
  await userEvent.click(button('Undo'));
  await waitFor(() => expect(toastText()).toContain('Undid Commit “x”'));
  await waitFor(() => expect(button('Redo').hasAttribute('disabled')).toBe(false));
  const region = screen.getByRole('region', { name: /Notifications/ });
  await userEvent.click(within(region).getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(w.posts('undo.redo')).toEqual([{ id: 7 }]));
});

// Invariant: a CC_OWNED_BRANCH refusal offers Review…, which asks and retries with ccOwned: true.
test('a code-conductor refusal: Review… confirms and retries with ccOwned', async () => {
  let n = 0;
  const w = world([{ undo: slot(), redo: null }], () => (n++ === 0
    ? json({ error: 'owned', code: 'CC_OWNED_BRANCH', branches: ['code-conductor/x'], head: true }, 409)
    : { ok: true, result: { entry: slot(), warnings: [] } }));
  await waitFor(() => expect(button('Undo').hasAttribute('disabled')).toBe(false));
  await userEvent.click(button('Undo'));
  const region = screen.getByRole('region', { name: /Notifications/ });
  await userEvent.click(await within(region).findByRole('button', { name: 'Review…' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Undo anyway'));
  act(() => settleConfirm(true));
  await waitFor(() => expect(w.posts('undo.undo')).toEqual([{ id: 7 }, { id: 7, ccOwned: true }]));
});

// Invariant: the end of a write run in this checkout refetches the slots once; nothing while it runs, nor for a run in
// another checkout of the project or another project.
test('the end of a write run here refetches undo.state', async () => {
  const w = world([{ undo: null, redo: null }, { undo: slot(), redo: null }]);
  await waitFor(() => expect(w.fetch.count('POST api/ops/undo.state')).toBe(1));
  const wt = { project: 'app', worktree: 'wt' };
  act(() => activityStore.set({ entries: [], runs: [opRun({ id: 1, status: 'running', endedAt: null, target: TAB })], error: null }));
  act(() => activityStore.set((s) => ({ ...s, runs: [...s.runs, opRun({ id: 2, target: wt }), opRun({ id: 3, target: { project: 'other', worktree: null } })] })));
  await act(async () => {});
  expect(w.fetch.count('POST api/ops/undo.state')).toBe(1);
  act(() => activityStore.set((s) => ({ ...s, runs: [opRun({ id: 1, target: TAB }), ...s.runs.slice(1)] })));
  await waitFor(() => expect(button('Undo').hasAttribute('disabled')).toBe(false));
  expect(w.fetch.count('POST api/ops/undo.state')).toBe(2);
  act(() => activityStore.set((s) => ({ ...s, runs: [...s.runs, opRun({ id: 4, target: wt })] })));
  await act(async () => {});
  expect(w.fetch.count('POST api/ops/undo.state')).toBe(2);
});

// Invariant: while an operation is in progress Undo and Redo are disabled with that reason, and the keys send nothing.
test('disabled during an operation in progress', async () => {
  const w = world([{ undo: slot(), redo: slot({ id: 9 }) }]);
  await waitFor(() => expect(button('Undo').hasAttribute('disabled')).toBe(false));
  act(() => workdirStore.set(new Map([[tabKey(TAB), { ...workdirOf(TAB), operation: { kind: 'cherry-pick', incoming: null, rebase: null } }]])));
  expect(button('Undo').hasAttribute('disabled')).toBe(true);
  expect(button('Undo').getAttribute('title')).toMatch(/cherry-pick is in progress/);
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  await act(async () => {});
  expect(w.posts('undo.undo')).toEqual([]);
});

// Invariant: the stash-drop confirmation lists the stash messages it drops; the remote-removal one names the remote and
// lists its tracking refs by short name. Neither passes a count (the dialog would call them files).
test('confirmOptions: dropsStashes lists the messages, deletesRemote the remote and its tracking refs', () => {
  const drop = slot({ op: 'stash.drop', label: 'Drop stash “On main: wip”' });
  const d = confirmOptions('redo', drop, { kind: 'dropsStashes', messages: ['On main: wip'] });
  expect(d).toMatchObject({ title: 'Redo Drop stash “On main: wip”?', items: ['On main: wip'], confirmLabel: 'Redo' });
  expect(d.count).toBe(undefined);
  const remove = slot({ op: 'remote.remove', label: 'Remove remote up' });
  const c = confirmOptions('redo', remove, { kind: 'deletesRemote', name: 'up', refs: ['refs/remotes/up/HEAD', 'refs/remotes/up/main'] });
  expect(c).toMatchObject({ title: 'Redo Remove remote up?', items: ['up/HEAD', 'up/main'], confirmLabel: 'Redo' });
  expect(c.count).toBe(undefined);
  expect(c.body).toContain('up');
  expect(confirmOptions('redo', remove, { kind: 'deletesRemote', name: 'up', refs: [] }).items ?? []).toEqual([]);
});

// Invariant: a stash message is untrusted text: in the slot's title and its confirmation it renders as text, never markup.
test('a stash message with markup renders as text', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  world([{ undo: null, redo: slot({ op: 'stash.drop', label: `Drop stash “${hostile}”`, confirm: { kind: 'dropsStashes', messages: [hostile] } }) }]);
  await waitFor(() => expect(button('Redo').hasAttribute('disabled')).toBe(false));
  await userEvent.click(button('Redo'));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(hostile)).toBeTruthy();
  expect(document.querySelector('img')).toBe(null);
  act(() => settleConfirm(false));
});

// Invariant (R2): a stash drop's redo asks first and Cancel sends nothing; a stash save's undo (no confirm) sends at once.
test('a drop-redo slot confirms (cancel sends nothing); a push-undo slot sends at once', async () => {
  const w = world([{ undo: slot({ id: 5, op: 'stash.push', label: 'Stash changes' }), redo: slot({ id: 6, op: 'stash.drop', label: 'Drop stash “m”', confirm: { kind: 'dropsStashes', messages: ['m'] } }) }]);
  await waitFor(() => expect(button('Redo').hasAttribute('disabled')).toBe(false));
  await userEvent.click(button('Redo'));
  await waitFor(() => expect(confirmStore.get()?.opts.items).toEqual(['m']));
  act(() => settleConfirm(false));
  await act(async () => {});
  expect(w.posts('undo.redo')).toEqual([]);
  await userEvent.click(button('Undo'));
  await waitFor(() => expect(w.posts('undo.undo')).toEqual([{ id: 5 }]));
  expect(confirmStore.get()).toBe(null);
});

// Invariant: undoing or redoing a remote.* entry refetches the remotes list and the branches' tracking (a config-only
// change moves no ref the graph would notice); another entry does not.
test('after a remote.* undo, remote.list and branch.tracking are refetched; after a commit undo, not', async () => {
  const states: UndoState[] = [{ undo: slot({ id: 1, op: 'commit.create' }), redo: null }, { undo: slot({ id: 2, op: 'remote.edit', label: 'Edit remote origin' }), redo: null }];
  const w = world(states, () => ({ ok: true, result: { entry: slot(), warnings: [] } }), {
    'POST api/ops/remote.list': { ok: true, result: { remotes: [] } },
    'POST api/ops/branch.tracking': { ok: true, result: { branches: {} } },
  });
  const listed = () => w.fetch.count('POST api/ops/remote.list');
  const tracked = () => w.fetch.count('POST api/ops/branch.tracking');
  await waitFor(() => expect(button('Undo').hasAttribute('disabled')).toBe(false));
  const [l0, t0] = [listed(), tracked()];
  await userEvent.click(button('Undo'));
  await waitFor(() => expect(w.posts('undo.undo')).toEqual([{ id: 1 }]));
  await waitFor(() => expect(button('Undo').getAttribute('title')).toMatch(/Edit remote origin/));
  expect([listed(), tracked()]).toEqual([l0, t0]);
  await userEvent.click(button('Undo'));
  await waitFor(() => expect(w.posts('undo.undo')).toEqual([{ id: 1 }, { id: 2 }]));
  await waitFor(() => expect(listed()).toBe(l0 + 1));
  await waitFor(() => expect(tracked()).toBe(t0 + 1));
});
