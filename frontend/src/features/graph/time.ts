const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** The largest |ms| a Date holds (ECMAScript time range). */
const MAX_DATE_MS = 8.64e15;

/**
 * A git timestamp (unix seconds) for display, or `—` when it is not a representable date: a crafted commit can carry
 * any number, and Intl's format throws a RangeError on an invalid Date.
 */
export function formatTime(unix: number): string {
  const ms = unix * 1000;
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return '—';
  try {
    return DATE.format(new Date(ms));
  } catch {
    return '—';
  }
}
