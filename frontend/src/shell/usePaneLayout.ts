import { useLayoutEffect, useState } from 'react';
import { setCssPx } from '@/lib/cssVars';
import { fitPanes, paneMax, usePaneWidths, type PaneSide } from '@/state/paneWidths';

export const PANE_VAR: Record<PaneSide, string> = { left: '--pane-left', right: '--pane-right' };
export type PaneLayout = Record<PaneSide, { value: number; max: number }>;

/** An element's width, kept current by a ResizeObserver; 0 until measured (and where there is no layout). */
function useWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}

/**
 * The side panes' rendered widths and live maxima for the stored choice fitted to `main`'s width. Writes both widths to
 * `main`'s custom properties, which the slots' width classes read.
 */
export function usePaneLayout(main: HTMLElement | null): PaneLayout {
  const chosen = usePaneWidths();
  const available = useWidth(main);
  const fit = fitPanes(chosen, available);
  useLayoutEffect(() => {
    if (!main) return;
    setCssPx(main, PANE_VAR.left, fit.left);
    setCssPx(main, PANE_VAR.right, fit.right);
  }, [main, fit.left, fit.right]);
  return {
    left: { value: fit.left, max: paneMax('left', available, fit.right) },
    right: { value: fit.right, max: paneMax('right', available, fit.left) },
  };
}
