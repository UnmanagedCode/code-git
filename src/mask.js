// Hiding a url's password wherever a url may be shown (remote.list's display urls, the activity log's argv and stderr). Pure.

/**
 * `url` with everything from the first `:` after `scheme://` up to its last `@` shown as `***`:
 * `https://u:p@ss/word@host/r` → `https://u:***@host/r`. A user name may hold `@` (`https://a@b:c@host/r`) and a password
 * `/` and `@`, so the first `:` and the last `@` are taken (a path holding a `:` and an `@` is masked too: the safe side).
 * A url without a `:` before an `@` after `scheme://` is returned unchanged.
 */
export const maskUrl = (url) => url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^:]*):[\s\S]*@/, '$1:***@');

/**
 * `text` with every `scheme://user:password@` inside it masked as maskUrl does, within each whitespace-separated token:
 * from the first `:` after `scheme://` to the token's last `@`. A password may hold quotes, so a quote does not end it: git
 * quotes the url it failed on in its own messages (`fatal: clone of '<url>' into …`, `Submodule 'x' (<url>) registered`).
 */
export const maskUrls = (text) => text.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/[^:\s]*):\S*@/g, '$1:***@');

/** `v` with maskUrls applied to every string in it, through arrays and plain objects (a refusal's body, a git message). */
export function maskDeep(v) {
  if (typeof v === 'string') return maskUrls(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}
