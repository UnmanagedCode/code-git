// COPY of src/git/remote/url.js on code-conductor/c6-remotes (C6 Remotes). On rebase onto C6: delete this file and import the original.
import { Refusal } from '../../../refusals.js';

// What a user may type into a remote's config: its url and a new name. Pure; checked before any exec.

/** Characters a url may hold: no whitespace, no control character (DEL included). */
const hasSpaceOrControl = (s) => /[\s\x00-\x1f\x7f]/.test(s);
export const URL_MAX = 2048;

/** `<transport>::<address>`: git hands the address to a remote helper (`ext::` runs a command). Never accepted. */
const HELPER_RE = /^[A-Za-z][A-Za-z0-9+.-]*::/;
const SCHEME_RE = /^(?:https?|ssh|git\+ssh|ssh\+git|git|file):\/\/(.+)$/i;
/** scp-like `[user@]host:path`: git reads it so when a `:` comes before any `/`. A bracketed host may hold `:`. */
const SCP_RE = /^(?:([^@/:]+)@)?(\[[^\]/]+\]|[^@/:[\]]+):(.+)$/;

const bad = (why) => new Refusal('BAD_URL', `invalid remote url: ${why}`);

/**
 * A remote url to write into config, else BAD_URL. Accepted: `http(s)://`, `ssh://`, `git+ssh://`, `ssh+git://`,
 * `git://` and `file://` urls, an absolute path, and scp-like `[user@]host:path` (host with no `/`, path not starting
 * `//`). Refused: anything else, any `<transport>::` helper url, a leading `-`, whitespace or a control character, a
 * host starting with `-` (ssh would read it as an option), and more than URL_MAX characters.
 */
export function remoteUrl(s) {
  if (typeof s !== 'string' || s === '') throw bad('empty');
  if (s.length > URL_MAX) throw bad(`longer than ${URL_MAX} characters`);
  if (hasSpaceOrControl(s)) throw bad('contains whitespace or a control character');
  if (s.startsWith('-')) throw bad('starts with -');
  if (HELPER_RE.test(s)) throw bad('a <transport>:: url runs a remote helper');
  const scheme = SCHEME_RE.exec(s);
  if (scheme) {
    const host = scheme[1].replace(/^[^@/]*@/, '');
    if (host.startsWith('-')) throw bad('the host starts with -');
    return s;
  }
  if (s.startsWith('/')) return s;
  const scp = SCP_RE.exec(s);
  if (scp && !scp[2].startsWith('-') && !scp[3].startsWith('//')) return s;
  throw bad('expected an http(s)/ssh/git/file url, an absolute path or user@host:path');
}
