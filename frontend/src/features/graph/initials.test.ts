import { expect, test } from 'vitest';
import { initials, INITIALS_SCAN } from './initials';

test('initials: first and last word, one word alone, unicode letters, else the email, else ?', () => {
  expect(initials('Ann Marie Example')).toBe('AE');
  expect(initials('bob')).toBe('B');
  expect(initials('  émile zola ')).toBe('ÉZ');
  expect(initials('李小龙')).toBe('李');
  expect(initials('(bot) Deploy')).toBe('BD');
  expect(initials('', 'jane.doe@x.org')).toBe('JD');
  expect(initials('---', '')).toBe('?');
});

test('initials read only the first INITIALS_SCAN characters of a name and an email', () => {
  const name = `Ann ${'x '.repeat(3_000_000)}Zed`;
  expect(initials(name)).toBe('AX');
  expect(initials(`${' '.repeat(INITIALS_SCAN)}Late Name`, 'bob@x.org')).toBe('B');
  expect(initials('', `${'-'.repeat(INITIALS_SCAN)}carol@x.org`)).toBe('?');
});
