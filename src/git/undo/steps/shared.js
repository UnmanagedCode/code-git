import { Refusal } from '../../../refusals.js';

// What the step kinds share.

/** UNDO_STALE: the checkout is no longer in the state the plan expects (something changed it since). */
export const stale = (why) => new Refusal('UNDO_STALE', `cannot undo: ${why}`);

/** Two {branch, oid} HEAD states are the same. */
export const sameHead = (a, b) => (a.branch ?? null) === (b.branch ?? null) && (a.oid ?? null) === (b.oid ?? null);

/** A ref's short name: `refs/heads/x` → `x`, `refs/tags/v1` → `v1`. */
export const shortRef = (ref) => ref.replace(/^refs\/(?:heads|tags)\//, '');
