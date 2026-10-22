import { expect, test } from 'vitest';
import { initials } from './initials';

test('initials: first and last word, one word alone, unicode letters, else the email, else ?', () => {
  expect(initials('Ann Marie Example')).toBe('AE');
  expect(initials('bob')).toBe('B');
  expect(initials('  émile zola ')).toBe('ÉZ');
  expect(initials('李小龙')).toBe('李');
  expect(initials('(bot) Deploy')).toBe('BD');
  expect(initials('', 'jane.doe@x.org')).toBe('JD');
  expect(initials('---', '')).toBe('?');
});
