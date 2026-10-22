/** Up to two initials for an avatar: the first letters of the first and last words of `name`, else of the email's local part. */
export function initials(name: string, email = ''): string {
  const words = (s: string) => s.split(/[\s._-]+/).map((w) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c))).filter((c): c is string => !!c);
  const w = words(name.trim());
  const from = w.length ? w : words(email.split('@')[0] ?? '');
  if (!from.length) return '?';
  return (from.length === 1 ? from[0] : from[0] + from[from.length - 1]).toUpperCase();
}
