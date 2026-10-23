import { Refusal } from '../../refusals.js';
import { parseRemotes } from '../parse/graph.js';
import { parsePushPorcelain, splitRequested } from '../parse/push.js';
import { assertNoSymref } from '../refs/resolve.js';
import { netRun, remoteFailure } from './net.js';
import { assertPushTracking, fetchSpecs, trackingMapFor } from './tracking.js';

// Pushing, and the remote-name checks every remote op shares. The push runs through netRun (net.js): no prompt, no
// `ext::`/`fd::` transport. Hooks (pre-push) always run.

const decoder = new TextDecoder('utf-8', { fatal: false });
const hasControlOrSpace = (s) => [...s].some((c) => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) === 0x7f);

/** A remote name's shape, checked before any exec: non-empty, no leading `-`, no whitespace or control character. */
export function remoteName(s) {
  if (typeof s !== 'string' || s === '' || s.length > 200 || s.startsWith('-') || hasControlOrSpace(s)) {
    throw new Refusal('REMOTE_UNKNOWN', 'invalid remote name');
  }
  return s;
}

/** `name` is one of `git remote`'s remotes, else REMOTE_UNKNOWN. */
export async function knownRemote(git, name) {
  const remotes = parseRemotes(decoder.decode((await git(['remote'])).stdout));
  if (!remotes.includes(name)) throw new Refusal('REMOTE_UNKNOWN', `no remote ${name}`);
  return name;
}

/**
 * `git push --porcelain --no-follow-tags` of `refspecs` (`src:dst`) to `remote` → {updated, rejected, upToDate,
 * unrequested} (splitRequested over parsePushPorcelain): the first three hold only the refspecs' destinations.
 * `--no-follow-tags` keeps a configured `push.followTags` from publishing tags nobody selected. Before anything runs: a
 * destination whose mapped local ref (per the remote's fetch refspecs) is symbolic, live or dangling, refuses
 * SYMBOLIC_REF; one mapped outside refs/remotes/, or a fetch config code-git cannot map, REMOTE_CONFIG_UNSUPPORTED. A push that reports no
 * ref at all failed as a whole: remoteFailure (REMOTE_AUTH_FAILED / REMOTE_UNREACHABLE with a reason, or GIT_FAILED with
 * git's stderr: a pre-push hook that refused lands here). Rejected refs are the caller's to judge.
 * `setUpstream` adds `--set-upstream`; each lease `{ref, expect}` adds `--force-with-lease=<ref>:<expect>` (expect null:
 * the ref must not exist on the remote). Never `--force` and never a `+` refspec: a lease is the only way to overwrite.
 */
export async function push(git, remote, refspecs, { setUpstream = false, leases = [] } = {}) {
  // git updates the remote-tracking ref of every ref it pushes or deletes, following a symbolic one: an alias
  // → refs/heads/victim would move or delete `victim` past every guard. Which ref that is comes from the remote's
  // configured fetch refspecs (tracking.js), and it must lie under refs/remotes/.
  for (const ref of await trackingRefsOfPush(git, remote, refspecs)) await assertNoSymref(git, ref);
  const options = [
    ...(setUpstream ? ['--set-upstream'] : []),
    ...leases.map((l) => `--force-with-lease=${l.ref}:${l.expect ?? ''}`),
  ];
  const r = await netRun(git, ['push', '--porcelain', '--no-follow-tags', ...options, '--end-of-options', remote, ...refspecs], { okExit: [0, 1, 128] });
  const parsed = parsePushPorcelain(decoder.decode(r.stdout));
  const reported = parsed.updated.length + parsed.rejected.length + parsed.upToDate.length;
  if (r.exitCode !== 0 && !reported) throw remoteFailure(remote, r, 'push');
  return splitRequested(parsed, refspecs.map((s) => s.slice(s.indexOf(':') + 1)));
}

/** Rejected refs named in a PUSH_REJECTED message; the rest are counted (all are in `rejected`). */
const REJECTED_NAMED = 5;

/**
 * Every local ref a push of `refspecs` to `remote` may update: each destination (branch or tag: git updates either)
 * mapped through the fetch config (tracking.js), all of them under refs/remotes/ (assertPushTracking). A ref mapped to
 * the refspec's own source is left out: git writes it the value it just pushed from it (a tag pushed under
 * `+refs/tags/*:refs/tags/*`), never another ref's.
 */
async function trackingRefsOfPush(git, remote, refspecs) {
  const specs = await fetchSpecs(git, remote);
  const out = new Set();
  for (const spec of refspecs) {
    const i = spec.indexOf(':');
    const src = spec.slice(0, i);
    const mapped = trackingMapFor(specs, spec.slice(i + 1)).filter((m) => m.dst !== src);
    assertPushTracking(remote, mapped);
    for (const m of mapped) out.add(m.dst);
  }
  return [...out];
}

/** PUSH_REJECTED with the rejected refs when a push changed nothing and refused something; the message names each ref and why. */
export function assertSomethingPushed(result, remote) {
  if (!result.updated.length && !result.upToDate.length && result.rejected.length) {
    const named = result.rejected.slice(0, REJECTED_NAMED).map((r) => `${r.ref}: ${r.reason}`).join('; ');
    const more = result.rejected.length > REJECTED_NAMED ? ` and ${result.rejected.length - REJECTED_NAMED} more` : '';
    throw new Refusal('PUSH_REJECTED', `${remote} rejected the push: ${named}${more}`, { rejected: result.rejected });
  }
}
