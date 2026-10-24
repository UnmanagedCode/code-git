import { isDeepStrictEqual } from 'node:util';
import { clearableKeys, localBranchKeys, pushDefaultClearable, pushDefaultOf, remoteSnapshot, writeRemoteConfig } from '../../remote/config.js';
import { parseFetchRefspec, trackedSnapshot } from '../../remote/tracking.js';
import { stale } from './shared.js';

// `remote`: one remote's config — created (old null), changed, or removed (new null) by remote.add / edit / remove —
// written back from one record side to the other (docs/undo.md → Steps). Messages name the remote and the field, never
// a value: a url may hold a password.

const ends = (step, dir) => (dir === 'undo' ? { from: step.new, to: step.old } : { from: step.old, to: step.new });

/** The keys remoteSnapshot reads; remove's record also holds `branchKeys` / `pushDefault` (what git cleared). */
const CONFIG_KEYS = ['urls', 'pushUrls', 'fetch', 'extra', 'upstreams'];
const configOf = (side) => (side === null ? null : Object.fromEntries(CONFIG_KEYS.map((k) => [k, side[k]])));

async function snapshotOrNull(git, name) {
  try {
    return await remoteSnapshot(git, name);
  } catch (e) {
    if (e.code === 'REMOTE_UNKNOWN') return null;
    throw e;
  }
}

async function preflight(git, step, dir, ctx) {
  const { from, to } = ends(step, dir);
  const { name } = step;
  if (!isDeepStrictEqual(configOf(await snapshotOrNull(git, name)), configOf(from))) throw stale(`remote ${name} changed since`);
  if (from?.branchKeys) {
    // Removing it again: git would clear exactly the recorded keys (one added since would be left naming a removed
    // remote; one changed since is not the record's to unset).
    const sorted = (keys) => keys.map(([k, v]) => `${k}\0${v}`).sort();
    if (!isDeepStrictEqual(sorted(await clearableKeys(git, name)), sorted(from.branchKeys)) || await pushDefaultClearable(git, name) !== from.pushDefault) {
      throw stale(`the branch or push config naming ${name} changed since`);
    }
  }
  if (from === null) {
    // Creating it back: no key it writes back may have been set again meanwhile (it would gain a second value).
    const set = new Set((await localBranchKeys(git)).map(([k]) => k));
    for (const [k] of to.branchKeys ?? []) if (set.has(k)) throw stale(`${k} is set again`);
    if (to.pushDefault && await pushDefaultOf(git) !== null) throw stale('remote.pushDefault is set again');
  }
  if (to === null) {
    // Removing its config: no tracking ref may be left under its fetch destinations (a fetch since wrote them), but the
    // ones an earlier step of this plan deletes.
    const specs = from.fetch.filter(Boolean).map((s) => parseFetchRefspec(name, s));
    for (const ref of (await trackedSnapshot(git, specs)).keys()) {
      if (ref.startsWith('refs/remotes/') && await ctx.refNow(ref) !== null) throw stale(`remote ${name} was fetched since`);
    }
  }
}

async function apply(git, step, dir) {
  const { from, to } = ends(step, dir);
  await writeRemoteConfig(git, step.name, from, to);
}

export const remote = { kind: 'remote', preflight, apply };
