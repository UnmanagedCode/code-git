import { describe, expect, test } from 'vitest';
import { createLayout, extendLayout, LANE_COLOURS, layoutAll } from './layout';
import type { LayoutInput, LayoutRow } from './types';

const c = (id: string, ...parents: string[]): LayoutInput => ({ id, parents, dashed: false });

/** A seeded random DAG in topo order (children first): `n` commits, some merges, several tips and roots. */
function randomDag(seed: number, n: number): LayoutInput[] {
  let a = seed;
  const rand = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  // Build parents-first, then reverse: commit i may only have parents < i.
  const nodes: LayoutInput[] = [];
  for (let i = 0; i < n; i++) {
    const parents: string[] = [];
    if (i > 0 && rand() > 0.05) parents.push(`n${Math.max(0, i - 1 - Math.floor(rand() * 6))}`);
    if (i > 2 && rand() < 0.15) parents.push(`n${Math.floor(rand() * (i - 1))}`);
    if (i > 3 && rand() < 0.03) parents.push(`n${Math.floor(rand() * (i - 1))}`);
    nodes.push(c(`n${i}`, ...new Set(parents)));
  }
  return nodes.reverse();
}

/** Follows each edge a node starts down its lane; returns the row index each one ends in. */
function trace(rows: LayoutRow[], from: number): number[] {
  const landed: number[] = [];
  for (const e of rows[from].bottom.filter((b) => b.from === rows[from].col)) {
    let lane = e.to;
    for (let r = from + 1; r < rows.length; r++) {
      const t = rows[r].top.find((x) => x.from === lane);
      if (!t) throw new Error(`row ${r}: no top edge continues lane ${lane}`);
      // A lane either passes through (to === from) or ends in this row's node.
      if (t.to === rows[r].col) {
        landed.push(r);
        break;
      }
      expect(t.to).toBe(lane);
    }
  }
  return landed;
}

