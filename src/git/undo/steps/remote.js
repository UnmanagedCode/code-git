import { isDeepStrictEqual } from 'node:util';
import { branchRemotes, pushDefaultOf, pushRemotesOf, remoteSnapshot, writeRemoteConfig } from '../../remote/config.js';
import { parseFetchRefspec, trackedSnapshot } from '../../remote/tracking.js';
import { stale } from './shared.js';

// `remote`: one remote's config — created (old null), changed, or removed (new null) by remote.add / edit / remove —
// written back from one record side to the other (docs/undo.md → Steps). Messages name the remote and the field, never
// a value: a url may hold a password.

const ends = (step, dir) => (dir === 'undo' ? { from: step.new, to: step.old } : { from: step.old, to: step.new });

/** The keys remoteSnapshot reads; remove's record also holds `pushRemotes` / `pushDefault` (what git cleared). */
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
  if (from?.pushRemotes) {
    // Exactly the recorded push keys, as upstreams: one added since would be left naming a removed remote.
    const now = await pushRemotesOf(git, name);
    const sorted = (list) => [...list].sort();
    if (!isDeepStrictEqual(sorted(now.pushRemotes), sorted(from.pushRemotes)) || now.pushDefault !== from.pushDefault) {
      throw stale(`the push remote config naming ${name} changed since`);
    }
  }
  if (from === null) {
    // Creating it back: the branch keys it restores must not have been set again meanwhile.
    const branches = await branchRemotes(git);
    for (const { branch } of to.upstreams) if (branches.get(branch)?.remote) throw stale(`${branch} has an upstream again`);
    for (const branch of to.pushRemotes ?? []) if (branches.get(branch)?.pushRemote) throw stale(`${branch} has a push remote again`);
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
