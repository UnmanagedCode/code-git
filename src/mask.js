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
 * The length of the userinfo delimiter `ch` at `i`: 1 for `ch`, 3 for its percent-encoding `enc` in any case (git's ssh,
 * git and http transports decode the userinfo: `%3A` is its `:`, `%40` its `@`), else 0.
 */
function delimAt(s, i, ch, enc) {
  if (s[i] === ch) return 1;
  return s[i] === '%' && i + 2 < s.length && s[i + 1] === enc[0] && s[i + 2].toUpperCase() === enc[1] ? 3 : 0;
}
const colonAt = (s, i) => delimAt(s, i, ':', '3A');
const atAt = (s, i) => delimAt(s, i, '@', '40');

/** What may come right before a url in a text: whitespace, a quote, an opening bracket, `,` or `=`. */
const URL_BOUNDARY = new Set(["'", '"', '`', '(', '[', '<', ',', '=']);

/** The index of the start of the `[A-Za-z0-9+.-]` run ending at `end - 1` (`end` when there is none). */
function runStart(s, end) {
  let i = end;
  while (i > 0 && isSchemeChar(s[i - 1])) i--;
  return i;
}

/**
 * Whether a url may start at `at` in a text: the text's start, after a URL_BOUNDARY character or whitespace, or after a
 * `<transport>::` that itself starts there (`ext::https://…`). Not after a lone `:`: a `://` inside a password
 * (`https://u:pw://x@h`) is no new url.
 */
function boundaryAt(s, at) {
  if (at === 0 || URL_BOUNDARY.has(s[at - 1]) || WS.test(s[at - 1])) return true;
  if (at < 2 || s[at - 1] !== ':' || s[at - 2] !== ':') return false;
  const helper = runStart(s, at - 2);
  return helper < at - 2 && (helper === 0 || URL_BOUNDARY.has(s[helper - 1]) || WS.test(s[helper - 1]));
}

/**
 * The next url in `s` whose `://` is at or after `from`: {start, sep} — `sep` the index of its `://`, `start` its scheme's
 * first character — or null. A scheme is a run of `[A-Za-z0-9+.-]` holding a letter or digit, its start the first one
 * (git hands any `<scheme>://` to git-remote-<scheme>, a digit first too). `inText`: the run must also start at a url
 * boundary (boundaryAt). Each run is read once: runs end at the `/` and `:` around them.
 */
function nextUrl(s, from, inText = false) {
  for (let sep = s.indexOf(SEP, from); sep !== -1; sep = s.indexOf(SEP, sep + 1)) {
    const run = runStart(s, sep);
    let start = run;
    while (start < sep && !isAlnum(s[start])) start++;
    if (start < sep && (!inText || boundaryAt(s, run))) return { start, sep };
  }
  return null;
}

/**
 * A stored value's password span: {from, to} — from after the first `:` past its first url's `scheme://` (the url may
 * be anywhere in it: git stores `<transport>::<url>` too) up to the value's last `@` — or null, an empty one too. A
 * `%3A` counts as the `:` and a `%40` as an `@` (delimAt). A user name may hold `@`
 * (`https://a@b:c@host/r`) and a password `/`, `@` and whitespace, so the first `:` and the last `@` are taken (a path
 * holding a `:` and an `@` is masked too: the safe side).
 */
