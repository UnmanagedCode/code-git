const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** The largest |ms| a Date holds (ECMAScript time range). */
export const MAX_DATE_MS = 8.64e15;

/** A git timestamp (unix seconds) as ms when it is a representable date, else null. */
export function dateMs(unix: number): number | null {
  if (typeof unix !== 'number') return null;
  const ms = unix * 1000;
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS ? ms : null;
}

/**
 * A git timestamp (unix seconds) for display, or `—` when it is not a representable date: a crafted commit can carry
 * any number, and Intl's format throws a RangeError on an invalid Date.
 */
export function formatTime(unix: number): string {
  const ms = dateMs(unix);
  if (ms === null) return '—';
  try {
    return DATE.format(new Date(ms));
  } catch {
    return '—';
  }
}
