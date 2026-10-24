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
 * `text` with every `scheme://user:password@` inside it masked as maskUrl does, within each whitespace-separated token:
 * from the first `:` after `scheme://` to the token's last `@`. A password may hold quotes, so a quote does not end it: git
 * quotes the url it failed on in its own messages (`fatal: clone of '<url>' into …`, `Submodule 'x' (<url>) registered`).
 */
export const maskUrls = (text) => text.replace(new RegExp(`(${SCHEME}[^:\\s]*):\\S*@`, 'g'), '$1:***@');

/** `v` with maskUrls applied to every string in it, through arrays and plain objects (a refusal's body, a git message). */
export function maskDeep(v) {
  if (typeof v === 'string') return maskUrls(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}
