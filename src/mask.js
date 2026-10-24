// Hiding a url's password wherever a url may be shown (remote.list's urls, op results, the activity log's argv and stderr), and
// spotting the mask echoed back. Pure.

// Linear in the input's length: a hand-written scan from each `://`, never a regex searching for a scheme's start (that
// backtracks over every long alphanumeric run: quadratic on a hostile url posted to remote.edit, or a remote's stderr).

const SEP = '://';
const WS = /\s/;
const isAlnum = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
const isSchemeChar = (c) => isAlnum(c) || c === '+' || c === '.' || c === '-';
const isLineEnd = (c) => c === '\n' || c === '\r';

/**
 * The next url in `s` whose `://` is at or after `from`: {start, sep} — `sep` the index of its `://`, `start` its scheme's
 * first character — or null. A scheme is a run of `[A-Za-z0-9+.-]` starting with a letter or digit (git hands any
 * `<scheme>://` to git-remote-<scheme>, a digit first too). Each run is read once: runs end at the `/` and `:` around them.
 */
function nextUrl(s, from) {
  for (let sep = s.indexOf(SEP, from); sep !== -1; sep = s.indexOf(SEP, sep + 1)) {
    let start = -1;
    for (let i = sep - 1; i >= 0 && isSchemeChar(s[i]); i--) if (isAlnum(s[i])) start = i;
    if (start !== -1) return { start, sep };
  }
  return null;
}

/**
 * A stored value's password span: {from, to} — from after the first `:` past its first url's `scheme://` (the url may
 * be anywhere in it: git stores `<transport>::<url>` too) up to the value's last `@` — or null. A user name may hold `@`
 * (`https://a@b:c@host/r`) and a password `/`, `@` and whitespace, so the first `:` and the last `@` are taken (a path
 * holding a `:` and an `@` is masked too: the safe side).
 */
function valueSpan(v) {
  const url = v.includes(SEP) ? nextUrl(v, 0) : null;
  if (!url) return null;
  const colon = v.indexOf(':', url.sep + SEP.length);
  const at = v.lastIndexOf('@');
  return colon !== -1 && at > colon ? { from: colon + 1, to: at } : null;
}

/**
 * `url` (a stored value) with its password span (valueSpan) shown as `***`: `https://u:p@ss/word@host/r` →
 * `https://u:***@host/r`, `foo::https://u:pw@host/r` → `foo::https://u:***@host/r`. A value without a `:` before an `@`
 * after `scheme://` is returned unchanged.
 */
export function maskUrl(url) {
  const span = valueSpan(url);
  return span ? `${url.slice(0, span.from)}***${url.slice(span.to)}` : url;
}

/**
 * Whether `url`'s password is the mask itself (`https://u:***@host/r`): what maskUrl shows, echoed back. A real password
 * that is literally `***` reads as masked too.
 */
export function isMaskedUrl(url) {
  const span = valueSpan(url);
  return span !== null && url.slice(span.from, span.to) === '***';
}

/** Whether the `@` at `at` is the last of its whitespace-separated token (a url's authority ends there). */
function lastInToken(s, at) {
  let i = at + 1;
  while (i < s.length && s[i] !== '@' && !WS.test(s[i])) i++;
  return i === s.length || s[i] !== '@';
}

/** Whether a password span at `from` reads as a port, not a password: digits, then no letter, digit or `_`. */
function portAt(s, from) {
  let i = from;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
  return i > from && !(i < s.length && (isAlnum(s[i]) || s[i] === '_'));
}

/**
 * The password span of the url whose `://` is at `sep` in a text, never reaching `bound` (the next url's scheme):
 * {from, to} or null. `scheme://user` holds no whitespace and ends at the first `:`; the span ends at the last `@` of the
 * token it starts in; else — a password holding whitespace, not starting with whitespace or a port — at the first `@` on
 * the line that is the last `@` of its own token.
 */
function textSpan(s, sep, bound) {
  let colon = sep + SEP.length;
  while (colon < bound && s[colon] !== ':' && !WS.test(s[colon])) colon++;
  if (colon >= bound || s[colon] !== ':') return null;
  const from = colon + 1;
  let i = from;
  let tokenAt = -1;
  for (; i < bound && !WS.test(s[i]); i++) if (s[i] === '@') tokenAt = i;
  if (tokenAt !== -1) return { from, to: tokenAt };
  if (i === from || portAt(s, from)) return null;
  for (; i < bound && !isLineEnd(s[i]); i++) if (s[i] === '@' && lastInToken(s, i)) return { from, to: i };
  return null;
}

/**
 * `text` with every `scheme://user:password@` inside it masked (textSpan), within one line: a password may hold `@`,
 * quotes and whitespace — git quotes the url it failed on in its own messages (`fatal: clone of '<url>' into …`,
 * `Submodule 'x' (<url>) registered`) — while a second url or trailing `user@host` text on the line is left as it is.
 */
export function maskUrls(text) {
  if (!text.includes(SEP)) return text;
  let out = '';
  let done = 0;
  for (let url = nextUrl(text, 0); url;) {
    const next = nextUrl(text, url.sep + 1);
    const span = textSpan(text, url.sep, next ? next.start : text.length);
    if (span) {
      out += `${text.slice(done, span.from)}***`;
      done = span.to;
    }
    url = next;
  }
  return out + text.slice(done);
}

/** `v` with maskUrls applied to every string in it, through arrays and plain objects (a refusal's body, a git message). */
export function maskDeep(v) {
  if (typeof v === 'string') return maskUrls(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}
