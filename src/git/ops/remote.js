import { Refusal } from '../../refusals.js';
import { optBool, paramsObject } from '../params.js';
import { shortBranch } from '../refs/check.js';
import { refEntries } from '../refs/resolve.js';
import { undoRecord } from '../refs/undo.js';
import { assertNotLegacy, listRemotes, remoteNames, remoteSnapshot } from '../remote/config.js';
import { fetchRemote } from '../remote/fetch.js';
import { netRun, remoteFailure } from '../remote/net.js';
import { knownRemote, remoteName } from '../remote/push.js';
import { assertNoTrackingSymrefs, fetchSpecs, trackedSnapshot, trackingRefsFor } from '../remote/tracking.js';
import { newRemoteName, remoteUrl } from '../remote/url.js';

// Remote ops (docs/remotes.md, docs/protocol.md → Remote ops): the remotes' config, fetch, pull and branch push. Every
// name and url is checked before any exec; `--end-of-options` precedes every user-named argument.

const REMOTES = 'refs/remotes/';
const HEADS = 'refs/heads/';
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Refusals about one remote that a fetch of every remote reports per remote instead of stopping at. */
const PER_REMOTE = new Set(['REMOTE_AUTH_FAILED', 'REMOTE_UNREACHABLE', 'REMOTE_CONFIG_UNSUPPORTED', 'SYMBOLIC_REF', 'GIT_FAILED', 'GIT_TIMEOUT', 'OUTPUT_TOO_LARGE']);
const errorOf = (e) => ({ code: e.code, message: e.message, ...(e.extra.reason ? { reason: e.extra.reason } : {}), stderr: e.extra.stderr ?? null });

function noParams(raw, op) {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) {
    throw new Refusal('BAD_PARAMS', `${op} takes no params`);
  }
  return {};
}

/** REMOTE_EXISTS when `name` is already one of `git remote`'s. */
async function assertNewRemote(git, name) {
  if ((await remoteNames(git)).includes(name)) throw new Refusal('REMOTE_EXISTS', `a remote ${name} already exists`);
}

/** The remote-tracking refs (under refs/remotes/) the remote's fetch refspecs map, with symrefs; SYMBOLIC_REF for one other than its HEAD alias. */
async function trackingRefsOf(git, name) {
  const specs = await fetchSpecs(git, name);
  const snapshot = new Map([...await trackedSnapshot(git, specs)].filter(([ref]) => ref.startsWith(REMOTES)));
  assertNoTrackingSymrefs(snapshot, specs, name);
  return snapshot;
}

/** The single value of a url list an edit replaces; a remote with several (or a legacy file) is not one code-git edits. */
function assertSingle(name, values, what) {
  if (values.length > 1) {
    throw new Refusal('REMOTE_CONFIG_UNSUPPORTED', `${name} has ${values.length} ${what} values: edit them with git`, { remote: name, refspec: null });
  }
}

