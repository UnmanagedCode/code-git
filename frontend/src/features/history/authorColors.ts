import { LANE_COLOURS } from '@/features/graph/layout';

// Blame's author colours: the graph's lane palette (graph.css: hue turns of the theme's primary, no literal colour),
// assigned by first appearance in the blamed lines, so the same lines always colour the same way.

/** author → `lane-<i>` class, in first-appearance order, cycling through the palette. */
export function authorClasses(authors: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of authors) if (!out.has(a)) out.set(a, `lane-${out.size % LANE_COLOURS}`);
  return out;
}
