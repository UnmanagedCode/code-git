import { expect, test } from 'vitest';
import { fdiff, hunk } from '@/test/diffFixtures';
import { extendRange, hunkRequest, lineKey, previewLines, toggle, toRequest } from './selection';

const FD = fdiff([hunk(1, 1, [' a', '-b', '+B', ' c']), hunk(10, 10, ['-x', '-y', '+Y', ' z'], 'fn()')]);

test('toggle adds a missing key and removes a present one, without touching the input', () => {
  const a = new Set(['0:1']);
  expect([...toggle(a, '0:2')]).toEqual(['0:1', '0:2']);
  expect([...toggle(a, '0:1')]).toEqual([]);
  expect([...a]).toEqual(['0:1']);
});

test('extendRange: the add/del lines between two keys, either order, across hunks, context skipped', () => {
  expect(extendRange(FD, lineKey(0, 2), lineKey(1, 1))).toEqual(['0:2', '1:0', '1:1']);
  expect(extendRange(FD, lineKey(1, 1), lineKey(0, 1))).toEqual(['0:1', '0:2', '1:0', '1:1']);
  expect(extendRange(FD, lineKey(0, 0), lineKey(0, 3))).toEqual(['0:1', '0:2']);
});

test('toRequest: per hunk in order, its header and selected lines in order with exact texts; context and stray keys dropped', () => {
  expect(toRequest(FD, ['1:2', '0:2', '1:0', '0:0', '7:1', '0:9'])).toEqual([
    { header: '@@ -1,3 +1,3 @@', lines: [{ index: 2, text: 'B' }] },
    { header: '@@ -10,3 +10,2 @@ fn()', lines: [{ index: 0, text: 'x' }, { index: 2, text: 'Y' }] },
  ]);
  expect(toRequest(FD, [])).toEqual([]);
});

test('hunkRequest is every add/del line of the hunk; previewLines marks them −/+', () => {
  const req = hunkRequest(FD, 1);
  expect(req).toEqual([{ header: '@@ -10,3 +10,2 @@ fn()', lines: [{ index: 0, text: 'x' }, { index: 1, text: 'y' }, { index: 2, text: 'Y' }] }]);
  expect(previewLines(FD, req)).toEqual(['-x', '-y', '+Y']);
});
