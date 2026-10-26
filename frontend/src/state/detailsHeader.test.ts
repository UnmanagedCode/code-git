import { expect, test } from 'vitest';
import { getItem } from '@/lib/storage';
import { clampHeader, DETAILS_HEADER, detailsHeaderStore, parseHeaderHeight, setDetailsHeader } from './detailsHeader';

const { min: MIN, filesMin: FILES_MIN, handle: HANDLE } = DETAILS_HEADER;

// Invariant: a stored height never yields invalid geometry: only a finite number at or above MIN is taken.
test('parseHeaderHeight takes a stored height at or above MIN; nothing stored, garbage, non-finite or below MIN give the default', () => {
  expect(parseHeaderHeight('300')).toBe(300);
  expect(parseHeaderHeight(String(MIN))).toBe(MIN);
  for (const raw of [null, '', 'tall', 'NaN', 'Infinity', '-Infinity', String(MIN - 1), '-5', '{}']) {
    expect(parseHeaderHeight(raw)).toBe(DETAILS_HEADER.default);
  }
});

// Invariant: the header never drops below MIN, and the files keep FILES_MIN whenever the panel has room for both.
test('clampHeader keeps an in-range height, raises one below MIN, caps one that would crush the files, and gives MIN on a tiny panel', () => {
  const available = 600;
  const max = available - HANDLE - FILES_MIN;
  expect(clampHeader(300, available)).toBe(300);
  expect(clampHeader(MIN - 40, available)).toBe(MIN);
  expect(clampHeader(max + 100, available)).toBe(max);
  expect(clampHeader(max, available)).toBe(max);
  expect(clampHeader(300, MIN + HANDLE + FILES_MIN - 50)).toBe(MIN);
});

// Invariant: an unmeasured panel (no layout yet: height 0) caps nothing but MIN.
test('clampHeader on an unmeasured panel applies only MIN', () => {
  expect(clampHeader(5000, 0)).toBe(5000);
  expect(clampHeader(10, 0)).toBe(MIN);
});

// Invariant: the chosen height is persisted under the code-git: prefix and is what a reload reads back.
test('setDetailsHeader persists the height as code-git:graph:detailsHeader', () => {
  setDetailsHeader(272);
  expect(detailsHeaderStore.get()).toBe(272);
  expect(getItem('graph:detailsHeader')).toBe('272');
  expect(parseHeaderHeight(getItem('graph:detailsHeader'))).toBe(272);
});
