import type { RefObject } from 'react';
import { setCssPx } from '@/lib/cssVars';
import { Splitter } from '@/shell/Splitter';
import { clampHeader, DETAILS_HEADER, headerMax, setDetailsHeader } from '@/state/detailsHeader';
import { DETAILS_HEADER_BOUND_KEY, DETAILS_HEADER_STEP_KEY } from '../keys';

/** The custom property the commit-information header's height class reads. */
export const HEADER_VAR = '--details-header';

/** The handle below the commit information: a `Splitter` on the header's height, written to the header's custom property. */
export function HeaderSplitter({ header, height, available }: { header: RefObject<HTMLElement | null>; height: number; available: number }) {
  // Unmeasured (no layout yet), the top is the current height: an unbounded value never reaches setCssPx.
  const max = Number.isFinite(headerMax(available)) ? headerMax(available) : height;
  return (
    <Splitter
      orientation="horizontal"
      label="Resize commit information"
      value={height}
      min={DETAILS_HEADER.min}
      max={max}
      clamp={(px) => clampHeader(px, available)}
      step={DETAILS_HEADER.step}
      sign={1}
      stepKey={DETAILS_HEADER_STEP_KEY}
      boundKey={DETAILS_HEADER_BOUND_KEY}
      preview={(px) => { if (header.current) setCssPx(header.current, HEADER_VAR, px); }}
      commit={setDetailsHeader}
    />
  );
}