describe('lane layout', () => {
  test('streaming: extending page by page deep-equals one layout of everything', () => {
    for (const seed of [1, 7, 42, 99]) {
      const inputs = randomDag(seed, 300);
      const whole = layoutAll(inputs);
      let state = createLayout();
      const rows: LayoutRow[] = [];
      for (let i = 0; i < inputs.length; i += 37) {
        const r = extendLayout(state, inputs.slice(i, i + 37));
        state = r.state;
        rows.push(...r.rows);
      }
      expect(rows).toEqual(whole.rows);
      expect(state).toEqual(whole.state);
    }
  });

  test("continuity: each row's bottom lanes are exactly the next row's top lanes", () => {
    const { rows } = layoutAll(randomDag(5, 400));
    for (let r = 0; r + 1 < rows.length; r++) {
      const below = [...new Set(rows[r].bottom.map((e) => e.to))].sort((x, y) => x - y);
      const above = rows[r + 1].top.map((e) => e.from).sort((x, y) => x - y);
      expect(above, `row ${r}`).toEqual(below);
    }
    expect(rows[0].top).toEqual([]);
  });

  test('every edge into a node ends at its column, and every edge a node starts lands on one of its parents', () => {
    const inputs = randomDag(11, 300);
    const { rows } = layoutAll(inputs);
    const index = new Map(inputs.map((x, i) => [x.id, i]));
    rows.forEach((row, r) => {
      for (const e of row.top) expect(e.to === row.col || e.to === e.from, `row ${r}`).toBe(true);
      const parents = inputs[r].parents.map((p) => index.get(p)!);
      const landed = trace(rows, r);
      expect(new Set(landed)).toEqual(new Set(parents));
    });
  });

  test('a linear history stays in one lane with one colour', () => {
    const { rows, state } = layoutAll([c('d', 'c'), c('c', 'b'), c('b', 'a'), c('a')]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0, 0]);
    expect(new Set(rows.map((r) => r.color)).size).toBe(1);
    expect(state.width).toBe(1);
    expect(rows[3].bottom).toEqual([]);
  });

  test('N unmerged branches off one base use N lanes; a lane freed by a root is reused by the next tip', () => {
    const { rows, state } = layoutAll([c('t1', 'base'), c('t2', 'base'), c('t3', 'base'), c('base')]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 2, 0]);
    expect(state.width).toBe(3);
    expect(rows[3].top.map((e) => [e.from, e.to])).toEqual([[0, 0], [1, 0], [2, 0]]);
    const two = layoutAll([c('a1', 'a0'), c('b1', 'b0'), c('a0'), c('c1', 'c0'), c('b0'), c('c0')]).rows;
    expect(two.map((r) => r.col)).toEqual([0, 1, 0, 0, 1, 0]);
  });

  test('a merge opens a lane for its second parent; an octopus one per extra parent; a lane already waiting is reused', () => {
    const merge = layoutAll([c('m', 'a', 'b'), c('b', 'base'), c('a', 'base'), c('base')]).rows;
    expect(merge[0].bottom.map((e) => [e.from, e.to])).toEqual([[0, 0], [0, 1]]);
    expect(merge.map((r) => r.col)).toEqual([0, 1, 0, 0]);
    const octo = layoutAll([c('o', 'a', 'b', 'c'), c('c'), c('b'), c('a')]).rows;
    expect(octo[0].bottom.map((e) => [e.from, e.to])).toEqual([[0, 0], [0, 1], [0, 2]]);
    const reuse = layoutAll([c('x', 'base'), c('m', 'a', 'base'), c('a', 'base'), c('base')]).rows;
    // m's second parent `base` is already awaited by x's lane 0: m (lane 1) joins it, and lane 0 passes through.
    expect(reuse[1].col).toBe(1);
    expect(reuse[1].bottom.map((e) => [e.from, e.to]).sort()).toEqual([[0, 0], [1, 0], [1, 1]]);
  });

  test('the first parent keeps the lane colour; a newly opened lane takes the next colour, wrapping at LANE_COLOURS', () => {
    const { rows } = layoutAll([c('m', 'a', 'b'), c('b', 'a'), c('a')]);
    expect(rows[0].color).toBe(rows[2].color);
    expect(rows[1].color).not.toBe(rows[0].color);
    const tips = Array.from({ length: LANE_COLOURS + 2 }, (_, i) => c(`t${i}`));
    const colours = layoutAll(tips).rows.map((r) => r.color);
    expect(colours).toEqual(Array.from({ length: LANE_COLOURS + 2 }, (_, i) => i % LANE_COLOURS));
  });

  test('a pinned tip takes its reserved lane even when it arrives in a later page, and its first-parent chain stays there', () => {
    const page1 = [c('m2', 'm1'), c('m1', 'm0')];
    const page2 = [c('f1', 'f0'), c('f0', 'm0'), c('m0')];
    const first = extendLayout(createLayout({ pinnedTips: ['f1'] }), page1);
    expect(first.rows.map((r) => r.col)).toEqual([1, 1]);
    expect(first.rows.every((r) => r.top.every((e) => e.from !== 0) && r.bottom.every((e) => e.to !== 0))).toBe(true);
    const second = extendLayout(first.state, page2);
    expect(second.rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(layoutAll([...page1, ...page2], { pinnedTips: ['f1'] }).rows).toEqual([...first.rows, ...second.rows]);
    expect(layoutAll([...page1, ...page2], { pinnedTips: ['nope', 'f1'] }).rows.map((r) => r.col)).toEqual([2, 2, 1, 1, 1]);
  });

  test('a WIP row joins its HEAD with a dashed edge in the same column; the commit below continues solid', () => {
    const { rows } = layoutAll([{ id: 'wip:', parents: ['h'], dashed: true }, c('h', 'p'), c('p')]);
    expect(rows[0].bottom).toEqual([{ from: 0, to: 0, color: rows[0].color, dashed: true }]);
    expect(rows[1].col).toBe(0);
    expect(rows[1].top).toEqual([{ from: 0, to: 0, color: rows[0].color, dashed: true }]);
    expect(rows[1].bottom.every((e) => !e.dashed)).toBe(true);
  });

  test('extendLayout never mutates the state it is given', () => {
    const inputs = randomDag(3, 50);
    const { state } = layoutAll(inputs.slice(0, 25), { pinnedTips: [inputs[30].id] });
    const before = structuredClone(state);
    extendLayout(state, inputs.slice(25));
    expect(state).toEqual(before);
  });
});
