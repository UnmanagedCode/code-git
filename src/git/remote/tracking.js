import { Refusal } from '../../refusals.js';
import { LIMITS } from '../limits.js';
import { parseRecords } from '../parse/graph.js';

// Which remote-tracking refs here a push or a fetch writes. git maps each branch through the remote's *configured*
// fetch refspecs (remote_find_tracking for a push), so the mapping is read from config, never assumed.

const decoder = new TextDecoder('utf-8', { fatal: false });
const hasControlOrSpace = (s) => [...s].some((c) => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) === 0x7f);
const stars = (s) => s.split('*').length - 1;

const unsupported = (remote, refspec, why) => new Refusal('REMOTE_CONFIG_UNSUPPORTED',
  `the fetch refspec ${JSON.stringify(refspec)} of ${remote} is not one code-git can map (${why})`, { remote, refspec });

/**
 * One `remote.<name>.fetch` value → {negative, src, dst | null, refspec (as given)}, or REMOTE_CONFIG_UNSUPPORTED for any shape not parsed
 * with confidence. Accepted: `[+]<src>:<dst>` and `[+]<src>` (fetch without storing: maps nothing), `^<src>` (an
 * exclusion); src and dst full refs (`refs/…`) with no `*` or exactly one `*` on each side that has a dst.
 */
export function parseFetchRefspec(remote, refspec) {
  if (typeof refspec !== 'string' || refspec === '' || hasControlOrSpace(refspec)) throw unsupported(remote, refspec, 'empty or holds whitespace');
  if (refspec.startsWith('^')) {
    const src = refspec.slice(1);
    if (src.includes(':') || !src.startsWith('refs/') || stars(src) > 1) throw unsupported(remote, refspec, 'a negative refspec must be one full ref pattern');
    return { negative: true, src, dst: null, refspec };
  }
  const body = refspec.startsWith('+') ? refspec.slice(1) : refspec;
  const parts = body.split(':');
  if (parts.length > 2) throw unsupported(remote, refspec, 'more than one :');
  const [src, dst = null] = parts;
  if (!src.startsWith('refs/')) throw unsupported(remote, refspec, 'the source is not a full ref');
  if (dst === null) {
    if (stars(src) > 1) throw unsupported(remote, refspec, 'more than one *');
    return { negative: false, src, dst: null, refspec };
  }
  if (!dst.startsWith('refs/')) throw unsupported(remote, refspec, 'the destination is not a full ref');
  if (stars(src) > 1 || stars(dst) > 1 || stars(src) !== stars(dst)) throw unsupported(remote, refspec, 'each side needs the same single *, or none');
  return { negative: false, src, dst, refspec };
}

/** The part of `ref` a single-`*` pattern's star stands for, or null when it does not match (an exact pattern: '' on equality). */
function matchPattern(pattern, ref) {
  const i = pattern.indexOf('*');
  if (i === -1) return pattern === ref ? '' : null;
  const prefix = pattern.slice(0, i);
  const suffix = pattern.slice(i + 1);
  return ref.length >= prefix.length + suffix.length && ref.startsWith(prefix) && ref.endsWith(suffix)
    ? ref.slice(prefix.length, ref.length - suffix.length) : null;
}

/**
 * Every tracking ref the parsed refspecs map `ref` (a branch on the remote, `refs/heads/<b>`) to, in refspec order
 * (git writes the first; all are checked). Negative refspecs exclude nothing here: git's push-time tracking update
 * ignores them (verified with git 2.55: `^refs/heads/b` does not stop `push :refs/heads/b` writing through a symbolic
 * tracking ref), so honouring them would hide the very ref git writes.
 */
export function trackingRefsFor(specs, ref) {
  const out = [];
  for (const s of specs) {
    if (s.negative || s.dst === null) continue;
    const m = matchPattern(s.src, ref);
    if (m === null) continue;
    const dst = s.dst.includes('*') ? s.dst.replace('*', m) : s.dst;
    if (!out.includes(dst)) out.push(dst);
  }
  return out;
}

/** `--get-all` output → its values, empty ones kept (each value ends with a newline). */
const values = (r) => {
  const out = decoder.decode(r.stdout).split('\n');
  out.pop();
  return out;
};

/**
 * Whether the remote has a url as git counts it: an empty `remote.<name>.url` value clears the list, so only the values
 * after the last empty one count, and at least one must be non-empty. A `pushurl` does not count.
 */
export function hasUrl(urlValues) {
  const last = urlValues.lastIndexOf('');
  return urlValues.slice(last + 1).some((v) => v !== '');
}

/** git's valid_remote_nick: only such a name can have a legacy file (and only such a name is safe to splice into a path). */
const validNick = (name) => name !== '' && name !== '.' && name !== '..' && !name.includes('/');

/**
 * Whether git would read `remote`'s config from a legacy `.git/remotes/<name>` or `.git/branches/<name>` file (it does so
 * when the remote has no url). Through git alone: `rev-parse --git-path` names the file (in the common dir, from any
 * worktree), and `hash-object --no-filters` (no -w: nothing is written) succeeds only for a readable file — the same
 * files git's own reader can open.
 */
