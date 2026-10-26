import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { PANE_WIDTH_BOUND_KEY, PANE_WIDTH_STEP_KEY } from './keys';
import { Splitter } from './Splitter';

const MIN = 100, MAX = 300, VALUE = 200, STEP = 16;
function setup(over: { sign?: 1 | -1; value?: number } = {}) {
  const preview = vi.fn(), commit = vi.fn();
  const { unmount } = render(
    <Splitter orientation="vertical" label="Resize it" value={over.value ?? VALUE} min={MIN} max={MAX} clamp={(px) => Math.max(MIN, Math.min(MAX, px))} step={STEP}
      sign={over.sign ?? 1} stepKey={PANE_WIDTH_STEP_KEY} boundKey={PANE_WIDTH_BOUND_KEY} preview={preview} commit={commit} />,
  );
  return { preview, commit, unmount, h: screen.getByRole('separator', { name: 'Resize it' }) };
}
const down = (h: HTMLElement, x: number, extra: object = {}) => fireEvent.pointerDown(h, { clientX: x, button: 0, pointerId: 1, ...extra });

test('the handle is an accessible separator exposing its orientation, value and bounds', () => {
  const { h } = setup();
  expect([h.getAttribute('aria-orientation'), h.getAttribute('aria-valuenow'), h.getAttribute('aria-valuemin'), h.getAttribute('aria-valuemax')]).toEqual(['vertical', '200', '100', '300']);
  expect(h.tabIndex).toBe(0);
});

test('a drag captures the pointer, previews clamped sizes while aria-valuenow follows, and commits once on release', () => {
  const { h, preview, commit } = setup();
  const capture = vi.spyOn(h, 'setPointerCapture');
  down(h, 50);
  expect(capture).toHaveBeenCalledWith(1);
  fireEvent.pointerMove(h, { clientX: 80, pointerId: 1 });
  expect(preview).toHaveBeenLastCalledWith(230);
  expect(h.getAttribute('aria-valuenow')).toBe('230');
  fireEvent.pointerMove(h, { clientX: 1000, pointerId: 1 });
  expect(preview).toHaveBeenLastCalledWith(MAX);
  fireEvent.pointerMove(h, { clientX: -1000, pointerId: 1 });
  expect(preview).toHaveBeenLastCalledWith(MIN);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(h, { clientX: -1000, pointerId: 1 });
  expect(commit.mock.calls).toEqual([[MIN]]);
  // The capture's release after pointerup ends nothing more.
  fireEvent.lostPointerCapture(h, { pointerId: 1 });
  expect(commit).toHaveBeenCalledTimes(1);
});

test('a release at the start size stores nothing and puts the size back', () => {
  const { h, preview, commit } = setup();
  down(h, 50);
  fireEvent.pointerMove(h, { clientX: 80, pointerId: 1 });
  fireEvent.pointerMove(h, { clientX: 50, pointerId: 1 });
  preview.mockClear();
  fireEvent.pointerUp(h, { clientX: 50, pointerId: 1 });
  expect(commit).not.toHaveBeenCalled();
  expect(preview.mock.calls).toEqual([[VALUE]]);
});

test.each(['pointerCancel', 'lostPointerCapture'] as const)('a drag ended by %s restores the size, stores nothing, and later events do nothing', (end) => {
  const { h, preview, commit } = setup();
  down(h, 50);
  fireEvent.pointerMove(h, { clientX: 80, pointerId: 1 });
  fireEvent[end](h, { pointerId: 1 });
  expect(preview).toHaveBeenLastCalledWith(VALUE);
  const calls = preview.mock.calls.length;
  fireEvent.pointerMove(h, { clientX: 120, pointerId: 1 });
  fireEvent.pointerUp(h, { clientX: 120, pointerId: 1 });
  expect([commit.mock.calls.length, preview.mock.calls.length, h.getAttribute('aria-valuenow')]).toEqual([0, calls, '200']);
});

