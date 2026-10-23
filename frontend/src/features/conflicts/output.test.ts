import { expect, test } from 'vitest';
import { merge3 } from './diff3';
import { applyEdit, conflictsOf, hasMarkers, initialOutput, nextBlock, prevBlock, setPick, unresolved } from './output';

const L = (...xs: string[]) => xs.map((x) => `${x}\n`).join('');
const labels = { current: 'main', incoming: 'feature' };
const regions = merge3(L('a', 'b', 'c', 'd', 'e'), L('a', 'o1', 'o2', 'c', 'd', 'x'), L('a', 't1', 'c', 'd', 'y'))!;
const conflicts = conflictsOf(regions);

test('initialOutput: stable lines as they are, each conflict as git-style markers with the side labels', () => {
  const out = initialOutput(regions, labels);
  expect(out.text).toBe(L('a', '<<<<<<< main', 'o1', 'o2', '=======', 't1', '>>>>>>> feature', 'c', 'd', '<<<<<<< main', 'x', '=======', 'y', '>>>>>>> feature'));
  expect(out.blocks.map((b) => out.text.slice(b.start, b.end).split('\n')[0])).toEqual(['<<<<<<< main', '<<<<<<< main']);
  expect(unresolved(out.blocks)).toEqual([0, 1]);
  expect(hasMarkers(out.text)).toBe(true);
});

test('setPick: the picked ours lines then theirs, in file order; the blocks after shift; no pick restores the markers', () => {
  const out = initialOutput(regions, labels);
  const picked = setPick(out, conflicts, labels, 0, { ours: [1], theirs: [0] });
  expect(picked.text.startsWith(L('a', 'o2', 't1', 'c', 'd', '<<<<<<< main'))).toBe(true);
  expect(picked.blocks[0]).toMatchObject({ state: 'picked', picks: { ours: [1], theirs: [0] } });
  expect(picked.text.slice(picked.blocks[1].start, picked.blocks[1].end)).toBe(L('<<<<<<< main', 'x', '=======', 'y', '>>>>>>> feature'));
  const reordered = setPick(out, conflicts, labels, 0, { ours: [1, 0], theirs: [] });
  expect(reordered.text.startsWith(L('a', 'o1', 'o2', 'c'))).toBe(true);
  const back = setPick(picked, conflicts, labels, 0, { ours: [], theirs: [] });
  expect(back).toEqual(out);
});

test('applyEdit: a block before the edit stays, one after shifts, one the edit touches grows over it and becomes edited', () => {
  const out = initialOutput(regions, labels);
  const [b0, b1] = out.blocks;
  // Typing at the very start: both shift.
  const typed = 'Z' + out.text;
  expect(applyEdit(out.blocks, out.text, typed).map((b) => [b.start, b.end, b.state])).toEqual([[b0.start + 1, b0.end + 1, 'markers'], [b1.start + 1, b1.end + 1, 'markers']]);
  // Replacing the second block's "x" line: only it is edited, and it covers the change.
  const at = out.text.indexOf('x\n', b1.start);
  const edited = out.text.slice(0, at) + 'mine, longer\n' + out.text.slice(at + 2);
  const blocks = applyEdit(out.blocks, out.text, edited);
  expect(blocks[0]).toEqual(b0);
  expect(blocks[1]).toMatchObject({ start: b1.start, end: b1.end + 'mine, longer\n'.length - 2, state: 'edited' });
  // An edit spanning both blocks marks both edited; typing right after a block leaves it alone.
  const both = out.text.slice(0, b0.start + 1) + out.text.slice(b1.start + 3);
  expect(applyEdit(out.blocks, out.text, both).map((b) => b.state)).toEqual(['edited', 'edited']);
  const after = out.text.slice(0, b0.end) + 'q' + out.text.slice(b0.end);
  expect(applyEdit(out.blocks, out.text, after)[0]).toEqual(b0);
});

test('navigation: next / previous block, null at either end; unresolved lists the marker blocks', () => {
  const out = setPick(initialOutput(regions, labels), conflicts, labels, 1, { ours: [0], theirs: [] });
  expect([nextBlock(out.blocks, -1), nextBlock(out.blocks, 0), nextBlock(out.blocks, 1)]).toEqual([0, 1, null]);
  expect([prevBlock(out.blocks, 1), prevBlock(out.blocks, 0)]).toEqual([0, null]);
  expect(unresolved(out.blocks)).toEqual([0]);
});

const disjoint = (blocks: { start: number; end: number }[]) => blocks.every((b, i) => b.start >= 0 && b.start <= b.end && (i === 0 || blocks[i - 1].end <= b.start));

test('an edit spanning two blocks merges them into one edited range: the blocks stay disjoint and increasing, every start ≥ 0', () => {
  const out = initialOutput(regions, labels);
  const [b0, b1] = out.blocks;
  const text = out.text.slice(0, b0.start + 3) + 'JOINED' + out.text.slice(b1.start + 5);
  const blocks = applyEdit(out.blocks, out.text, text);
  expect(disjoint(blocks)).toBe(true);
  expect(blocks.map((b) => b.state)).toEqual(['edited', 'edited']);
  expect(blocks[0]).toMatchObject({ start: b0.start, end: b1.end - (out.text.length - text.length) });
  expect(blocks[1].start).toBe(blocks[1].end);
});

test('a pick on an edited block changes nothing (the text is the user\'s); after a spanning edit the blocks stay valid', () => {
  const out = initialOutput(regions, labels);
  const [b0, b1] = out.blocks;
  const text = out.text.slice(0, b0.start + 3) + 'JOINED' + out.text.slice(b1.start + 5);
  const edited = { text, blocks: applyEdit(out.blocks, out.text, text) };
  for (const i of [0, 1]) {
    const picked = setPick(edited, conflicts, labels, i, { ours: [0], theirs: [0] });
    expect(picked).toEqual(edited);
  }
  // A block the edit did not touch still takes picks, and the result stays disjoint.
  const one = out.text.slice(0, b0.start + 1) + 'Q' + out.text.slice(b0.start + 1);
  const partly = { text: one, blocks: applyEdit(out.blocks, out.text, one) };
  const picked = setPick(partly, conflicts, labels, 1, { ours: [0], theirs: [] });
  expect(picked.text.endsWith('d\nx\n')).toBe(true);
  expect(disjoint(picked.blocks)).toBe(true);
});
