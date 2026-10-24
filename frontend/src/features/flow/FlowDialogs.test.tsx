import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, expect, test } from 'vitest';
import type { Ref } from '@/features/graph/types';
import { confirmStore, settleConfirm } from '@/lib/confirm';
import { flowDialogStore, openFlowDialog } from '@/state/flowDialog';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { tabKey } from '@/state/tabs';
import { json } from '@/test/fixtures';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { oid, ref, refsResult } from '@/test/graphData';
import type { FlowConfigResult } from './api';
import { FlowHost } from './FlowHost';
import { flowStore } from './state';

afterEach(() => { toast.dismiss(); });

const T = { project: 'app', worktree: null };
const CONFIG: FlowConfigResult = {
  initialized: true, main: 'main', develop: 'develop',
  prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: 'v' },
  defaults: { main: 'main', develop: 'develop', prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: '' } },
};
const UNSET: FlowConfigResult = { ...CONFIG, initialized: false, main: null, develop: null, prefixes: { feature: null, release: null, hotfix: null, versionTag: null } };
const OK = (result: unknown) => ({ ok: true, result });
const FINISHED = OK({ branch: 'release/1.0', merges: [], tag: { name: 'v1.0', oid: oid(7) }, deleted: true, head: 'develop' });

/** The flow ops answered by `answers` (op → responder), the graph's ops stubbed; HEAD on `head`; the settings `config`. */
function world(answers: Record<string, unknown>, { head = ref('refs/heads/main', oid(1)), config = CONFIG }: { head?: Ref; config?: FlowConfigResult } = {}) {
  graphStore.set(new Map([[tabKey(T), {
    ...EMPTY_GRAPH, status: 'ready', refs: refsResult({ head: { oid: head.oid, branch: head.name, detached: false, unborn: false }, refs: [head] }),
  }]]));
  flowStore.set(new Map([['app', config]]));
  const f = stubGraph(linearWorld(1), {
    'POST api/ops/flow.config': OK(config),
    ...Object.fromEntries(Object.entries(answers).map(([op, r]) => [`POST api/ops/${op}`, r])),
  });
  render(<FlowHost />);
  return { posts: (op: string) => f.calls.filter((c) => c.url.pathname.endsWith(`/ops/${op}`)).map((c) => (c.body as { params: unknown }).params) };
}

const FINISH = { kind: 'finish', tab: T, type: 'release', name: '1.0', branch: 'release/1.0', expect: oid(3) } as const;

test('finish lists each merge, the tag and the delete as text, and sends {type, name, expect, tagMessage}', async () => {
  const w = world({ 'flow.finish': FINISHED });
  act(() => openFlowDialog(FINISH));
  const d = await screen.findByRole('dialog', { name: 'Finish release/1.0?' });
  const steps = within(within(d).getByRole('list', { name: 'Steps' })).getAllByRole('listitem').map((li) => li.textContent);
  expect(steps).toEqual([
    'Merge release/1.0 into main (no fast-forward), then tag v1.0 on main',
    'Merge release/1.0 into develop (no fast-forward)',
    'Delete release/1.0; HEAD ends on develop',
  ]);
  const message = within(d).getByRole('textbox', { name: 'Tag message' }) as HTMLTextAreaElement;
  expect(message.value).toBe('Release 1.0');
  await userEvent.clear(message);
  await userEvent.type(message, 'Release 1.0 final');
  await userEvent.click(within(d).getByRole('button', { name: 'Finish' }));
  await waitFor(() => expect(w.posts('flow.finish')).toEqual([{ type: 'release', name: '1.0', expect: oid(3), tagMessage: 'Release 1.0 final' }]));
  await waitFor(() => expect(flowDialogStore.get()).toBeNull());
});

test('a feature finish has no tag step and sends no tagMessage', async () => {
  const w = world({ 'flow.finish': FINISHED });
  act(() => openFlowDialog({ kind: 'finish', tab: T, type: 'feature', name: 'login', branch: 'feature/login', expect: oid(2) }));
  const d = await screen.findByRole('dialog', { name: 'Finish feature/login?' });
  expect(within(d).queryByRole('textbox', { name: 'Tag message' })).toBeNull();
  expect(within(within(d).getByRole('list', { name: 'Steps' })).getAllByRole('listitem')).toHaveLength(2);
  await userEvent.click(within(d).getByRole('button', { name: 'Finish' }));
  await waitFor(() => expect(w.posts('flow.finish')).toEqual([{ type: 'feature', name: 'login', expect: oid(2) }]));
});

