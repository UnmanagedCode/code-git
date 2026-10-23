import { Refusal } from '../../refusals.js';
import { parseRecords } from '../parse/graph.js';

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * `refnames` (full) → Map(refname → {oid, symref}) for the ones that exist. A tag's id is its tag object (unpeeled); a
 * symbolic ref's is its target's, with `symref` naming the target. for-each-ref patterns also match below a `/`, so
 * the output is filtered to exact names. `--end-of-options`: a name read from repo config (an upstream) is never an option.
 */
export async function refEntries(git, refnames) {
  if (!refnames.length) return new Map();
  const r = await git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', '--end-of-options', ...refnames]);
  const want = new Set(refnames);
  return new Map(parseRecords(decoder.decode(r.stdout), 3).filter(([name]) => want.has(name))
    .map(([name, oid, symref]) => [name, { oid, symref: symref || null }]));
}

/** `refnames` (full) → Map(refname → object id) for the ones that exist (refEntries without the symref). */
export async function refObjects(git, refnames) {
  return new Map([...await refEntries(git, refnames)].map(([name, e]) => [name, e.oid]));
}

/** Tag names → Map(name → tag object or commit id) for the ones that exist. */
export async function tagObjects(git, names) {
  const found = await refObjects(git, names.map((n) => `refs/tags/${n}`));
  return new Map([...found].map(([ref, oid]) => [ref.slice('refs/tags/'.length), oid]));
}

/**
 * The target of `ref` (full) when it is a symbolic ref, else null. Exact name, and it reports a dangling symbolic ref too
 * (one whose target does not exist), which for-each-ref does not list at all.
 */
export async function symbolicTarget(git, ref) {
  const r = await git(['symbolic-ref', '-q', ref], { okExit: [0, 1] });
  return r.exitCode === 0 ? decoder.decode(r.stdout).trim() || null : null;
}

/**
 * Throws SYMBOLIC_REF (with `target`) when `ref` is a symbolic ref, live or dangling: creating, renaming or deleting
 * through it would write its target — in any namespace — under the alias's name.
 */
export async function assertNoSymref(git, ref) {
  const target = await symbolicTarget(git, ref);
  if (target) throw new Refusal('SYMBOLIC_REF', `${ref} is a symbolic ref to ${target}`, { target });
}
