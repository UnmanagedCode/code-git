import { setCssPx } from '@/lib/cssVars';
import { PANE, setPaneWidth, type PaneSide } from '@/state/paneWidths';
import { PANE_WIDTH_BOUND_KEY, PANE_WIDTH_STEP_KEY } from './keys';
import { Splitter } from './Splitter';
import { PANE_VAR, type PaneLayout } from './usePaneLayout';

/** The resize handle on a side pane's inner edge; hidden with the slots below `lg`. */
export function PaneHandle({ side, main, layout }: { side: PaneSide; main: HTMLElement | null; layout: PaneLayout }) {
  const { value, max } = layout[side];
  const { min } = PANE[side];
  return (
    <Splitter
      orientation="vertical"
      label={`Resize ${side} pane`}
      value={value}
      min={min}
      max={max}
      clamp={(px) => Math.round(Math.max(min, Math.min(max, px)))}
      step={PANE.step}
      sign={side === 'left' ? 1 : -1}
      stepKey={PANE_WIDTH_STEP_KEY}
      boundKey={PANE_WIDTH_BOUND_KEY}
      preview={(px) => { if (main) setCssPx(main, PANE_VAR[side], px); }}
      commit={(px) => setPaneWidth(side, px)}
      className="hidden lg:flex"
    />
  );
}