test('unmounting mid-drag leaves nothing listening: later moves and releases, on the handle or the window, store nothing', () => {
  const { h, preview, commit, unmount } = setup();
  down(h, 50);
  fireEvent.pointerMove(h, { clientX: 80, pointerId: 1 });
  const calls = preview.mock.calls.length;
  unmount();
  for (const target of [h, window]) {
    fireEvent.pointerMove(target, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(target, { clientX: 120, pointerId: 1 });
  }
  expect([commit.mock.calls.length, preview.mock.calls.length]).toEqual([0, calls]);
});

test('only the primary button starts a drag, and only the capturing pointer drives it', () => {
  const { h, preview, commit } = setup();
  down(h, 50, { button: 2 });
  fireEvent.pointerMove(h, { clientX: 80, pointerId: 1 });
  expect(preview).not.toHaveBeenCalled();
  down(h, 50);
  fireEvent.pointerMove(h, { clientX: 90, pointerId: 2 });
  fireEvent.pointerUp(h, { clientX: 90, pointerId: 2 });
  expect(preview).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerMove(h, { clientX: 60, pointerId: 1 });
  expect(preview).toHaveBeenLastCalledWith(210);
});

test('a second pointer\'s down, move and up during a drag neither captures nor commits, and the first drag carries on', () => {
  const { h, preview, commit } = setup();
  const capture = vi.spyOn(h, 'setPointerCapture');
  down(h, 50);
  fireEvent.pointerMove(h, { clientX: 80, pointerId: 1 });
  down(h, 300, { pointerId: 2 });
  fireEvent.pointerMove(h, { clientX: 320, pointerId: 2 });
  fireEvent.pointerUp(h, { clientX: 320, pointerId: 2 });
  expect(capture.mock.calls).toEqual([[1]]);
  expect(commit).not.toHaveBeenCalled();
  expect(h.getAttribute('aria-valuenow')).toBe('230');
  fireEvent.pointerMove(h, { clientX: 90, pointerId: 1 });
  expect(preview).toHaveBeenLastCalledWith(240);
  fireEvent.pointerUp(h, { clientX: 90, pointerId: 1 });
  expect(commit.mock.calls).toEqual([[240]]);
});

test('a pointer-started drag leaves the handle focused, so the keys work right after', () => {
  const { h, commit } = setup();
  down(h, 50);
  fireEvent.pointerMove(h, { clientX: 80, pointerId: 1 });
  fireEvent.pointerUp(h, { clientX: 80, pointerId: 1 });
  expect(document.activeElement).toBe(h);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(commit.mock.calls).toEqual([[230], [VALUE + STEP]]);
});

test('sign -1 inverts the drag and the arrow step, so a pane on the right grows as its handle moves left', () => {
  const { h, preview, commit } = setup({ sign: -1 });
  down(h, 50);
  fireEvent.pointerMove(h, { clientX: 20, pointerId: 1 });
  expect(preview).toHaveBeenLastCalledWith(230);
  fireEvent.pointerCancel(h, { pointerId: 1 });
  fireEvent.keyDown(h, { key: 'ArrowLeft' });
  fireEvent.keyDown(h, { key: 'ArrowRight' });
  expect(commit.mock.calls).toEqual([[VALUE + STEP], [VALUE - STEP]]);
});

test('keys come from the passed catalogue shortcuts: a step commits clamp(value ± step), Home and End the bounds, an unrelated key nothing', () => {
  const { h, commit } = setup();
  fireEvent.keyDown(h, { key: 'ArrowRight' });
  fireEvent.keyDown(h, { key: 'ArrowLeft' });
  fireEvent.keyDown(h, { key: 'Home' });
  fireEvent.keyDown(h, { key: 'End' });
  expect(commit.mock.calls).toEqual([[VALUE + STEP], [VALUE - STEP], [MIN], [MAX]]);
  commit.mockClear();
  expect(fireEvent.keyDown(h, { key: 'ArrowUp' })).toBe(true);
  expect(fireEvent.keyDown(h, { key: 'ArrowRight' })).toBe(false);
  expect(commit).toHaveBeenCalledTimes(1);
});

test('a key that cannot move the size stores nothing', () => {
  const at = setup({ value: MAX });
  fireEvent.keyDown(at.h, { key: 'ArrowRight' });
  fireEvent.keyDown(at.h, { key: 'End' });
  expect(at.commit).not.toHaveBeenCalled();
});
