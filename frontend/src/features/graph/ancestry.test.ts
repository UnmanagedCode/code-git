import { expect, test } from 'vitest';
import { ancestorsWithin } from './ancestry';

test('ancestors within the loaded commits: through merges, stopping at unloaded parents; an unloaded tip reaches nothing', () => {
  const parents = new Map([['d', ['c', 'x']], ['c', ['b']], ['x', ['a']], ['b', ['a']], ['a', []], ['side', ['b']], ['z', ['unloaded']]]);
  expect([...ancestorsWithin('d', parents)].sort()).toEqual(['a', 'b', 'c', 'd', 'x']);
  expect([...ancestorsWithin('side', parents)].sort()).toEqual(['a', 'b', 'side']);
  expect([...ancestorsWithin('z', parents)]).toEqual(['z']);
  expect(ancestorsWithin('nope', parents).size).toBe(0);
  const grown = new Map(parents).set('e', ['d']);
  expect(ancestorsWithin('d', grown).size).toBe(5);
  expect(ancestorsWithin('e', grown).has('e')).toBe(true);
});
