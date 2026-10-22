import { Refusal } from '../refusals.js';

// Pure input checks for everything a route lets the user name. Each throws a Refusal (BAD_TARGET, BAD_REF, BAD_PATH).

// `.` and `..` would rewrite the cc URL a name is spliced into (`/api/projects/../worktrees`).
const isName = (s) => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && s.length <= 200 && !s.includes('\0') && !s.includes('/');
// ASCII control characters, DEL included.
const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/**
 * A cc checkout: `{project, worktree?}`, worktree absent/null = the main checkout. Any other key is refused,
 * which is what keeps `system`/`cwd` (exec form B) out of every request.
 */
export function assertTarget(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Refusal('BAD_TARGET', 'target must be an object {project, worktree?}');
  for (const k of Object.keys(t)) {
    if (k !== 'project' && k !== 'worktree') throw new Refusal('BAD_TARGET', `target: unknown key ${JSON.stringify(k)}`);
  }
  if (!isName(t.project)) throw new Refusal('BAD_TARGET', 'target.project must be a project name');
  if (t.worktree !== undefined && t.worktree !== null && !isName(t.worktree)) throw new Refusal('BAD_TARGET', 'target.worktree must be a worktree name');
  return { project: t.project, worktree: t.worktree ?? null };
}

/** A ref to create or name: `git check-ref-format --allow-onelevel` rules. */
export function assertRefName(s) {
  const bad = (why) => new Refusal('BAD_REF', `invalid ref name: ${why}`);
  if (typeof s !== 'string' || s === '') throw bad('empty');
  if (Buffer.byteLength(s) > 255) throw bad('longer than 255 bytes');
  if (s.startsWith('-')) throw bad('starts with -');
  if (hasControl(s) || /[ ~^:?*[\\]/.test(s)) throw bad('contains a forbidden character');
  if (s.includes('..') || s.includes('@{') || s.includes('//')) throw bad('contains .., @{ or //');
  if (s === '@') throw bad('is @');
  if (s.startsWith('/') || s.endsWith('/') || s.endsWith('.')) throw bad('starts with / or ends with / or .');
  for (const part of s.split('/')) {
    if (part.startsWith('.') || part.endsWith('.lock')) throw bad('a component starts with . or ends with .lock');
  }
  return s;
}

/** A revision to resolve. Callers also pass `--end-of-options` before it where the subcommand parses options. */
export function assertRev(s) {
  if (typeof s !== 'string' || s === '' || s.length > 1024) throw new Refusal('BAD_REF', 'invalid revision: empty or too long');
  if (hasControl(s) || /\s/.test(s)) throw new Refusal('BAD_REF', 'invalid revision: contains whitespace or a control character');
  if (s.startsWith('-')) throw new Refusal('BAD_REF', 'invalid revision: starts with -');
  return s;
}

/**
 * A repo-relative path. A leading `-` is allowed: paths always follow `--`, and GIT_LITERAL_PATHSPECS=1
 * turns pathspec magic off. Backslashes are refused so a Windows-style `..\` cannot traverse.
 */
export function assertPath(s) {
  if (typeof s !== 'string' || s === '' || s.length > 4096) throw new Refusal('BAD_PATH', 'invalid path: empty or too long');
  if (s.includes('\0') || s.includes('\\')) throw new Refusal('BAD_PATH', 'invalid path: contains NUL or a backslash');
  if (s.startsWith('/')) throw new Refusal('BAD_PATH', 'invalid path: absolute');
  if (s.split('/').includes('..')) throw new Refusal('BAD_PATH', 'invalid path: has a .. segment');
  return s;
}

/** A path used as `-C <subpath>`, where a leading `-` would be read as an option. */
export function assertSubpath(s) {
  assertPath(s);
  if (s.startsWith('-')) throw new Refusal('BAD_PATH', 'invalid subpath: starts with -');
  return s;
}
