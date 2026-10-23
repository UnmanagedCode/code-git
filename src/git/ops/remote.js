import { Refusal } from '../../refusals.js';
import { optBool, paramsObject } from '../params.js';
import { parseRecords } from '../parse/graph.js';
import { shortBranch } from '../refs/check.js';
import { assertCcAck, assertCcHeadAck, assertNotSymbolic, ownHead, readHeads } from '../refs/heads.js';
import { assertNoSymref, refEntries } from '../refs/resolve.js';
import { undoRecord } from '../refs/undo.js';
import { assertNotLegacy, listRemotes, multiValued, remoteNames, remoteSnapshot } from '../remote/config.js';
import { fetchRemote } from '../remote/fetch.js';
import { fastForward, merge, rebase } from '../remote/integrate.js';
import { netRun, remoteFailure } from '../remote/net.js';
import { assertSomethingPushed, knownRemote, push, remoteName } from '../remote/push.js';
import { assertNoTrackingSymrefs, fetchSpecs, trackedSnapshot, trackingRefsFor } from '../remote/tracking.js';
import { newRemoteName, remoteUrl } from '../remote/url.js';
import { assertClean, assertNoOperation } from '../sequence/guard.js';
import { assertOid } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Remote ops (docs/remotes.md, docs/protocol.md → Remote ops): the remotes' config, fetch, pull and branch push. Every
// name and url is checked before any exec; `--end-of-options` precedes every user-named argument.

const REMOTES = 'refs/remotes/';
const HEADS = 'refs/heads/';
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Refusals about one remote that a fetch of every remote reports per remote instead of stopping at. */
const PER_REMOTE = new Set(['REMOTE_AUTH_FAILED', 'REMOTE_UNREACHABLE', 'REMOTE_CONFIG_UNSUPPORTED', 'SYMBOLIC_REF', 'GIT_FAILED', 'GIT_TIMEOUT', 'OUTPUT_TOO_LARGE']);
const PULL_MODES = ['ff', 'ffOnly', 'rebase'];

/** Exit 0 of `merge-base --is-ancestor` → true, 1 → false. */
const isAncestor = async (git, a, b) => (await git(['merge-base', '--is-ancestor', a, b], { okExit: [0, 1] })).exitCode === 0;

/**
 * This checkout's branch and its upstream on a remote: {own, branch, upstream: tracking refname, remote}. NO_UPSTREAM
 * when HEAD is detached, the branch has no upstream, its upstream is local (`branch.<b>.remote = .`) or names no
 * configured remote, or its merge ref maps to no tracking ref; NO_HEAD when HEAD is unborn.
 */
async function headUpstream(git) {
  const own = await ownHead(git);
  if (!own.branch) throw new Refusal('NO_UPSTREAM', 'HEAD is detached: there is no branch to pull into');
  if (!own.oid) throw new Refusal('NO_HEAD', 'HEAD has no commit');
  const r = await git(['for-each-ref', '--format=%(upstream)%00%(upstream:remotename)', own.branch]);
  const [upstream = '', remote = ''] = parseRecords(decoder.decode(r.stdout), 2)[0] ?? [];
  const short = own.branch.slice(HEADS.length);
  if (!remote || remote === '.') throw new Refusal('NO_UPSTREAM', `${short} has no upstream on a remote`);
  if (!(await remoteNames(git)).includes(remote)) throw new Refusal('NO_UPSTREAM', `${short}'s upstream remote ${remote} is not a configured remote`);
  if (!upstream.startsWith(REMOTES)) throw new Refusal('NO_UPSTREAM', `${short}'s upstream maps to no remote-tracking ref`);
  return { own, branch: own.branch, upstream, remote };
}

/** `forceWithLease` → {expect: oid | null} (null: the branch must not exist on the remote), or null when absent. */
function leaseOf(v) {
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).join() !== 'expect') throw new Refusal('BAD_PARAMS', 'forceWithLease must be {expect: oid | null}');
  return { expect: v.expect === null ? null : assertOid(v.expect) };
}

/**
 * Where a push of local `branch` (short) goes: `remote` and `to` when given (`to` defaulting to `branch`), else the
 * branch's upstream (`branch.<b>.remote` / `.merge`, a branch on a configured remote) or NO_UPSTREAM.
 */
async function pushDestination(git, branch, remote, to) {
  if (remote) return { remote: await knownRemote(git, remote), to: to ?? branch };
  const r = await git(['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', `${HEADS}${branch}`]);
  const [up = '', merge = ''] = parseRecords(decoder.decode(r.stdout), 2)[0] ?? [];
  if (!up || up === '.' || !merge.startsWith(HEADS) || !(await remoteNames(git)).includes(up)) {
    throw new Refusal('NO_UPSTREAM', `${branch} has no upstream branch on a remote: name the remote to push to`);
  }
  return { remote: up, to: merge.slice(HEADS.length) };
}

