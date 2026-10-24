// Hiding a url's password wherever a url may be shown (remote.list's urls, op results, the activity log's argv and stderr), and
// spotting the mask echoed back. Pure.

/** A url's `scheme://`: git hands any `<scheme>://` to git-remote-<scheme>, so a scheme may start with a digit. */
const SCHEME = '[A-Za-z0-9][A-Za-z0-9+.-]*:\\/\\/';

/**
 * The first url in a value — anywhere in it: git stores `<transport>::<url>` too — as `scheme://user` (group 1), then its
 * password span: from the first `:` after `scheme://` up to the value's last `@`.
 */
const PASSWORD_RE = new RegExp(`(${SCHEME}[^:]*):[\\s\\S]*@`);

/**
 * `url` (a stored value) with everything from the first `:` after its first `scheme://` up to its last `@` shown as `***`:
 * `https://u:p@ss/word@host/r` → `https://u:***@host/r`, `foo::https://u:pw@host/r` → `foo::https://u:***@host/r`. A user
 * name may hold `@` (`https://a@b:c@host/r`) and a password `/` and `@`, so the first `:` and the last `@` are taken (a path
 * holding a `:` and an `@` is masked too: the safe side). A value without a `:` before an `@` after `scheme://` is returned
 * unchanged.
 */
export const maskUrl = (url) => url.replace(PASSWORD_RE, '$1:***@');

/**
 * Whether `url`'s password is the mask itself (`https://u:***@host/r`): what maskUrl shows, echoed back. A real password
 * that is literally `***` reads as masked too.
 */
export const isMaskedUrl = (url) => PASSWORD_RE.test(url) && maskUrl(url) === url;

/**
 * Every url inside a text: `scheme://user` (group 1; no whitespace), then its password span up to the `@` that ends it —
 * the last `@` of the token the password starts in; else, for a password holding whitespace, the first `@` on the same
 * line that is the last `@` of its own token, never across another `scheme://`. Such a span never starts with whitespace
 * or a port's digits (`https://h:8443/r … git@host` and `'https://h/r/': … me@host` are not passwords).
 */
const TEXT_PASSWORD_RE = new RegExp(`(${SCHEME}[^:\\s]*):(?:\\S*|(?!\\s|\\d+\\b)(?:(?!${SCHEME})[^\\r\\n])*?)@(?=[^\\s@]*(?:\\s|$))`, 'g');

/**
 * `text` with every `scheme://user:password@` inside it masked as maskUrl does, within one line (TEXT_PASSWORD_RE): a
 * password may hold whitespace, `@` and quotes, so none of them ends it — git quotes the url it failed on in its own
 * messages (`fatal: clone of '<url>' into …`, `Submodule 'x' (<url>) registered`) — while a second url or trailing
 * `user@host` text on the line is left as it is.
 */
export const maskUrls = (text) => text.replace(TEXT_PASSWORD_RE, '$1:***@');

/** `v` with maskUrls applied to every string in it, through arrays and plain objects (a refusal's body, a git message). */
export function maskDeep(v) {
  if (typeof v === 'string') return maskUrls(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}
