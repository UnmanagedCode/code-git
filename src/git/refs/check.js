import { Refusal } from '../../refusals.js';
import { assertRefName } from '../validate.js';
import { REF_LIMITS } from './limits.js';

// Ref-name checks shared by the branch, tag and head ops (the generic param checks are src/git/params.js). Each throws
// BAD_PARAMS or BAD_REF.

const bad = (msg) => new Refusal('BAD_PARAMS', msg);

/** A branch or tag name without its `refs/…/` prefix. `HEAD` and a leading `refs/` would name something else. */
export function shortBranch(s) {
  assertRefName(s);
  if (s === 'HEAD' || s.startsWith('refs/')) throw new Refusal('BAD_REF', `invalid name: ${s === 'HEAD' ? 'HEAD' : 'starts with refs/'}`);
  return s;
}

/** A full refname under one of `prefixes` (e.g. `refs/heads/`); the rest passes assertRefName. */
export function fullRef(s, prefixes) {
  const prefix = typeof s === 'string' ? prefixes.find((p) => s.startsWith(p)) : undefined;
  if (!prefix) throw new Refusal('BAD_REF', `invalid ref: must start with ${prefixes.join(' or ')}`);
  assertRefName(s.slice(prefix.length));
  return s;
}

/** 1…REF_LIMITS.namesMax names, each passing `check`, duplicates dropped (first kept). */
export function nameList(v, what, check = shortBranch) {
  if (!Array.isArray(v) || v.length < 1 || v.length > REF_LIMITS.namesMax) throw bad(`${what} must list 1…${REF_LIMITS.namesMax} names`);
  return [...new Set(v.map(check))];
}