function valueSpan(v) {
  const url = v.includes(SEP) ? nextUrl(v, 0) : null;
  if (!url) return null;
  let colon = url.sep + SEP.length;
  while (colon < v.length && !colonAt(v, colon)) colon++;
  let at = v.length - 1;
  while (at > colon && !atAt(v, at)) at--;
  const from = colon + colonAt(v, colon);
  return colon < v.length && at > from ? { from, to: at } : null;
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

/** What ends a url's authority after its host: a path, a port, a query, a fragment, a quote or a closing bracket. */
const AUTHORITY_END = new Set(['/', ':', '?', '#', "'", '"', ')', ']', '>']);
/** What may follow a port's digits: AUTHORITY_END but another `:`. */
const PORT_END = new Set([...AUTHORITY_END].filter((c) => c !== ':'));

/**
 * How the `@` at `at` would end a url's authority, read up to `end`: its host-like run (no `@`, whitespace or
 * AUTHORITY_END character) followed by an AUTHORITY_END character → 'strong'; by whitespace or `end` → 'weak'; by another
 * `@` → null (the `@` is inside a password).
 */
function authorityEnd(s, at, end) {
  let i = at + atAt(s, at);
  while (i < end && !atAt(s, i) && !WS.test(s[i]) && !AUTHORITY_END.has(s[i])) i++;
  if (i >= end || WS.test(s[i])) return 'weak';
  return atAt(s, i) ? null : 'strong';
}

/** Whether the text at `from` (up to `end`) reads as a port: digits, then a PORT_END character, a line end or `end`. */
function portAt(s, from, end) {
  let i = from;
  while (i < end && s[i] >= '0' && s[i] <= '9') i++;
  return i > from && (i === end || isLineEnd(s[i]) || PORT_END.has(s[i]));
}

/**
 * The password span of the url whose `://` is at `sep` in a text, never reaching `bound` (the next url's scheme):
 * {from, to} or null, never empty. `scheme://user` holds no whitespace and ends at the first `:`; a `%3A` counts as a
 * `:` and a `%40` as an `@` throughout (delimAt). A password that stops at
 * whitespace (or starts with it, or with a port: portAt) ends at the last `@` of its token. One going on past whitespace
 * on the same line ends at the `@` that ends its url's authority (authorityEnd), never at one inside it: the first strong
 * `@` on the line, else the token's own last `@` when strong, else the first weak `@` after the token, else the token's
 * weak one.
 */
function textSpan(s, sep, bound) {
  let colon = sep + SEP.length;
  while (colon < bound && !colonAt(s, colon) && !WS.test(s[colon])) colon++;
  if (colon >= bound || !colonAt(s, colon)) return null;
  const from = colon + colonAt(s, colon);
  const span = (to) => (to > from ? { from, to } : null);
  let i = from;
  let tokenAt = -1;
  for (; i < bound && !WS.test(s[i]); i++) if (atAt(s, i)) tokenAt = i;
  const spaced = i > from && i < bound && !isLineEnd(s[i]) && !portAt(s, from, bound);
  if (!spaced) return tokenAt === -1 ? null : span(tokenAt);
  let strong = -1;
  let weak = -1;
  for (; i < bound && !isLineEnd(s[i]) && strong === -1; i++) {
    if (!atAt(s, i)) continue;
    const end = authorityEnd(s, i, bound);
    if (end === 'strong') strong = i;
    if (end === 'weak' && weak === -1) weak = i;
  }
  if (strong !== -1) return span(strong);
  if (tokenAt !== -1 && authorityEnd(s, tokenAt, bound) === 'strong') return span(tokenAt);
  return span(weak !== -1 ? weak : tokenAt);
}

/**
 * `text` with every `scheme://user:password@` inside it masked (textSpan), within one line: a password may hold `@`,
 * quotes and whitespace — git quotes the url it failed on in its own messages (`fatal: clone of '<url>' into …`,
 * `Submodule 'x' (<url>) registered`) — while a second url or trailing `user@host` text on the line is left as it is.
 */
function maskTextUrls(text) {
  if (!text.includes(SEP)) return text;
  let out = '';
  let done = 0;
  for (let url = nextUrl(text, 0, true); url;) {
    const next = nextUrl(text, url.sep + 1, true);
    const span = textSpan(text, url.sep, next ? next.start : text.length);
    if (span) {
      out += `${text.slice(done, span.from)}***`;
      done = span.to;
    }
    url = next;
  }
  return out + text.slice(done);
}

/** git's git-protocol look-up failure, `unable to look up <host> (port <n>) (…)`: `<host>` is the url's whole authority. */
const LOOKUP = 'unable to look up ';
const LOOKUP_PORT = ' (port ';

/** The index of the next `needle` at or after `from`, or `s.length`. */
const indexOr = (s, needle, from) => { const i = s.indexOf(needle, from); return i === -1 ? s.length : i; };

/**
 * `text` with the password in each LOOKUP line's host masked as a url's is: from its first `:` to its last `@` before
 * ` (port ` (a decoded password may hold a space), the line's end or the next LOOKUP — never empty. A git:// url's
 * userinfo reaches git's message so, with no scheme for a url mask to find (remoteUrl refuses one; git config may hold
 * it). Each forward search is reused until passed, and hosts never overlap: linear.
 */
function maskLookups(text) {
  if (!text.includes(LOOKUP)) return text;
  let out = '';
  let done = 0;
  const ends = { port: -1, lf: -1, cr: -1 };
  for (let at = text.indexOf(LOOKUP); at !== -1;) {
    const from = at + LOOKUP.length;
    const next = text.indexOf(LOOKUP, from);
    if (ends.port < from) ends.port = indexOr(text, LOOKUP_PORT, from);
    if (ends.lf < from) ends.lf = indexOr(text, '\n', from);
    if (ends.cr < from) ends.cr = indexOr(text, '\r', from);
    const end = Math.min(ends.port, ends.lf, ends.cr, next === -1 ? text.length : next);
    let colon = -1;
    let last = -1;
    for (let i = from; i < end; i++) {
      if (text[i] === ':' && colon === -1) colon = i;
      if (text[i] === '@') last = i;
    }
    if (colon !== -1 && last > colon + 1) {
      out += `${text.slice(done, colon + 1)}***`;
      done = last;
    }
    at = next;
  }
  return out + text.slice(done);
}

/**
 * `text` with every url's password masked (maskTextUrls), and the userinfo password in git's git-protocol look-up line
 * (maskLookups).
 */
export const maskUrls = (text) => maskLookups(maskTextUrls(text));

/** `v` with maskUrls applied to every string in it, through arrays and plain objects (a refusal's body, a git message). */
export function maskDeep(v) {
  if (typeof v === 'string') return maskUrls(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}
