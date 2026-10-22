import { Refusal } from '../refusals.js';
import { onlyKeys } from './diff/source.js';
import { assertPath } from './validate.js';

// Shared checks for op params. Each throws BAD_PARAMS (or BAD_PATH from assertPath).

export const bad = (msg) => new Refusal('BAD_PARAMS', msg);

/** `raw` must be a plain object whose keys are all in `allowed`. */
export function paramsObject(raw, allowed, op) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw bad(`${op} params must be an object`);
  onlyKeys(raw, allowed, op);
  return raw;
}

/** An optional boolean field. */
export function optBool(v, what) {
  if (v !== undefined && typeof v !== 'boolean') throw bad(`${what} must be a boolean`);
  return v ?? false;
}

/** A list of `min…max` repo-relative paths, each passing assertPath, duplicates dropped (first kept). */
export function pathList(v, what, { min = 1, max }) {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw bad(`${what} must list ${min}…${max} paths`);
  return [...new Set(v.map(assertPath))];
}

/** Paths as `--pathspec-from-file=- --pathspec-file-nul` stdin. */
export const nulPaths = (paths) => paths.map((p) => `${p}\0`).join('');

/** Splits `paths` into runs whose argv bytes (each path plus its NUL) stay within `maxBytes`. */
export function chunkPaths(paths, maxBytes) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const p of paths) {
    const n = Buffer.byteLength(p) + 1;
    if (cur.length && size + n > maxBytes) { out.push(cur); cur = []; size = 0; }
    cur.push(p);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
