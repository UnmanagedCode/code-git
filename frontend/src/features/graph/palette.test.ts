import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { LANE_COLOURS } from './layout';

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'graph.css'), 'utf8');

test('graph.css defines one lane class per LANE_COLOURS, each a hue rotation of var(--primary), with no literal colour', () => {
  const classes = [...css.matchAll(/\.lane-(\d+)\s*\{\s*--lane:\s*([^;]+);\s*\}/g)];
  expect(classes.map((m) => Number(m[1]))).toEqual(Array.from({ length: LANE_COLOURS }, (_, i) => i));
  for (const [, , value] of classes) expect(value).toMatch(/^oklch\(from var\(--primary\) l c calc\(h \+ \d+\)\)$/);
  expect(new Set(classes.map((m) => m[2])).size).toBe(LANE_COLOURS);
  const stripped = css.replace(/oklch\(from var\(--primary\)[^;]+;/g, '');
  expect(stripped).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|\b(white|black)\b/i);
});
