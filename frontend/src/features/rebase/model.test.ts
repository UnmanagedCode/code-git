import { expect, test } from 'vitest';
import type { PlanCommit } from '@/features/sequence/api';
import {
  chains, defaultSquashMessage, edited, messageOf, move, presetRows, reset, setAction, setMessage, toRequest, validate, type EditorRow, type RebaseSession,
} from './model';

const oid = (n: number) => String(n).repeat(40);
const commit = (n: number, description = ''): PlanCommit => ({ oid: oid(n), parents: [oid(n - 1)], summary: `c${n}`, description, author: { name: 'A', email: 'a@x', time: 1 } });
const COMMITS = [commit(1, 'one body'), commit(2), commit(3, 'three body'), commit(4)];
function session(rows: EditorRow[] = presetRows('rebase', COMMITS), mode: RebaseSession['mode'] = 'rebase'): RebaseSession {
  return { mode, base: oid(9), onto: oid(8), ontoLabel: 'main', branch: 'topic', expect: oid(4), commits: Object.fromEntries(COMMITS.map((c) => [c.oid, c])), rows, original: presetRows('rebase', COMMITS) };
}
const actions = (rows: EditorRow[]) => rows.map((r) => r.action);

test('presets: every row pick; the squash preset keeps the oldest selected and squashes the rest of the selection', () => {
  expect(actions(presetRows('rebase', COMMITS))).toEqual(['pick', 'pick', 'pick', 'pick']);
  expect(actions(presetRows('squash', COMMITS, [oid(3), oid(2)]))).toEqual(['pick', 'pick', 'squash', 'pick']);
});

test('setAction, move (clamped), reset and edited', () => {
  const s = session();
  const rows = move(setAction(s.rows, 0, 'drop'), 0, 9);
  expect(rows.map((r) => [r.oid[0], r.action])).toEqual([['2', 'pick'], ['3', 'pick'], ['4', 'pick'], ['1', 'drop']]);
  expect(move(rows, 2, -5).map((r) => r.oid[0])).toEqual(['4', '2', '3', '1']);
  expect(edited({ ...s, rows })).toBe(true);
  expect(edited(reset({ ...s, rows }))).toBe(false);
});

test('chains: heads, squash/fixup members across drops, orphans, which need a message', () => {
  const rows = presetRows('rebase', COMMITS).map((r, i) => ({ ...r, action: (['fixup', 'reword', 'drop', 'squash'] as const)[i] }));
  const { chains: cs, orphans } = chains(rows);
  expect(orphans).toEqual([0]);
  expect(cs).toEqual([{ head: 1, members: [3], squash: true, needsMessage: true }]);
});

test('defaultSquashMessage: the head\'s message, then each squashed commit\'s (summary and body), never a fixup\'s', () => {
  let rows = setAction(setAction(setAction(session().rows, 1, 'squash'), 2, 'squash'), 3, 'fixup');
  const chain = chains(rows).chains[0];
  expect(defaultSquashMessage(rows, session().commits, chain)).toEqual({ summary: 'c1', description: 'one body\n\nc2\n\nc3\n\nthree body' });
  rows = setMessage(rows, 0, { summary: 'mine', description: '' });
  expect(messageOf(session(rows), 0)).toEqual({ summary: 'mine', description: '' });
});

test('validate: nothing to rebase, all dropped, an orphan squash, a reword without a message, a blank summary', () => {
  expect(validate(session([]))).toEqual(['Nothing to rebase.']);
  expect(validate(session(session().rows.map((r) => ({ ...r, action: 'drop' as const }))))).toEqual(['Every commit is dropped: use Reset to move the branch instead.']);
  expect(validate(session(setAction(session().rows, 0, 'squash')))).toEqual(['Row 1: a squash needs a kept commit above it.']);
  expect(validate(session(setAction(session().rows, 2, 'reword')))).toEqual(['Row 3: give the reworded commit a message.']);
  expect(validate(session(setMessage(setAction(session().rows, 2, 'reword'), 2, { summary: ' ', description: 'x' })))).toEqual(['Row 3: the message needs a one-line summary.']);
  expect(validate(session(setAction(session().rows, 1, 'squash')))).toEqual([]);
});

test('toRequest: squash runs as a rebase; messages only on a reword or a squash chain\'s head (the default when not edited)', () => {
  let rows = setAction(session().rows, 1, 'squash');
  rows = setMessage(setAction(rows, 3, 'reword'), 3, { summary: 'new 4', description: 'why' });
  rows = setMessage(rows, 2, { summary: 'ignored', description: '' });
  expect(toRequest(session(rows, 'squash'))).toEqual({
    mode: 'rebase', base: oid(9), onto: oid(8), expect: oid(4),
    rows: [
      { oid: oid(1), action: 'pick', message: { summary: 'c1', description: 'one body\n\nc2' } },
      { oid: oid(2), action: 'squash' },
      { oid: oid(3), action: 'pick' },
      { oid: oid(4), action: 'reword', message: { summary: 'new 4', description: 'why' } },
    ],
  });
  expect(toRequest(session(session().rows, 'pick')).mode).toBe('pick');
});
