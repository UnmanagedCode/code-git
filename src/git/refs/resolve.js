import { parseRecords } from '../parse/graph.js';

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * `refnames` (full) → Map(refname → object id) for the ones that exist. A tag's id is its tag object (unpeeled).
 * for-each-ref patterns also match below a `/`, so the output is filtered to exact names.
 */
export async function refObjects(git, refnames) {
  if (!refnames.length) return new Map();
  const r = await git(['for-each-ref', '--format=%(refname)%00%(objectname)', ...refnames]);
  const want = new Set(refnames);
  return new Map(parseRecords(decoder.decode(r.stdout), 2).filter(([name]) => want.has(name)));
}

/** Tag names → Map(name → tag object or commit id) for the ones that exist. */
export async function tagObjects(git, names) {
  const found = await refObjects(git, names.map((n) => `refs/tags/${n}`));
  return new Map([...found].map(([ref, oid]) => [ref.slice('refs/tags/'.length), oid]));
}
