import { expect, test } from 'vitest';
import { setCssPx } from './cssVars';

test('setCssPx sets a px custom property and refuses a non-finite number or a bad name', () => {
  const el = document.createElement('div');
  setCssPx(el, '--graph-total', 1234.5);
  expect(el.style.getPropertyValue('--graph-total')).toBe('1234.5px');
  for (const px of [NaN, Infinity, -Infinity]) expect(() => setCssPx(el, '--x', px)).toThrow(/finite/);
  for (const name of ['color', '--', '--X', '--a;b', '--a b', 'background: red', '--a)']) expect(() => setCssPx(el, name, 1)).toThrow(/name/);
  expect(el.getAttribute('style')).toBe('--graph-total: 1234.5px;');
});
