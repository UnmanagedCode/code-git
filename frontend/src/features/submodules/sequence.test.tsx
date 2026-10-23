import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { openConflict } from '@/features/conflicts/open';
import { toolOf } from '@/features/conflicts/state';
import type { Conflict, ConflictRead, Operation } from '@/features/sequence/api';
import { Shell } from '@/shell/Shell';
import { dispatchTabs } from '@/state/tabs';
import { OID } from '@/test/diffFixtures';
import { workdirWorld } from '@/test/workdirWorld';

// The merge/rebase card's banner and conflict tool in a submodule tab: every read and write they make names the
// submodule (target.sub), so they act on its repository, not the checkout's.

const SUB = { project: 'app', worktree: null, sub: ['libs/a'] };
const MERGE: Operation = { kind: 'merge', incoming: { oid: OID('e'), subject: 'Add x' }, rebase: null };
const conflict = (path: string): Conflict => ({ path, kind: 'bothModified', base: null, ours: { mode: '100644', oid: OID('1') }, theirs: { mode: '100644', oid: OID('2') } });
const targetsOf = (w: ReturnType<typeof workdirWorld>, op: string) => w.fetch.calls.filter((c) => c.url.pathname.endsWith(`/ops/${op}`)).map((c) => (c.body as { target: unknown }).target);

test('in a submodule tab the operation banner reads commit.state and posts head.continue with sub', async () => {
  const w = workdirWorld({ operation: MERGE, conflicts: [], answers: { 'head.continue': { outcome: 'done', files: [], oid: OID('f'), undo: {} } } });
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: SUB }));
  const banner = await screen.findByRole('status', { name: 'Operation in progress' });
  const cont = await within(banner).findByRole('button', { name: 'Continue' });
  await waitFor(() => expect((cont as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(cont);
  await waitFor(() => expect(w.posts('head.continue')).toEqual([{ which: 'merge' }]));
  expect(targetsOf(w, 'head.continue')).toEqual([{ project: 'app', sub: ['libs/a'] }]);
  expect(targetsOf(w, 'commit.state').every((t) => JSON.stringify(t) === JSON.stringify({ project: 'app', sub: ['libs/a'] }))).toBe(true);
});

test('in a submodule tab the conflict tool reads the conflicted file with sub and keeps its state under that tab', async () => {
  const b64 = (t: string) => btoa(t);
  const side = (t: string) => ({ mode: '100644', oid: OID('1'), b64: b64(t) });
  const read: ConflictRead = {
    path: 'a.txt', kind: 'bothModified', content: 'text', base: side('a\n'), ours: side('o\n'), theirs: side('t\n'),
    worktree: { oid: OID('w'), b64: b64('<<<<<<< HEAD\no\n=======\nt\n>>>>>>> feature\n') },
  };
  const w = workdirWorld({ operation: MERGE, conflicts: [conflict('a.txt')], answers: { 'conflict.read': read } });
  dispatchTabs({ type: 'open', tab: { project: 'app', worktree: null } });
  dispatchTabs({ type: 'open', tab: SUB });
  await act(() => openConflict(SUB, 'a.txt'));
  expect(targetsOf(w, 'conflict.read')).toEqual([{ project: 'app', sub: ['libs/a'] }]);
  expect(toolOf(SUB)).not.toBeNull();
  expect(toolOf({ project: 'app', worktree: null })).toBeNull();
});
