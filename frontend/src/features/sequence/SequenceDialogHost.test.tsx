import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { EMPTY_GRAPH, graphStore } from '@/state/graph';
import { openSequenceDialog, sequenceDialogStore } from '@/state/sequenceDialog';
import { tabKey } from '@/state/tabs';
import { json } from '@/test/fixtures';
import { linearWorld, paramsOf, stubGraph } from '@/test/graphBackend';
import { oid, ref, refsResult } from '@/test/graphData';
import { SequenceDialogHost } from './SequenceDialogHost';

const T = { project: 'app', worktree: null };
const HEAD = oid(9);

function setup(head: string, answer: unknown) {
  graphStore.set(new Map([[tabKey(T), {
    ...EMPTY_GRAPH, status: 'ready',
    refs: refsResult({
      head: { oid: HEAD, branch: `refs/heads/${head}`, detached: false, unborn: false },
      refs: [ref(`refs/heads/${head}`, HEAD, { isHead: true }), ref('refs/heads/main', oid(5)), ref('refs/remotes/origin/main', oid(6))],
    }),
  }]]));
  const f = stubGraph(linearWorld(2), { 'POST api/ops/rebase.start': answer, 'POST api/ops/commit.state': { ok: true, result: { merging: false } } });
  render(<SequenceDialogHost />);
  act(() => openSequenceDialog({ kind: 'rebaseOnto', tab: T, count: 2, upstream: oid(3), expect: HEAD }));
  return f;
}

test('Rebase N commits onto: lists the other local and remote branches; Rebase posts the picked one as onto with the oldest\'s parent as upstream, then closes', async () => {
  const f = setup('feature', { ok: true, result: { outcome: 'done', files: [], oid: oid(7), undo: {} } });
  const select = await screen.findByRole('combobox', { name: 'Onto' }) as HTMLSelectElement;
  expect([...select.options].map((o) => o.textContent)).toEqual(['main', 'origin/main']);
  await userEvent.selectOptions(select, 'refs/remotes/origin/main');
  await userEvent.click(screen.getByRole('button', { name: 'Rebase' }));
  await waitFor(() => expect(paramsOf(f, 'POST api/ops/rebase.start')).toEqual([{ onto: oid(6), upstream: oid(3), expect: HEAD }]));
  await waitFor(() => expect(sequenceDialogStore.get()).toBeNull());
});

test('on a code-conductor/* HEAD the dialog warns and sends ccOwned; a refusal stays inline with the dialog open', async () => {
  const f = setup('code-conductor/wt', json({ error: 'HEAD is no longer at x', code: 'REF_MOVED' }, 409));
  expect(await screen.findByRole('note')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Rebase' }));
  await waitFor(() => expect(paramsOf(f, 'POST api/ops/rebase.start')).toEqual([{ onto: oid(5), upstream: oid(3), expect: HEAD, ccOwned: true }]));
  expect((await screen.findByRole('alert')).textContent).toContain('HEAD is no longer at x');
  expect(sequenceDialogStore.get()).not.toBeNull();
});
