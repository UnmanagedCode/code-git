import { maskUrls } from '../../mask.js';
import { netRun, remoteFailure } from './net.js';
import {
  assertFetchDestinations, assertNoTrackingSymrefs, fetchSpecs, isHeadAlias, newlyLiveSymrefs, trackedSnapshot,
} from './tracking.js';

// Fetching one remote: what remote.fetch runs per remote and remote.pull runs first, so both get the same checks.

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * The fetch command. Pruning is always explicit (`--prune` / `--no-prune`) and tags are never pruned
 * (`--no-prune-tags`), so `fetch.prune`, `fetch.pruneTags` and `remote.<r>.prune` delete nothing unasked;
 * `--no-recurse-submodules` overrides `fetch.recurseSubmodules`. gc and maintenance are off, so a cancel never kills one.
 */
export const fetchArgs = (remote, prune) => [
  '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
  'fetch', '--no-recurse-submodules', prune ? '--prune' : '--no-prune', '--no-prune-tags', '--end-of-options', remote,
];

/**
 * Fetches `remote` → {remote, changes: [{ref, old, new}], pruned: ref[], symrefsResolved: [{ref, target}], partial:
 * stderr | null}. Before anything runs: a refspec writing outside refs/remotes/ and refs/tags/ refuses
 * REMOTE_CONFIG_UNSUPPORTED, and a live symbolic ref among the refs it may write (not the remote's HEAD alias) refuses
 * SYMBOLIC_REF. A dangling one is invisible until a fetch writes its target: `symrefsResolved` names each symbolic ref
 * live after the fetch that was not before. `changes` are the plain refs created, moved or deleted (new null); git
 * exiting non-zero after changing some is `partial` (its stderr); after changing none, remoteFailure.
 */
export async function fetchRemote(git, remote, { prune = false } = {}) {
  const specs = await fetchSpecs(git, remote);
  assertFetchDestinations(remote, specs);
  const before = await trackedSnapshot(git, specs);
  assertNoTrackingSymrefs(before, specs, remote);
  const r = await netRun(git, fetchArgs(remote, prune), { okExit: [0, 1, 128] });
  const after = await trackedSnapshot(git, specs);
  const changes = [];
  for (const ref of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(ref);
    const a = after.get(ref);
    if (b?.symref || a?.symref) continue;
    if ((b?.oid ?? null) !== (a?.oid ?? null)) changes.push({ ref, old: b?.oid ?? null, new: a?.oid ?? null });
  }
  if (r.exitCode !== 0 && !changes.length) throw remoteFailure(remote, r, 'fetch');
  return {
    remote,
    changes,
    pruned: changes.filter((c) => c.new === null).map((c) => c.ref),
    symrefsResolved: newlyLiveSymrefs(before, after).filter((s) => !isHeadAlias(specs, s.ref, s.target)),
    partial: r.exitCode === 0 ? null : maskUrls(decoder.decode(r.stderr)),
  };
}
