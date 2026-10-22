import { Refusal } from '../../refusals.js';
import { assertPath } from '../validate.js';

// The only builder of .gitignore patterns. Pure. Every pattern is anchored (`/…`) or starts `*.`, so it can never begin
// with `#` (a comment) or `!` (a negation); what remains special inside one is escaped.

const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** `\`, `*`, `?` and `[` escaped with `\`, and each trailing space (git trims unescaped ones). */
export function escapeGlob(s) {
  const body = s.replace(/[\\*?[]/g, (c) => `\\${c}`);
  const trailing = body.length - body.trimEnd().length;
  return body.trimEnd() + '\\ '.repeat(trailing);
}

/** A file or folder below the root: assertPath, no empty or `.` segment (never `.`, the whole repository). */
function onePath(p, what) {
  assertPath(p);
  if (p.split('/').some((seg) => seg === '' || seg === '.')) throw new Refusal('BAD_PATH', `${p} must name one ${what} below the root`);
  return p;
}

/**
 * `kind`: `path` → `/<path>` (that file), `dir` → `/<dir>/` (that directory), `ext` → `*.<ext>` (every such file, at any
 * depth). A control character → BAD_PATH; an empty extension or one with `/` → BAD_PARAMS.
 */
export function ignorePattern(kind, value) {
  if (typeof value !== 'string') throw new Refusal('BAD_PARAMS', 'value must be a string');
  if (hasControl(value)) throw new Refusal('BAD_PATH', 'an ignore pattern cannot hold a control character');
  if (kind === 'path') return `/${escapeGlob(onePath(value, 'file'))}`;
  if (kind === 'dir') return `/${escapeGlob(onePath(value.replace(/\/+$/, ''), 'folder'))}/`;
  if (kind === 'ext') {
    if (!value || value.includes('/') || value.startsWith('.')) throw new Refusal('BAD_PARAMS', 'ext must be an extension without dot or slash');
    return `*.${escapeGlob(value)}`;
  }
  throw new Refusal('BAD_PARAMS', "kind must be 'path', 'ext' or 'dir'");
}
