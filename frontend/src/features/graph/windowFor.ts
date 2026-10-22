/** Row height in px: the virtual list's single source. */
export const ROW_H = 28;
/** Rows rendered beyond each edge of the viewport. */
export const OVERSCAN = 20;

/** The rows [start, end) to render for a scroll position, clamped to [0, count]. */
export function windowFor(scrollTop: number, viewportH: number, count: number, rowH = ROW_H, overscan = OVERSCAN): { start: number; end: number } {
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const h = Number.isFinite(viewportH) ? Math.max(0, viewportH) : 0;
  const start = Math.min(count, Math.max(0, Math.floor(top / rowH) - overscan));
  const end = Math.min(count, Math.ceil((top + h) / rowH) + overscan);
  return { start, end: Math.max(start, end) };
}
