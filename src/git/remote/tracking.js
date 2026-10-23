import { Refusal } from '../../refusals.js';

// Which remote-tracking refs here a push to a remote updates. git maps each pushed (or deleted) branch through the
// remote's *configured* fetch refspecs (remote_find_tracking), so the mapping is read from config, never assumed.

const decoder = new TextDecoder('utf-8', { fatal: false });
const hasControlOrSpace = (s) => [...s].some((c) => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) === 0x7f);
const stars = (s) => s.split('*').length - 1;

const unsupported = (remote, refspec, why) => new Refusal('REMOTE_CONFIG_UNSUPPORTED',
  `the fetch refspec ${JSON.stringify(refspec)} of ${remote} is not one code-git can map (${why})`, { remote, refspec });

/**
 * One `remote.<name>.fetch` value → {negative, src, dst | null}, or REMOTE_CONFIG_UNSUPPORTED for any shape not parsed
 * with confidence. Accepted: `[+]<src>:<dst>` and `[+]<src>` (fetch without storing: maps nothing), `^<src>` (an
 * exclusion); src and dst full refs (`refs/…`) with no `*` or exactly one `*` on each side that has a dst.
 */
export function parseFetchRefspec(remote, refspec) {
  if (typeof refspec !== 'string' || refspec === '' || hasControlOrSpace(refspec)) throw unsupported(remote, refspec, 'empty or holds whitespace');
  if (refspec.startsWith('^')) {
    const src = refspec.slice(1);
    if (src.includes(':') || !src.startsWith('refs/') || stars(src) > 1) throw unsupported(remote, refspec, 'a negative refspec must be one full ref pattern');
    return { negative: true, src, dst: null };
  }
  const body = refspec.startsWith('+') ? refspec.slice(1) : refspec;
  const parts = body.split(':');
  if (parts.length > 2) throw unsupported(remote, refspec, 'more than one :');
  const [src, dst = null] = parts;
  if (!src.startsWith('refs/')) throw unsupported(remote, refspec, 'the source is not a full ref');
  if (dst === null) {
    if (stars(src) > 1) throw unsupported(remote, refspec, 'more than one *');
    return { negative: false, src, dst: null };
  }
  if (!dst.startsWith('refs/')) throw unsupported(remote, refspec, 'the destination is not a full ref');
  if (stars(src) > 1 || stars(dst) > 1 || stars(src) !== stars(dst)) throw unsupported(remote, refspec, 'each side needs the same single *, or none');
  return { negative: false, src, dst };
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

/**
 * `remote`'s fetch refspecs, parsed (`git config --get-all remote.<name>.fetch`, includes resolved). A remote with no
 * `url` in config makes git read its refspecs from `.git/remotes/` or `.git/branches/` files instead: refused, as is
 * any refspec parseFetchRefspec does not accept. No refspec maps nothing.
 */
export async function fetchSpecs(git, remote) {
  const get = (key) => git(['config', '--get-all', key], { okExit: [0, 1] });
  const [url, fetch] = await Promise.all([get(`remote.${remote}.url`), get(`remote.${remote}.fetch`)]);
  if (url.exitCode !== 0) throw new Refusal('REMOTE_CONFIG_UNSUPPORTED', `${remote} has no url in git config: its refspecs would come from legacy remote files`, { remote, refspec: null });
  return decoder.decode(fetch.stdout).split('\n').filter(Boolean).map((s) => parseFetchRefspec(remote, s));
}
