// Hiding a url's password wherever a url may be shown (remote.list's display urls, the activity log's argv and stderr). Pure.

/**
 * `url` with everything from its userinfo's first `:` up to the authority's last `@` shown as `***`:
 * `https://u:p@ss/word@host/r` → `https://u:***@host/r`. A password may hold `/` and `@`, so the last `@` is taken
 * (a path holding one is masked too: the safe side). A url without a `scheme://user:` prefix is returned unchanged.
 */
export const maskUrl = (url) => url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@:]*):[\s\S]*@/, '$1:***@');

/**
 * `text` with every `scheme://user:password@` inside it masked as maskUrl does, within each whitespace-separated token:
 * from the userinfo's first `:` to the token's last `@`. A password may hold quotes, so a quote does not end it: git
 * quotes the url it failed on in its own messages (`fatal: clone of '<url>' into …`, `Submodule 'x' (<url>) registered`).
 */
export const maskUrls = (text) => text.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@:\s]*):\S*@/g, '$1:***@');
