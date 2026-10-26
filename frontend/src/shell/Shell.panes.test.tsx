import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { getItem } from '@/lib/storage';
import { PANE, parsePaneWidths, setPaneWidth } from '@/state/paneWidths';
import { dispatchTabs } from '@/state/tabs';
import { installFakeEventSource } from '@/test/fakeEventSource';
import { linearWorld, stubGraph } from '@/test/graphBackend';
import { Shell } from './Shell';

const SPACE = PANE.centerMin + 2 * PANE.handle;

// happy-dom has no layout: <main>'s width is defined on the element, and a fake ResizeObserver reports it.
function fakeResize() {
  const live = new Set<() => void>();
  vi.stubGlobal('ResizeObserver', class {
    fire: () => void;
    constructor(cb: ResizeObserverCallback) { this.fire = () => cb([], this as unknown as ResizeObserver); }
    observe() { live.add(this.fire); }
    unobserve() {}
    disconnect() { live.delete(this.fire); }
  });
  return (w: number) => {
    Object.defineProperty(document.querySelector('main')!, 'clientWidth', { configurable: true, value: w });
    act(() => { for (const f of live) f(); });
  };
}

async function mount() {
  installFakeEventSource();
  const resize = fakeResize();
  const fetch = stubGraph(linearWorld(3));
  render(<Shell />);
  act(() => dispatchTabs({ type: 'open', tab: { project: 'app', worktree: null } }));
  await screen.findByRole('region', { name: 'Commit graph' });
  return { resize, fetch };
}
const handle = (side: 'left' | 'right') => screen.getByRole('separator', { name: `Resize ${side} pane` });
const now = (side: 'left' | 'right') => Number(handle(side).getAttribute('aria-valuenow'));
const cssVar = (side: 'left' | 'right') => document.querySelector('main')!.style.getPropertyValue(`--pane-${side}`);
const stored = () => parsePaneWidths(getItem('shell:paneWidths'));

test('the Shell mounts one handle per side pane at the default widths, which reach the slots through custom properties', async () => {
  await mount();
  expect([now('left'), now('right')]).toEqual([PANE.left.default, PANE.right.default]);
  expect([cssVar('left'), cssVar('right')]).toEqual([`${PANE.left.default}px`, `${PANE.right.default}px`]);
});

test('arrow and Home keys on a handle reach the store and the rendered width', async () => {
  await mount();
  fireEvent.keyDown(handle('left'), { key: 'ArrowRight' });
  expect([now('left'), cssVar('left'), stored().left]).toEqual([PANE.left.default + PANE.step, `${PANE.left.default + PANE.step}px`, PANE.left.default + PANE.step]);
  fireEvent.keyDown(handle('right'), { key: 'ArrowLeft' });
  expect([now('right'), cssVar('right'), stored().right]).toEqual([PANE.right.default + PANE.step, `${PANE.right.default + PANE.step}px`, PANE.right.default + PANE.step]);
  fireEvent.keyDown(handle('right'), { key: 'Home' });
  expect([now('right'), stored().right]).toEqual([PANE.right.min, PANE.right.min]);
});

test('a narrower window renders fitted widths (left first) without overwriting the choice; a wider one brings the choice back', async () => {
  setPaneWidth('left', PANE.left.max);
  setPaneWidth('right', PANE.right.max);
  const { resize } = await mount();
  resize(1100);
  expect([now('left'), now('right')]).toEqual([PANE.left.min, 1100 - SPACE - PANE.left.min]);
  expect([cssVar('left'), cssVar('right')]).toEqual([`${PANE.left.min}px`, `${1100 - SPACE - PANE.left.min}px`]);
  expect(stored()).toEqual({ left: PANE.left.max, right: PANE.right.max });
  resize(1600);
  expect([now('left'), now('right')]).toEqual([PANE.left.max, PANE.right.max]);
});

test('on a fitted pane, a key that cannot move it stores nothing; one that does stores it and the other pane re-fits, keeping its choice', async () => {
  setPaneWidth('left', PANE.left.max);
  setPaneWidth('right', PANE.right.max);
  const { resize } = await mount();
  resize(1100);
  const fitted = 1100 - SPACE - PANE.left.min;
  expect(Number(handle('right').getAttribute('aria-valuemax'))).toBe(fitted);
  fireEvent.keyDown(handle('right'), { key: 'End' });
  fireEvent.keyDown(handle('right'), { key: 'ArrowLeft' });
  expect(stored().right).toBe(PANE.right.max);
  fireEvent.keyDown(handle('right'), { key: 'Home' });
  expect([stored(), now('right'), now('left')]).toEqual([{ left: PANE.left.max, right: PANE.right.min }, PANE.right.min, 1100 - SPACE - PANE.right.min]);
});

test('a drag on a pane\'s handle previews the width on <main> and stores it once on release', async () => {
  const { resize } = await mount();
  resize(1600);
  const h = handle('right');
  fireEvent.pointerDown(h, { clientX: 1000, button: 0, pointerId: 1 });
  fireEvent.pointerMove(h, { clientX: 900, pointerId: 1 });
  expect([cssVar('right'), now('right'), stored().right]).toEqual([`${PANE.right.default + 100}px`, PANE.right.default + 100, PANE.right.default]);
  fireEvent.pointerUp(h, { clientX: 900, pointerId: 1 });
  expect(stored().right).toBe(PANE.right.default + 100);
});
