import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { setCssPx } from '@/lib/cssVars';
import { matchCombo } from '@/shell/shortcuts';
import { clampHeader, DETAILS_HEADER, headerMax, setDetailsHeader } from '@/state/detailsHeader';
import { DETAILS_HEADER_BOUND_KEY, DETAILS_HEADER_STEP_KEY } from '../keys';

/** The custom property the commit-information header's height class reads. */
export const HEADER_VAR = '--details-header';

/**
 * The handle below the commit information: drag or ↑/↓ (Home/End) to resize it. A drag writes the height straight to
 * the header and stores it once on release.
 */
export function HeaderSplitter({ header, height, available }: { header: RefObject<HTMLElement | null>; height: number; available: number }) {
  // Unmeasured (no layout yet), the top is the current height: an unbounded value never reaches setCssPx.
  const max = Number.isFinite(headerMax(available)) ? headerMax(available) : height;
  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    let h = height;
    const move = (ev: PointerEvent) => {
      h = clampHeader(height + ev.clientY - y0, available);
      if (header.current) setCssPx(header.current, HEADER_VAR, h);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (h !== height) setDetailsHeader(h);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const [step, bound] = [matchCombo(e, DETAILS_HEADER_STEP_KEY), matchCombo(e, DETAILS_HEADER_BOUND_KEY)];
    if (!step && !bound) return;
    e.preventDefault();
    const [up, down] = DETAILS_HEADER_STEP_KEY.combos;
    const next = step === up ? height - DETAILS_HEADER.step : step === down ? height + DETAILS_HEADER.step : bound === DETAILS_HEADER_BOUND_KEY.combos[0] ? DETAILS_HEADER.min : max;
    setDetailsHeader(clampHeader(next, available));
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize commit information"
      aria-valuenow={height}
      aria-valuemin={DETAILS_HEADER.min}
      aria-valuemax={max}
      tabIndex={0}
      className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center outline-none hover:bg-ring/40 focus-visible:bg-ring/40"
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
    >
      <span className="h-1 w-8 rounded-full bg-border group-hover:bg-ring group-focus-visible:bg-ring" />
    </div>
  );
}
