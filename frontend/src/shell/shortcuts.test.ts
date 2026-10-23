import { expect, test } from 'vitest';
import { comboLabel, matchCombo, matches, pointerMods, SHORTCUT_GROUPS, shortcutLabel, type Combo, type Shortcut } from './shortcuts';

const press = (key: string, m: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  ({ key, ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift, altKey: !!m.alt });
const s = (...combos: Combo[]): Shortcut => ({ id: 't', label: 't', scope: 't', combos });

// Invariant: a combo matches its key with exactly its modifiers; mod is Ctrl or ⌘; 'any' accepts either; letters fold case unless exact.
test('matches: modifiers exact by default, mod = Ctrl or Meta, any, case folding and exact keys', () => {
  const b = s({ key: 'b', mod: true });
  expect(matches(press('b', { ctrl: true }), b)).toBe(true);
  expect(matches(press('B', { meta: true }), b)).toBe(true);
  expect(matches(press('b'), b)).toBe(false);
  expect(matches(press('b', { ctrl: true, shift: true }), b)).toBe(false);
  expect(matches(press('b', { ctrl: true, alt: true }), b)).toBe(false);
  const esc = s({ key: 'Escape', mod: 'any', shift: 'any', alt: 'any' });
  expect(matches(press('Escape', { ctrl: true, shift: true, alt: true }), esc)).toBe(true);
  expect(matches(press('escape'), esc)).toBe(false);
  const lane = s({ key: 'J', exact: true, shift: 'any' });
  expect(matches(press('J', { shift: true }), lane)).toBe(true);
  expect(matches(press('j'), lane)).toBe(false);
  const two = s({ key: 'ArrowUp' }, { key: 'ArrowDown' });
  expect(matchCombo(press('ArrowDown'), two)).toBe(two.combos[1]);
  expect(matchCombo(press('x'), two)).toBe(null);
});

// Invariant: labels name the held modifiers and the key; 'any' modifiers are not shown.
test('comboLabel and shortcutLabel', () => {
  expect(comboLabel({ key: 's', mod: true, shift: true })).toBe('Ctrl/⌘+Shift+S');
  expect(comboLabel({ key: 'ArrowDown', alt: true })).toBe('Alt+↓');
  expect(comboLabel({ key: 'Escape', mod: 'any' })).toBe('Esc');
  expect(comboLabel({ key: 'J', exact: true, shift: 'any' })).toBe('Shift+J');
  expect(shortcutLabel(s({ key: 'f', mod: true }, { key: '/' }))).toBe('Ctrl/⌘+F or /');
  expect(shortcutLabel(s(...['1', '2', '3', '4'].map((key) => ({ key, mod: true }))))).toBe('Ctrl/⌘+1…4');
  expect(shortcutLabel(s({ key: '1', mod: true }, { key: '3', mod: true }, { key: '4', mod: true }))).toBe('Ctrl/⌘+1 or Ctrl/⌘+3 or Ctrl/⌘+4');
});

// Invariant: pointerMods reports Shift, Ctrl-or-⌘ and Alt of a click.
test('pointerMods', () => {
  expect(pointerMods(press('', { meta: true }))).toEqual({ shift: false, mod: true, alt: false });
  expect(pointerMods(press('', { shift: true, alt: true }))).toEqual({ shift: true, mod: false, alt: true });
});

const all = SHORTCUT_GROUPS.flatMap((g) => g.shortcuts);

// Invariant: shortcut ids are unique across the catalog, and every group holds its own scope only.
test('the catalog: unique ids, grouped by scope', () => {
  expect(all.length).toBeGreaterThan(10);
  expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
  for (const g of SHORTCUT_GROUPS) for (const x of g.shortcuts) expect(x.scope).toBe(g.scope);
  expect(new Set(SHORTCUT_GROUPS.map((g) => g.scope)).size).toBe(SHORTCUT_GROUPS.length);
});

/** Every concrete key press a combo stands for ('any' expanded both ways). */
function presses(c: Combo) {
  const ways = (m: Combo['mod']) => (m === 'any' ? [false, true] : [m ?? false]);
  const keys = c.key.length === 1 && !c.exact ? [c.key.toLowerCase(), c.key.toUpperCase()] : [c.key];
  return keys.flatMap((key) => ways(c.mod).flatMap((ctrl) => ways(c.shift).flatMap((shift) => ways(c.alt).map((alt) => press(key, { ctrl, shift, alt })))));
}

// Invariant: within one scope no key press triggers two shortcuts — except pairs that act in different elements of it
// (a search box's Enter/Esc beside the graph's own).
test('no colliding combos within a scope', () => {
  const ELEMENT = new Set(['graph.searchNext', 'graph.searchClose', 'graph.dragCancel', 'graph.columnMenu', 'diff.searchNext', 'diff.searchClose', 'diff.fileMove', 'workdir.open', 'workdir.move', 'workdir.stageFile', 'workdir.unstageFile']);
  for (const g of SHORTCUT_GROUPS) {
    const own = g.shortcuts.filter((x) => !ELEMENT.has(x.id));
    for (const a of own) for (const c of a.combos) for (const p of presses(c)) {
      const hits = own.filter((b) => matches(p, b)).map((b) => b.id);
      expect(hits, `${g.scope}: ${JSON.stringify(p)}`).toEqual([a.id]);
    }
  }
});
