import { Refusal } from '../../refusals.js';
import { assertRefName } from '../validate.js';
import { remoteName } from './push.js';

// What a user may type into a remote's config: its url and a new name. Pure; checked before any exec.

/** Characters a url may hold: no whitespace, no control character (DEL included). */
const hasSpaceOrControl = (s) => /[\s\x00-\x1f\x7f]/.test(s);
export const URL_MAX = 2048;

/**
 * `<transport>::<address>`: git hands the address to a remote helper (`ext::` runs a command). Never accepted. A helper
 * name may start with a digit (`1foo::x` runs git-remote-1foo, git 2.55); `_x::y` is scp-like, not a helper.
 */
const HELPER_RE = /^[A-Za-z0-9][A-Za-z0-9+.-]*::/;
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

/**
 * A name for a new (or renamed) remote, else BAD_REF: remoteName's shape (no leading `-`, whitespace or control
 * character), git's own rule, a valid `refs/remotes/<name>/…` (assertRefName), and no `=`: a push pins
 * `-c remote.<name>.mirror=false` (pushConfig), which git splits at the first `=`, so such a name would pin nothing.
 */
export function newRemoteName(s) {
  try {
    remoteName(s);
  } catch {
    throw new Refusal('BAD_REF', 'invalid remote name: empty, too long, or starts with - or holds whitespace');
  }
  assertRefName(s);
  if (s.includes('=')) throw new Refusal('BAD_REF', 'invalid remote name: contains =');
  return s;
}
