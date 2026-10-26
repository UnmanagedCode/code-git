import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { setCssPx } from '@/lib/cssVars';
import { matchCombo } from '@/shell/shortcuts';
import { clampHeader, DETAILS_HEADER, headerMax, setDetailsHeader } from '@/state/detailsHeader';
import { DETAILS_HEADER_BOUND_KEY, DETAILS_HEADER_STEP_KEY } from '../keys';

/** The custom property the commit-information header's height class reads. */
export const HEADER_VAR = '--details-header';

/**
 * The handle below the commit information: drag or ↑/↓ (Home/End) to resize it. A drag captures the pointer, so its
 * moves and its end reach this element's own listeners, which unmount with it: an abandoned drag (pointercancel, a lost
 * capture, an unmount) resizes and stores nothing more. A drag writes the height straight to the header and stores it
 * once on release; a cancelled one puts the height back.
 */
export function HeaderSplitter({ header, height, available }: { header: RefObject<HTMLElement | null>; height: number; available: number }) {
  // Unmeasured (no layout yet), the top is the current height: an unbounded value never reaches setCssPx.
  const max = Number.isFinite(headerMax(available)) ? headerMax(available) : height;
  // The live drag (its latest height read on release) and the same height as state, for aria-valuenow.
  const drag = useRef<{ pointerId: number; y0: number; h: number } | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const end = (e: PointerEvent, save: boolean) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    const { h } = drag.current;
    drag.current = null;
    if (save && h !== height) setDetailsHeader(h);
    else if (header.current) setCssPx(header.current, HEADER_VAR, height);
    setDragged(null);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, y0: e.clientY, h: height };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current.h = clampHeader(height + e.clientY - drag.current.y0, available);
    if (header.current) setCssPx(header.current, HEADER_VAR, drag.current.h);
    setDragged(drag.current.h);
  };
  // A key stores only a height it actually moves to: a clamped header keeps the user's choice for when the panel grows.
  const onKeyDown = (e: KeyboardEvent) => {
    const [step, bound] = [matchCombo(e, DETAILS_HEADER_STEP_KEY), matchCombo(e, DETAILS_HEADER_BOUND_KEY)];
    if (!step && !bound) return;
    e.preventDefault();
    const [up, down] = DETAILS_HEADER_STEP_KEY.combos;
    const next = clampHeader(step === up ? height - DETAILS_HEADER.step : step === down ? height + DETAILS_HEADER.step : bound === DETAILS_HEADER_BOUND_KEY.combos[0] ? DETAILS_HEADER.min : max, available);
    if (next !== height) setDetailsHeader(next);
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize commit information"
      aria-valuenow={dragged ?? height}
      aria-valuemin={DETAILS_HEADER.min}
      aria-valuemax={max}
      tabIndex={0}
      className="group flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none hover:bg-ring/40 focus-visible:bg-ring/40"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
      onLostPointerCapture={(e) => end(e, false)}
      onKeyDown={onKeyDown}
    >
      <span className="h-1 w-8 rounded-full bg-border group-hover:bg-ring group-focus-visible:bg-ring" />
    </div>
  );
}