/** The tracking ref here for branch `to` on `remote` and its oid (what the UI leases against), or null. */
async function trackingOf(git, remote, to) {
  const ref = trackingRefsFor(await fetchSpecs(git, remote), `${HEADS}${to}`)[0];
  const e = ref ? (await refEntries(git, [ref])).get(ref) : undefined;
  return e ? { ref, oid: e.oid } : null;
}

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
  if (multiValued(values)) {
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
  {
    name: 'remote.pull',
    kind: 'write',
    // Not cancellable: an abort mid-merge or mid-rebase would leave the checkout half-integrated. Its fetch still never
    // prompts and stops at NETWORK_LIMITS.timeoutMs.
    params(raw) {
      const p = paramsObject(raw, ['mode', 'ccOwned'], 'remote.pull');
      if (!PULL_MODES.includes(p.mode)) throw new Refusal('BAD_PARAMS', `mode must be one of ${PULL_MODES.join(', ')}`);
      return { mode: p.mode, ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { mode, ccOwned }) {
      await assertWorktree(git);
      await assertNoOperation(git);
      const { own, branch, upstream, remote } = await headUpstream(git);
      if (mode === 'rebase') {
        // A rebase rewrites the branch's commits; a fast-forward or merge only adds (as a commit does).
        assertCcHeadAck(own, ccOwned);
        await assertClean(git);
      }
      const fetched = await fetchRemote(git, remote);
      const oid = (await refEntries(git, [upstream])).get(upstream)?.oid;
      if (!oid) throw new Refusal('NO_UPSTREAM', `${upstream.slice(REMOTES.length)} is gone from ${remote}`);
      const result = (outcome, extra = {}) => ({ mode, upstream, outcome, files: [], oid: own.oid, fetch: fetched, undo: undoRecord({ refs: fetched.changes }), ...extra });
      if (oid === own.oid || await isAncestor(git, oid, own.oid)) return result('upToDate');
      const moved = async (outcome) => {
        const now = (await ownHead(git)).oid;
        return result(outcome, {
          oid: now,
          undo: undoRecord({
            refs: [...fetched.changes, { ref: branch, old: own.oid, new: now }],
            head: { old: { branch, oid: own.oid }, new: { branch, oid: now } },
          }),
        });
      };
      if (await isAncestor(git, own.oid, oid)) {
        await fastForward(git, oid);
        return moved('fastForward');
      }
      if (mode === 'ffOnly') throw new Refusal('NOT_FAST_FORWARD', `${branch.slice(HEADS.length)} and ${upstream.slice(REMOTES.length)} have diverged`);
      if (mode === 'rebase') {
        const r = await rebase(git, ['--end-of-options', oid]);
        return r.outcome === 'conflicts' ? result('conflicts', { files: r.files }) : moved('rebased');
      }
      const merged = await merge(git, oid, { mode: 'ff', message: `Merge remote-tracking branch '${upstream.slice(REMOTES.length)}'` });
      return merged.conflicts ? result('conflicts', { files: merged.files }) : moved('merged');
    },
  },
  {
    name: 'remote.push',
    kind: 'write',
    // As branch.deleteRemote: each remote ref update is atomic, so an abort leaves at most a stale tracking ref here.
    cancellable: true,
    params(raw) {
      const p = paramsObject(raw, ['branch', 'remote', 'to', 'setUpstream', 'forceWithLease', 'ccOwned'], 'remote.push');
      if (p.to !== undefined && p.remote === undefined) throw new Refusal('BAD_PARAMS', 'to needs remote');
      return {
        branch: shortBranch(p.branch),
        remote: p.remote === undefined ? null : remoteName(p.remote),
        to: p.to === undefined ? null : shortBranch(p.to),
        setUpstream: optBool(p.setUpstream, 'setUpstream'),
        lease: leaseOf(p.forceWithLease),
        ccOwned: optBool(p.ccOwned, 'ccOwned'),
      };
    },
    async run(git, { branch, remote: asked, to: askedTo, setUpstream, lease, ccOwned }) {
      const ref = `${HEADS}${branch}`;
      const heads = await readHeads(git);
      // A dangling symbolic ref is not listed; a live one would push its target under this name.
      if (!heads.has(ref)) await assertNoSymref(git, ref);
      if (!heads.has(ref)) throw new Refusal('REF_UNKNOWN', `no branch ${branch}`);
      assertNotSymbolic(ref, heads.get(ref));
      const { remote, to } = await pushDestination(git, branch, asked, askedTo);
      assertCcAck([...new Set([branch, to])], ccOwned);
      const dst = `${HEADS}${to}`;
      const result = await push(git, remote, [`${ref}:${dst}`], { setUpstream, leases: lease ? [{ ref: dst, expect: lease.expect }] : [] });
      try {
        assertSomethingPushed(result, remote);
      } catch (e) {
        // Where the push went and what the UI's force-with-lease confirmation shows and leases against.
        if (e.code === 'PUSH_REJECTED') Object.assign(e.extra, { remote, to, tracking: await trackingOf(git, remote, to) });
        throw e;
      }
      const done = result.updated.find((u) => u.ref === dst);
      const upToDate = result.upToDate.includes(dst);
      return {
        remote, branch, to,
        created: done?.flag === '*', forced: done?.flag === '+', upToDate,
        upstreamSet: setUpstream && (Boolean(done) || upToDate),
        unrequested: result.unrequested,
        // A push is never undone: the remote's previous value is not ours to restore.
        undo: undoRecord(),
      };
    },
  },
];
