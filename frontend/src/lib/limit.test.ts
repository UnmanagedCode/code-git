import { expect, test } from 'vitest';
import { mapLimit } from './limit';

test('mapLimit keeps at most `limit` calls in flight and returns results in input order', async () => {
  let inFlight = 0;
  let peak = 0;
  const gates: (() => void)[] = [];
  const p = mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((r) => gates.push(r));
    inFlight--;
    return n * 10;
  });
  while (gates.length || inFlight) {
    await Promise.resolve();
    gates.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  }
  expect(await p).toEqual([10, 20, 30, 40, 50, 60]);
  expect(peak).toBe(2);
  expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  await expect(mapLimit([1], 0, async () => 1)).rejects.toThrow(/limit/);
  await expect(mapLimit([1, 2], 2, async (n) => { if (n === 2) throw new Error('boom'); return n; })).rejects.toThrow('boom');
});
