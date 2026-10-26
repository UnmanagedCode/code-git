import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getPrefs, updatePrefs, useGraphPrefs } from '@/state/graphPrefs';
import { COLUMN_RESIZE_STEP, COLUMNS, type ColumnId } from './columns';
import { GraphHeader } from './GraphHeader';

const KEY = 't';
const GRAPH_WIDTH = 133;
let rootEl: HTMLElement;

function Header() {
  const prefs = useGraphPrefs(KEY);
  return <GraphHeader prefsKey={KEY} prefs={prefs} root={() => rootEl} graphWidth={GRAPH_WIDTH} />;
}
beforeEach(() => {
  rootEl = document.createElement('div');
  document.body.append(rootEl);
  updatePrefs(KEY, (p) => ({ ...p, columns: { ...p.columns, visible: ['author', 'date'], widths: { author: 200 } } }));
  render(<Header />);
});
afterEach(() => { rootEl.remove(); vi.restoreAllMocks(); });

const handle = (id: ColumnId) => screen.getByRole('separator', { name: `Resize ${COLUMNS[id].label}` });
const cell = (id: ColumnId) => screen.getByRole('button', { name: COLUMNS[id].label });
const wrapper = (id: ColumnId) => document.querySelector<HTMLElement>(`[data-header-col=${id}]`)!;
const stored = (id: ColumnId) => getPrefs(KEY).columns.widths[id];
const order = () => getPrefs(KEY).columns.order;
const down = (el: HTMLElement, x: number) => fireEvent.pointerDown(el, { clientX: x, button: 0, pointerId: 1 });

test('each resizable column has a focusable vertical separator exposing its rendered width and the column\'s bounds; Commit message has none', () => {
  expect(screen.queryByRole('separator', { name: 'Resize Commit message' })).toBeNull();
  const expected: Partial<Record<ColumnId, number>> = { author: 200, date: COLUMNS.date.width, graph: GRAPH_WIDTH };
  for (const [id, now] of Object.entries(expected) as [ColumnId, number][]) {
    const h = handle(id);
    expect(h.tabIndex).toBe(0);
    expect(h.getAttribute('aria-orientation')).toBe('vertical');
    expect(h.getAttribute('aria-valuenow')).toBe(String(now));
    expect(h.getAttribute('aria-valuemin')).toBe(String(COLUMNS[id].min));
    expect(h.getAttribute('aria-valuemax')).toBe(String(COLUMNS[id].max));
  }
});

test('a handle drag captures the pointer, previews --col-<id> on root, and stores the width once on release', () => {
  const h = handle('author');
  const capture = vi.spyOn(h, 'setPointerCapture');
  down(h, 100);
  expect(capture).toHaveBeenCalledWith(1);
  fireEvent.pointerMove(h, { clientX: 130, pointerId: 1 });
  expect(rootEl.style.getPropertyValue('--col-author')).toBe('230px');
  expect(stored('author')).toBe(200);
  fireEvent.pointerUp(h, { clientX: 130, pointerId: 1 });
  expect(stored('author')).toBe(230);
});

test.each(['pointerCancel', 'lostPointerCapture'] as const)(
  'a drag ended by %s restores the pre-drag width, stores nothing, and leaves no window listener: later window moves and releases change nothing',
  (ending) => {
    const h = handle('author');
    rootEl.style.setProperty('--col-author', '200px');
    const add = vi.spyOn(window, 'addEventListener');
    down(h, 100);
    fireEvent.pointerMove(h, { clientX: 140, pointerId: 1 });
    expect(rootEl.style.getPropertyValue('--col-author')).toBe('240px');
    fireEvent[ending](h, { pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(h, { clientX: 300, pointerId: 1 });
    expect(add.mock.calls.filter(([type]) => type === 'pointermove' || type === 'pointerup')).toEqual([]);
    expect(rootEl.style.getPropertyValue('--col-author')).toBe('200px');
    expect(stored('author')).toBe(200);
  },
);

test("a drag on a handle neither reorders columns nor opens the column's menu", () => {
  const before = [...order()];
  const h = handle('refs');
  down(h, 100);
  fireEvent.pointerMove(h, { clientX: 120, pointerId: 1 });
  fireEvent.pointerUp(wrapper('graph'), { clientX: 400, pointerId: 1 });
  expect(order()).toEqual(before);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('keys on a focused handle: ←/→ store width ∓/± COLUMN_RESIZE_STEP, Home/End store min/max; a key at a bound stores nothing', () => {
  const h = handle('author');
  fireEvent.keyDown(h, { key: 'ArrowRight' });
  expect(stored('author')).toBe(200 + COLUMN_RESIZE_STEP);
  fireEvent.keyDown(h, { key: 'ArrowLeft' });
  fireEvent.keyDown(h, { key: 'ArrowLeft' });
  expect(stored('author')).toBe(200 - COLUMN_RESIZE_STEP);
  fireEvent.keyDown(h, { key: 'End' });
  expect(stored('author')).toBe(COLUMNS.author.max);
  fireEvent.keyDown(h, { key: 'Home' });
  expect(stored('author')).toBe(COLUMNS.author.min);
  // At the minimum: nothing more is stored (the prefs object is untouched).
  const prefs = getPrefs(KEY);
  fireEvent.keyDown(h, { key: 'Home' });
  fireEvent.keyDown(h, { key: 'ArrowLeft' });
  expect(getPrefs(KEY)).toBe(prefs);
});

test('menu keys on a handle open no menu; the same keys on the header cell still do', () => {
  const h = handle('author');
  for (const init of [{ key: 'Enter' }, { key: ' ' }, { key: 'ArrowDown' }, { key: 'F10', shiftKey: true }]) fireEvent.keyDown(h, init);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.keyDown(cell('author'), { key: 'F10', shiftKey: true });
  expect(screen.getByRole('menu')).toBeTruthy();
  // Enter on the cell (Radix's own open key) is left to the Playwright harness: Radix reads real key events.
});

test('dragging a header cell still reorders the columns', () => {
  const from = order().indexOf('graph');
  down(cell('graph'), 100);
  fireEvent.pointerMove(window, { clientX: 110, pointerId: 1 });
  fireEvent.pointerUp(wrapper('message'), { clientX: 300, pointerId: 1 });
  expect(order().indexOf('graph')).toBe(from + 1);
});

test('Tab order: each header cell, then its resize handle', async () => {
  const user = userEvent.setup();
  const seen: (string | null)[] = [];
  for (let i = 0; i < 8; i++) {
    await act(() => user.tab());
    const el = document.activeElement!;
    seen.push(el.getAttribute('aria-label') ?? el.textContent);
  }
  expect(seen).toEqual([
    'Branch / Tag', 'Resize Branch / Tag', 'Graph', 'Resize Graph', 'Commit message', 'Author', 'Resize Author', 'Date',
  ]);
});
