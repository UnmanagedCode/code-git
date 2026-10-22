import { useRef } from 'react';
import { createLayout, extendLayout } from './layout';
import type { LayoutInput, LayoutRow, LayoutState } from './types';

interface Cache { pins: string; inputs: LayoutInput[]; state: LayoutState; rows: LayoutRow[] }

const samePrefix = (prev: LayoutInput[], next: LayoutInput[]) =>
  prev.length <= next.length && prev.every((p, i) => p.id === next[i].id && p.dashed === next[i].dashed
    && p.parents.length === next[i].parents.length && p.parents.every((x, j) => x === next[i].parents[j]));

/**
 * The lane layout of `inputs`, kept incrementally: when the new inputs only append to the previous ones (another page
 * loaded) the layout is extended from where it stopped; anything else (a reload, WIP or a stash changing, pins) lays
 * out again from the top.
 */
export function useGraphLayout(inputs: LayoutInput[], pinnedTips: string[]): { rows: LayoutRow[]; width: number; state: LayoutState } {
  const cache = useRef<Cache | null>(null);
  const pins = pinnedTips.join(',');
  const c = cache.current;
  if (!c || c.inputs !== inputs) {
    if (c && c.pins === pins && samePrefix(c.inputs, inputs)) {
      const more = extendLayout(c.state, inputs.slice(c.inputs.length));
      cache.current = { pins, inputs, state: more.state, rows: [...c.rows, ...more.rows] };
    } else {
      const all = extendLayout(createLayout({ pinnedTips }), inputs);
      cache.current = { pins, inputs, state: all.state, rows: all.rows };
    }
  } else if (c.pins !== pins) {
    const all = extendLayout(createLayout({ pinnedTips }), inputs);
    cache.current = { pins, inputs, state: all.state, rows: all.rows };
  }
  return { rows: cache.current!.rows, width: cache.current!.state.width, state: cache.current!.state };
}
