import { expect, test } from 'vitest';
import { COLUMNS } from './columns';
import { LANE_CAP } from './layout';
import { lanesWidth, laneX } from './LaneSvg';

test('the overflow gutter and its node fit the graph column at its widest', () => {
  const nodeR = 9;
  expect(laneX(LANE_CAP)).toBe(laneX(LANE_CAP + 500));
  expect(laneX(LANE_CAP) + nodeR).toBeLessThanOrEqual(COLUMNS.graph.max);
  expect(lanesWidth(LANE_CAP + 1)).toBeLessThanOrEqual(COLUMNS.graph.max);
  expect(lanesWidth(10_000)).toBe(lanesWidth(LANE_CAP + 1));
});