export async function legacyRemoteFile(git, remote) {
  if (!validNick(remote)) return null;
  for (const dir of ['remotes', 'branches']) {
    const where = decoder.decode((await git(['rev-parse', '--git-path', `${dir}/${remote}`])).stdout).trim();
    if (!where) continue;
    const r = await git(['hash-object', '--no-filters', '--', where], { okExit: [0, 128] });
    if (r.exitCode === 0) return `${dir}/${remote}`;
  }
  return null;
}

/**
 * `remote`'s fetch refspecs, parsed (`git config --get-all remote.<name>.fetch`, includes resolved). Without a url
 * (hasUrl) git also reads a legacy `.git/remotes/<name>` or `.git/branches/<name>` file, whose refspecs are not
 * mapped here: when one exists, REMOTE_CONFIG_UNSUPPORTED. A push-only remote (pushurl, no url, no legacy file) maps
 * through its config. Any refspec parseFetchRefspec does not accept is refused too; no refspec maps nothing.
 */
export async function fetchSpecs(git, remote) {
  const get = (key) => git(['config', '--get-all', key], { okExit: [0, 1] });
  const [url, fetch] = await Promise.all([get(`remote.${remote}.url`), get(`remote.${remote}.fetch`)]);
  if (!hasUrl(values(url))) {
    const legacy = await legacyRemoteFile(git, remote);
    if (legacy) {
      throw new Refusal('REMOTE_CONFIG_UNSUPPORTED', `${remote} has no url in git config, so git reads its refspecs from the legacy file ${legacy}`, { remote, refspec: null });
    }
  }
  return values(fetch).filter(Boolean).map((s) => parseFetchRefspec(remote, s));
}

/** The namespaces a fetch may write besides its refspecs' destinations: tags it follows or a refspec names. */
const FETCH_DST_ROOTS = ['refs/remotes/', 'refs/tags/'];

/**
 * Refuses REMOTE_CONFIG_UNSUPPORTED when a refspec of `remote` would make a fetch write outside `refs/remotes/` or
 * `refs/tags/`: a `+refs/heads/*:refs/heads/*` mirror would move local branches, `code-conductor/*` ones included.
 */
export function assertFetchDestinations(remote, specs) {
  for (const s of specs) {
    if (s.negative || s.dst === null) continue;
    if (!FETCH_DST_ROOTS.some((root) => s.dst.startsWith(root))) {
      throw unsupported(remote, s.refspec, 'a fetch would write outside refs/remotes/ and refs/tags/');
    }
  }
}

const storing = (specs) => specs.filter((s) => !s.negative && s.dst !== null);

/**
 * The `for-each-ref` patterns covering every ref the refspecs' destinations name: a wildcard destination cut after the
 * last `/` before its `*`, an exact one as it is. They also match more (for-each-ref matches below a `/`); `inDestinations`
 * filters to the exact set.
 */
export function destinationNamespaces(specs) {
  return [...new Set(storing(specs).map((s) => {
    const i = s.dst.indexOf('*');
    return i === -1 ? s.dst : s.dst.slice(0, s.dst.lastIndexOf('/', i) + 1);
  }))];
}

/** `ref` is a destination of one of the refspecs. */
export const inDestinations = (specs, ref) => storing(specs).some((s) => matchPattern(s.dst, ref) !== null);

/**
 * The remote's own HEAD alias, which git itself keeps symbolic (`remote set-head`, a fetch's `followRemoteHEAD`): a
 * wildcard destination with `HEAD` for the `*`, pointing at a ref of the same destination pattern.
 */
export function isHeadAlias(specs, ref, target) {
  return storing(specs).some((s) => s.dst.includes('*') && s.dst.replace('*', 'HEAD') === ref && matchPattern(s.dst, target) !== null);
}

/**
 * One read of every ref a fetch with `specs` may write: the refspecs' destinations (inDestinations) and all of
 * `refs/tags` → Map(ref → {oid, symref | null}). A live symbolic ref reports its target's oid; a dangling one is not
 * listed (for-each-ref skips it).
 */
export async function trackedSnapshot(git, specs) {
  const r = await git(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', ...destinationNamespaces(specs), 'refs/tags'],
    { maxOutputBytes: LIMITS.read.maxOutputBytes });
  const out = new Map();
  for (const [ref, oid, symref] of parseRecords(decoder.decode(r.stdout), 3)) {
    if (ref.startsWith('refs/tags/') || inDestinations(specs, ref)) out.set(ref, { oid, symref: symref || null });
  }
  return out;
}

/**
 * Refuses SYMBOLIC_REF (`ref`, `target`) for the first symbolic ref in `snapshot` other than the remote's HEAD alias: a
 * fetch writing that ref would follow it and move its target (a local branch, a cc-owned one, in any namespace).
 */
export function assertNoTrackingSymrefs(snapshot, specs, remote) {
  for (const [ref, e] of snapshot) {
    if (!e.symref || isHeadAlias(specs, ref, e.symref)) continue;
    throw new Refusal('SYMBOLIC_REF', `${ref} is a symbolic ref to ${e.symref}: fetching ${remote} would write through it`, { ref, target: e.symref });
  }
}

/** The symbolic refs live in `after` that were not live symbolic refs in `before` → [{ref, target}]. */
export function newlyLiveSymrefs(before, after) {
  return [...after].filter(([ref, e]) => e.symref && !before.get(ref)?.symref).map(([ref, e]) => ({ ref, target: e.symref }));
}
