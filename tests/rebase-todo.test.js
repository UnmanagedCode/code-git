import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTodo, chains, messageText, renderTodo } from '../src/git/rebase/todo.js';
import { REBASE_LIMITS } from '../src/git/sequence/limits.js';

const O = (n) => String(n).repeat(40);
const row = (n, action, message = null) => ({ oid: O(n), action, message });
const badParams = (e) => { assert.equal(e.code, 'BAD_PARAMS', e.message); return true; };
const show = ({ lines, carriers }) => ({ lines: lines.map((l) => `${l.command} ${l.carrier === null ? l.oid[0] : `#${l.carrier}`}`), carriers: carriers.map((c) => `${c.oid[0]}: ${c.message}`) });

test('pick, edit and drop pass through, drops explicit; no carrier without a message', () => {
  assert.deepEqual(show(buildTodo([row(1, 'pick'), row(2, 'drop'), row(3, 'edit')])), { lines: ['pick 1', 'drop 2', 'edit 3'], carriers: [] });
});

test('a reword becomes pick of a carrier holding its message', () => {
  assert.deepEqual(show(buildTodo([row(1, 'pick'), row(2, 'reword', 'New\n')])), { lines: ['pick 1', 'pick #0'], carriers: ['2: New\n'] });
});

test('squash rows become fixup and the chain head a carrier with the chain\'s message; a fixup-only chain keeps its head', () => {
  assert.deepEqual(show(buildTodo([row(1, 'pick', 'All\n'), row(2, 'squash'), row(3, 'fixup'), row(4, 'pick'), row(5, 'fixup')])), {
    lines: ['pick #0', 'fixup 2', 'fixup 3', 'pick 4', 'fixup 5'], carriers: ['1: All\n'],
  });
});

test('an edit heading a squash chain is "edit <carrier>"; a drop between does not break the chain', () => {
  assert.deepEqual(show(buildTodo([row(1, 'edit', 'E\n'), row(2, 'drop'), row(3, 'squash')])), { lines: ['edit #0', 'drop 2', 'fixup 3'], carriers: ['1: E\n'] });
});

test('renderTodo writes one "<command> <oid>" line per row, a carrier\'s oid for its row', () => {
  const t = buildTodo([row(1, 'reword', 'R\n'), row(2, 'drop')]);
  assert.equal(renderTodo(t.lines, [O(9)]), `pick ${O(9)}\ndrop ${O(2)}\n`);
});

test('chains: heads, members, and which need a message', () => {
  assert.deepEqual(chains([row(1, 'reword'), row(2, 'pick'), row(3, 'squash'), row(4, 'edit'), row(5, 'fixup')]).map((c) => [c.head, c.members, c.needsMessage]), [
    [0, [], true], [1, [2], true], [3, [4], false],
  ]);
});

test('BAD_PARAMS: no rows, all dropped, an unknown action, a squash/fixup with no kept row above, a message where none is taken, none where one is needed', () => {
  const cases = [
    [],
    [row(1, 'drop'), row(2, 'drop')],
    [row(1, 'exec')],
    [row(1, 'squash'), row(2, 'pick')],
    [row(1, 'drop'), row(2, 'fixup')],
    [row(1, 'pick', 'm\n')],
    [row(1, 'pick'), row(2, 'squash', 'm\n')],
    [row(1, 'edit', 'm\n')],
    [row(1, 'reword')],
    [row(1, 'pick'), row(2, 'squash')],
  ];
  for (const rows of cases) assert.throws(() => buildTodo(rows), badParams, JSON.stringify(rows.map((r) => r.action)));
});

test('messageText: summary + description joined; BAD_PARAMS for an empty or multi-line summary, NUL, a non-string, an unknown key, over the cap', () => {
  assert.equal(messageText({ summary: ' S ', description: 'body\n\n' }, 'r'), 'S\n\nbody\n');
  assert.equal(messageText({ summary: 'S' }, 'r'), 'S\n');
  const big = 'x'.repeat(REBASE_LIMITS.messageMaxBytes);
  for (const m of [{ summary: '  ' }, { summary: 'a\nb' }, { summary: 'a\rb' }, { summary: 'a', description: 'b\0' }, { summary: 1 }, { summary: 'a', extra: 1 }, { summary: 'a', description: big }, null, 'text']) {
    assert.throws(() => messageText(m, 'r'), badParams, JSON.stringify(m)?.slice(0, 40));
  }
});