export const ops = [
  {
    name: 'remote.list',
    kind: 'read',
    params: (raw) => noParams(raw, 'remote.list'),
    run: async (git) => ({ remotes: await listRemotes(git) }),
  },
  {
    name: 'remote.add',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'url', 'pushUrl'], 'remote.add');
      return { name: newRemoteName(p.name), url: remoteUrl(p.url), pushUrl: p.pushUrl === undefined ? null : remoteUrl(p.pushUrl) };
    },
    async run(git, { name, url, pushUrl }) {
      await assertNewRemote(git, name);
      await git(['remote', 'add', '--end-of-options', name, url]);
      if (pushUrl) await git(['remote', 'set-url', '--push', '--end-of-options', name, pushUrl]);
      return { name, undo: undoRecord({ remotes: [{ name, old: null, new: await remoteSnapshot(git, name) }] }) };
    },
  },
  {
    name: 'remote.edit',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'url', 'pushUrl'], 'remote.edit');
      if (p.url === undefined && p.pushUrl === undefined) throw new Refusal('BAD_PARAMS', 'remote.edit needs url or pushUrl');
      return {
        name: remoteName(p.name),
        url: p.url === undefined ? undefined : remoteUrl(p.url),
        pushUrl: p.pushUrl === undefined || p.pushUrl === null ? p.pushUrl : remoteUrl(p.pushUrl),
      };
    },
    async run(git, { name, url, pushUrl }) {
      const old = await remoteSnapshot(git, name);
      await assertNotLegacy(git, name, old);
      // `remote set-url` without an old url replaces the one value; git refuses a list, and so does this op, before anything runs.
      if (url !== undefined) assertSingle(name, old.urls, 'url');
      if (pushUrl !== undefined) assertSingle(name, old.pushUrls, 'pushurl');
      if (url !== undefined) await git(['remote', 'set-url', '--end-of-options', name, url]);
      if (pushUrl) await git(['remote', 'set-url', '--push', '--end-of-options', name, pushUrl]);
      // 5: the key was not set.
      if (pushUrl === null) await git(['config', '--unset-all', `remote.${name}.pushurl`], { okExit: [0, 5] });
      return { name, undo: undoRecord({ remotes: [{ name, old, new: await remoteSnapshot(git, name) }] }) };
    },
  },
  {
    name: 'remote.rename',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'newName'], 'remote.rename');
      return { name: remoteName(p.name), newName: newRemoteName(p.newName) };
    },
    async run(git, { name, newName }) {
      const old = await remoteSnapshot(git, name);
      await assertNotLegacy(git, name, old);
      await assertNewRemote(git, newName);
      // git rewrites only this one refspec shape; any other would keep fetching into the old namespace.
      const standard = `+refs/heads/*:${REMOTES}${name}/*`;
      if (old.fetch.length !== 1 || old.fetch[0] !== standard) {
        throw new Refusal('REMOTE_CONFIG_UNSUPPORTED', `${name}'s fetch refspecs are not the default ${standard}: rename it with git`, { remote: name, refspec: old.fetch.join(' ') || null });
      }
      await trackingRefsOf(git, name);
      await git(['remote', 'rename', '--end-of-options', name, newName]);
      return {
        name: newName,
        undo: undoRecord({ remotes: [{ name, old, new: null }, { name: newName, old: null, new: await remoteSnapshot(git, newName) }] }),
      };
    },
  },
  {
    name: 'remote.remove',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name'], 'remote.remove');
      return { name: remoteName(p.name) };
    },
    async run(git, { name }) {
      const old = await remoteSnapshot(git, name);
      await assertNotLegacy(git, name, old);
      const tracking = await trackingRefsOf(git, name);
      await git(['remote', 'remove', '--end-of-options', name]);
      // git deletes the refs/remotes/ refs the refspecs map, except those another remote's refspecs also map: re-read.
      const left = await refEntries(git, [...tracking.keys()]);
      const deleted = [...tracking].filter(([ref]) => !left.has(ref));
      return {
        name,
        deletedRefs: deleted.map(([ref]) => ref),
        clearedUpstreams: old.upstreams,
        undo: undoRecord({
          refs: deleted.map(([ref, e]) => (e.symref ? { ref, old: null, new: null, symref: e.symref } : { ref, old: e.oid, new: null })),
          remotes: [{ name, old, new: null }],
        }),
      };
    },
  },
  {
    name: 'remote.fetch',
    kind: 'write',
    // Objects are written before refs and each ref update is atomic: an abort leaves a consistent subset of tracking refs
    // updated and at most a temporary pack, never a touched index or worktree. gc and maintenance are off (fetchArgs).
    cancellable: true,
    params(raw) {
      const p = paramsObject(raw, ['remote', 'prune'], 'remote.fetch');
      if (p.remote === undefined) throw new Refusal('BAD_PARAMS', 'remote is required (null fetches every remote)');
      return { remote: p.remote === null ? null : remoteName(p.remote), prune: optBool(p.prune, 'prune') };
    },
    async run(git, { remote, prune }) {
      if (remote !== null) {
        await knownRemote(git, remote);
        const one = await fetchRemote(git, remote, { prune });
        return { remotes: [one], undo: undoRecord({ refs: one.changes }) };
      }
      // A push-only remote (no url, no legacy file) has nothing to fetch.
      const names = (await listRemotes(git)).filter((r) => r.urls.length || r.legacy).map((r) => r.name);
      const remotes = [];
      for (const name of names) {
        try {
          remotes.push(await fetchRemote(git, name, { prune }));
        } catch (e) {
          if (!(e instanceof Refusal) || !PER_REMOTE.has(e.code)) throw e;
          remotes.push({ remote: name, error: errorOf(e) });
        }
      }
      return { remotes, undo: undoRecord({ refs: remotes.flatMap((r) => r.changes ?? []) }) };
    },
  },
  {
    name: 'remote.peek',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['remote', 'branch'], 'remote.peek');
      return { remote: remoteName(p.remote), branch: shortBranch(p.branch) };
    },
    async run(git, { remote, branch }) {
      await knownRemote(git, remote);
      const ref = `${HEADS}${branch}`;
      const trackingRef = trackingRefsFor(await fetchSpecs(git, remote), ref)[0] ?? null;
      const r = await netRun(git, ['ls-remote', '--refs', '--end-of-options', remote, ref], { okExit: [0, 128] });
      if (r.exitCode !== 0) throw remoteFailure(remote, r, 'ls-remote');
      // ls-remote matches the pattern as a path tail (`refs/heads/x` also matches `refs/heads/a/refs/heads/x`): exact name only.
      const oid = decoder.decode(r.stdout).split('\n').map((l) => l.split('\t')).find(([, name]) => name === ref)?.[0] ?? null;
      const tracked = trackingRef ? (await refEntries(git, [trackingRef])).get(trackingRef) : undefined;
      const tracking = tracked ? { ref: trackingRef, oid: tracked.oid } : null;
      return { oid, tracking, stale: oid !== (tracking?.oid ?? null) };
    },
  },
];
