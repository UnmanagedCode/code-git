// Hiding a url's password wherever a url may be shown (remote.list's display urls, the activity log's argv). Pure.

/**
 * `url` with everything from its userinfo's first `:` up to the authority's last `@` shown as `***`:
 * `https://u:p@ss/word@host/r` → `https://u:***@host/r`. A password may hold `/` and `@`, so the last `@` is taken
 * (a path holding one is masked too: the safe side). A url without a `scheme://user:` prefix is returned unchanged.
 */
export const maskUrl = (url) => url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@:]*):[\s\S]*@/, '$1:***@');