test('FLOW_CONFLICT files and FLOW_INCOMPLETE output render as literal text, never markup; the dialog stays open', async () => {
  let answer = json({ error: 'merging release/1.0 into develop would conflict', code: 'FLOW_CONFLICT', into: 'develop', files: ['<b>x</b>.txt'] }, 409);
  world({ 'flow.finish': () => answer });
  act(() => openFlowDialog(FINISH));
  const d = await screen.findByRole('dialog', { name: 'Finish release/1.0?' });
  await userEvent.click(within(d).getByRole('button', { name: 'Finish' }));
  const files = await within(d).findByRole('list', { name: 'Conflicting files' });
  expect(files.textContent).toBe('<b>x</b>.txt');
  expect(d.querySelector('b')).toBeNull();
  answer = json({
    error: 'the finish stopped at its merge step (develop)', code: 'FLOW_INCOMPLETE', step: 'merge', into: 'develop', done: [],
    cause: { code: 'GIT_FAILED', message: 'git merge exited with 1', stderr: '<b>HOOK-SAYS-NO</b>' },
  }, 409);
  await userEvent.click(within(d).getByRole('button', { name: 'Finish' }));
  await within(d).findByText('<b>HOOK-SAYS-NO</b>');
  expect(d.querySelector('b')).toBeNull();
  expect(within(d).getByRole('alert').textContent).toContain('the finish stopped at its merge step');
  expect(flowDialogStore.get()?.kind).toBe('finish');
});

test('start: the name label shows the resulting branch; it sends {type, name}', async () => {
  const w = world({ 'flow.start': OK({ branch: 'hotfix/1.0.1', base: 'main', oid: oid(1) }) });
  act(() => openFlowDialog({ kind: 'start', tab: T, type: 'feature' }));
  const d = await screen.findByRole('dialog', { name: 'Start feature' });
  await userEvent.selectOptions(within(d).getByRole('combobox', { name: 'Type' }), 'hotfix');
  await userEvent.type(within(d).getByRole('textbox', { name: 'Name' }), '1.0.1');
  expect(within(d).getByRole('textbox', { name: 'Name (branch hotfix/1.0.1)' })).toBeTruthy();
  await userEvent.click(within(d).getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(w.posts('flow.start')).toEqual([{ type: 'hotfix', name: '1.0.1' }]));
});

test('start from a code-conductor/* HEAD: the dialog gives way to the confirmation; only Confirm sends, with ccOwned', async () => {
  const w = world({ 'flow.start': OK({ branch: 'feature/x', base: 'develop', oid: oid(1) }) }, { head: ref('refs/heads/code-conductor/wt', oid(1)) });
  act(() => openFlowDialog({ kind: 'start', tab: T, type: 'feature' }));
  const d = await screen.findByRole('dialog', { name: 'Start feature' });
  await userEvent.type(within(d).getByRole('textbox', { name: 'Name' }), 'x');
  await userEvent.click(within(d).getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Switch anyway'));
  expect(flowDialogStore.get()).toBeNull();
  expect(w.posts('flow.start')).toEqual([]);
  act(() => settleConfirm(true));
  await waitFor(() => expect(w.posts('flow.start')).toEqual([{ type: 'feature', name: 'x', ccOwned: true }]));
});

test('initialize is prefilled from the defaults and sends the settings', async () => {
  const w = world({ 'flow.init': OK({ config: CONFIG, createdDevelop: true }) }, { config: UNSET });
  act(() => openFlowDialog({ kind: 'init', tab: T }));
  const d = await screen.findByRole('dialog', { name: 'Initialize git-flow' });
  expect((within(d).getByRole('textbox', { name: 'Production branch' }) as HTMLInputElement).value).toBe('main');
  await userEvent.type(within(d).getByRole('textbox', { name: 'Version tag prefix (optional)' }), 'v');
  await userEvent.click(within(d).getByRole('button', { name: 'Initialize' }));
  await waitFor(() => expect(w.posts('flow.init')).toEqual([{
    main: 'main', develop: 'develop', prefixes: { feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: 'v' },
  }]));
});

test('finish from a code-conductor/* HEAD: the dialog gives way to the confirmation; only Confirm sends, with ccOwned', async () => {
  const w = world({ 'flow.finish': FINISHED }, { head: ref('refs/heads/code-conductor/wt', oid(1)) });
  act(() => openFlowDialog(FINISH));
  const d = await screen.findByRole('dialog', { name: 'Finish release/1.0?' });
  await userEvent.click(within(d).getByRole('button', { name: 'Finish' }));
  await waitFor(() => expect(confirmStore.get()?.opts.confirmLabel).toBe('Switch anyway'));
  expect(flowDialogStore.get()).toBeNull();
  expect(w.posts('flow.finish')).toEqual([]);
  act(() => settleConfirm(true));
  await waitFor(() => expect(w.posts('flow.finish')).toEqual([{ type: 'release', name: '1.0', expect: oid(3), tagMessage: 'Release 1.0', ccOwned: true }]));
});
