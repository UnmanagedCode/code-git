import { Refusal } from '../../refusals.js';
import { remoteUrl, URL_MAX } from '../remote/url.js';

// A submodule's url as a user may type it. Pure; checked before any exec.

/** `./…` or `../…`: git resolves it against the parent's default remote url (at init and add), never code-git. */
export const isRelativeUrl = (s) => s.startsWith('./') || s.startsWith('../');

/**
 * A url for `submodule add` or `.gitmodules`, else BAD_URL: remoteUrl's allowlist, or a relative `./…` / `../…` with
 * no whitespace or control character, no `::` and no backslash, at most URL_MAX characters. A relative url is checked
 * again once git has resolved it (src/git/submodule/gates.js).
 */
export function submoduleUrl(s) {
  if (typeof s !== 'string' || !isRelativeUrl(s)) return remoteUrl(s);
  const bad = (why) => new Refusal('BAD_URL', `invalid submodule url: ${why}`);
  if (s.length > URL_MAX) throw bad(`longer than ${URL_MAX} characters`);
  if (/[\s\x00-\x1f\x7f]/.test(s)) throw bad('contains whitespace or a control character');
  if (s.includes('::')) throw bad('a <transport>:: url runs a remote helper');
  if (s.includes('\\')) throw bad('contains a backslash');
  return s;
}
