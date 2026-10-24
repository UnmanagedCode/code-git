import { expect, test, vi } from 'vitest';
import { getItem, setItem } from '@/lib/storage';
import { contextFor, DEFAULT_PREFS, parsePrefs, whitespaceFor, type DiffPrefs } from './diff';

const stored = (v: unknown) => JSON.stringify(v);

// Invariant: a stored value whose every key is valid comes back exactly as stored.
test('parsePrefs keeps a valid stored scope, layout and ignoreWhitespace and the other keys', () => {
  const p: DiffPrefs = { scope: 'full', layout: 'split', ignoreWhitespace: true, view: 'file', context: 10, wrap: true, syntax: false };
  expect(parsePrefs(stored(p))).toEqual(p);
});

// Invariant: the legacy `mode` and `whitespace` keys never decide a pref and never survive parsing.
test('parsePrefs drops legacy keys: mode and whitespace give Hunk+Inline with whitespace shown, and neither key remains', () => {
  const p = parsePrefs(stored({ mode: 'split', whitespace: 'all', wrap: true }));
  expect(p).toEqual({ ...DEFAULT_PREFS, wrap: true });
  expect(p).not.toHaveProperty('mode');
  expect(p).not.toHaveProperty('whitespace');
});

// Invariant: an ill-typed or out-of-range value falls back to its own default only; the other keys are kept.
test('parsePrefs falls back per key on an invalid scope, layout, ignoreWhitespace or context, and on unparsable JSON', () => {
  expect(parsePrefs(stored({ scope: 'inline', layout: 'split' }))).toEqual({ ...DEFAULT_PREFS, layout: 'split' });
  expect(parsePrefs(stored({ scope: 'full', layout: 'hunk' }))).toEqual({ ...DEFAULT_PREFS, scope: 'full' });
  expect(parsePrefs(stored({ ignoreWhitespace: 'true', syntax: false }))).toEqual({ ...DEFAULT_PREFS, syntax: false });
  expect(parsePrefs(stored({ ignoreWhitespace: 1 }))).toEqual(DEFAULT_PREFS);
  expect(parsePrefs(stored({ context: 7, view: 'tree', wrap: 'yes' }))).toEqual(DEFAULT_PREFS);
  for (const raw of [null, 'not json', 'null', '[]', '"x"', '3']) expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
});

// Invariant: with nothing stored, the viewer opens in Hunk scope, Inline layout, every whitespace change shown.
test('defaults are Hunk+Inline with whitespace shown', () => {
  expect(DEFAULT_PREFS).toMatchObject({ scope: 'hunk', layout: 'inline', ignoreWhitespace: false, view: 'diff' });
  expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
});

// Invariant: loading the module rewrites a stored value holding legacy keys to its normalized form, once.
test('module init rewrites a stored value containing mode / whitespace without them', async () => {
  setItem('diff-prefs', stored({ mode: 'split', whitespace: 'eol', scope: 'full', context: 5 }));
  vi.resetModules();
  const fresh = await import('./diff');
  const after = JSON.parse(getItem('diff-prefs')!) as Record<string, unknown>;
  expect(after).not.toHaveProperty('mode');
  expect(after).not.toHaveProperty('whitespace');
  expect(after).toEqual({ ...DEFAULT_PREFS, scope: 'full', context: 5 });
  expect(fresh.prefsStore.get()).toEqual(after);
});

// Invariant: scope alone decides the requested context (Hunk: the chosen N; Full: the whole file); layout never does;
// File view always asks for the whole file.
test('contextFor: hunk scope gives N in both layouts; full gives full in both; File view gives full', () => {
  for (const layout of ['inline', 'split'] as const) {
    expect(contextFor({ ...DEFAULT_PREFS, scope: 'hunk', layout, context: 10 })).toBe(10);
    expect(contextFor({ ...DEFAULT_PREFS, scope: 'full', layout, context: 10 })).toBe('full');
    expect(contextFor({ ...DEFAULT_PREFS, scope: 'hunk', layout, view: 'file' })).toBe('full');
  }
});

// Invariant: the Ignore whitespace toggle maps to the wire value `all` (git -w) when on and `none` when off.
test('whitespaceFor maps off to none and on to all', () => {
  expect(whitespaceFor({ ...DEFAULT_PREFS, ignoreWhitespace: false })).toBe('none');
  expect(whitespaceFor({ ...DEFAULT_PREFS, ignoreWhitespace: true })).toBe('all');
});
