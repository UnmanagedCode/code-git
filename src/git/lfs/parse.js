import { Refusal } from '../../refusals.js';

// Pure parsers for what the LFS ops read (docs/lfs.md): git-lfs's version line and `ls-files --json`, and the root
// .gitattributes, which code-git reads itself because every `git lfs track` — a listing included — installs hooks.

const decoder = new TextDecoder('utf-8', { fatal: false });
/** The oldest git-lfs whose `ls-files --json` the ops read. */
export const LFS_FLOOR = [3, 2, 0];

const unexpected = (what) => new Refusal('GIT_FAILED', `unexpected git-lfs output: ${what}`);

/** `git lfs version`'s first line `git-lfs/x.y.z …` → {version, supported (≥ LFS_FLOOR)}; anything else GIT_FAILED. */
export function parseLfsVersion(text) {
  const m = /^git-lfs\/(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!m) throw new Refusal('GIT_FAILED', 'unrecognised git-lfs version');
  const v = m.slice(1, 4).map(Number);
  const i = v.findIndex((n, k) => n !== LFS_FLOOR[k]);
  return { version: v.join('.'), supported: i === -1 || v[i] > LFS_FLOOR[i] };
}

/** A field that is `type` or absent (null); any other value refuses. */
function field(o, key, type) {
  if (o[key] === undefined || o[key] === null) return null;
  if (typeof o[key] !== type) throw unexpected(`files[].${key} is not a ${type}`);
  return o[key];
}

/**
 * `git lfs ls-files --json` → [{path, size, oid, downloaded}]. Only the fields git-lfs 3.3.0 has are read; a missing one
 * is null. `files: null` (no LFS files) is []. Malformed output is GIT_FAILED, never a guess.
 */
export function parseLsFilesJson(buf) {
  let doc;
  try { doc = JSON.parse(decoder.decode(buf)); } catch { throw unexpected('not JSON'); }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw unexpected('not an object');
  if (doc.files === null) return [];
  if (!Array.isArray(doc.files)) throw unexpected('files is not a list');
  return doc.files.map((f) => {
    if (f === null || typeof f !== 'object' || typeof f.name !== 'string') throw unexpected('a file without a name');
    return { path: f.name, size: field(f, 'size', 'number'), oid: field(f, 'oid', 'string'), downloaded: field(f, 'downloaded', 'boolean') };
  });
}

// git's attr.c: blanks around tokens, `#` comments, C-style quoting.
const BLANK = ' \t\r\n';
const isBlank = (c) => BLANK.includes(c);
const ESCAPES = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"' };

/** git's unquote_c_style on `s` (latin1, one char per byte) from the opening quote: {value, end} or null. */
function unquote(s) {
  let out = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === '"') return { value: out, end: i + 1 };
    if (c !== '\\') { out += c; continue; }
    const e = s[++i];
    if (e in ESCAPES) out += ESCAPES[e];
    else if (/[0-3]/.test(e ?? '') && /^[0-7]{2}$/.test(s.slice(i + 1, i + 3))) { out += String.fromCharCode(parseInt(s.slice(i, i + 3), 8)); i += 2; } else return null;
  }
  return null;
}

/**
 * The patterns of a .gitattributes (bytes) whose line ends up with `filter=lfs`, in file order, as git's attribute parser
 * reads them: blank and `#` lines skipped; a quoted pattern C-unquoted as data (git reads one it cannot unquote as a
 * plain token); `[attr]` macro lines and `!` negative patterns (git ignores those) skipped; the last `filter` token on a
 * line decides. Patterns are decoded as UTF-8.
 */
export function parseLfsAttributes(bytes) {
  const out = [];
  for (const line of bytes.toString('latin1').split('\n')) {
    let i = 0;
    while (i < line.length && isBlank(line[i])) i++;
    if (i === line.length || line[i] === '#') continue;
    const rest = line.slice(i);
    let pattern;
    let states;
    const q = rest[0] === '"' ? unquote(rest) : null;
    if (q) {
      pattern = q.value;
      states = rest.slice(q.end);
    } else {
      let n = 0;
      while (n < rest.length && !isBlank(rest[n])) n++;
      pattern = rest.slice(0, n);
      states = rest.slice(n);
    }
    if (pattern.startsWith('[attr]') || pattern.startsWith('!')) continue;
    let lfs = false;
    for (const tok of states.split(/[ \t\r\n]+/).filter(Boolean)) {
      if (tok === 'filter' || tok === '-filter' || tok === '!filter') lfs = false;
      else if (tok.startsWith('filter=')) lfs = tok === 'filter=lfs';
    }
    if (lfs) out.push(Buffer.from(pattern, 'latin1').toString('utf8'));
  }
  return out;
}
