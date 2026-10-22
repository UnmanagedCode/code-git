/** Rows of a file list rendered before its "Show all N" (the commit details', the Changes panel's, a confirmation's). */
export const FILE_RENDER_CAP = 1000;

/** Characters of untrusted text (a subject, a name, a path) shown at once; copy actions use the whole value. */
export const DISPLAY_MAX = 2048;

/** `s` cut to `max` characters with an ellipsis, never splitting a surrogate pair. */
export function clip(s: string, max = DISPLAY_MAX): string {
  if (s.length <= max) return s;
  const end = /[\uD800-\uDBFF]/.test(s[max - 1]) ? max - 1 : max;
  return `${s.slice(0, end)}…`;
}
