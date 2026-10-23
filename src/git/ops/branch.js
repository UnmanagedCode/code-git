import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { parseRemotes, splitRemoteRef } from '../parse/graph.js';
import { parseTracking } from '../parse/refs.js';
import { optBool, paramsObject } from '../params.js';
import { fullRef, nameList, shortBranch } from '../refs/check.js';
import { assertCcAck, assertCcHeadAck, assertNotCheckedOut, assertNotSymbolic, isCcOwned, ownHead, readHeads } from '../refs/heads.js';
import { assertNoSymref, refEntries, refObjects } from '../refs/resolve.js';
import { assertSomethingPushed, knownRemote, push, remoteName } from '../remote/push.js';
import { fetchSpecs, trackingRefsFor } from '../remote/tracking.js';
import { undoRecord } from '../refs/undo.js';
import { casUpdate, guardOverwrite } from '../refs/write.js';
import { plans } from '../undo/plans.js';
import { assertOid } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Branch ops (docs/refs.md, docs/protocol.md → Branch, tag and HEAD ops). Every name and oid is checked before any
// exec; `--end-of-options` precedes every user-named argument. Each write returns `undo` (src/git/refs/undo.js).

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout);
const HEADS = 'refs/heads/';
const local = (short) => `${HEADS}${short}`;
const shortOf = (ref) => ref.slice(HEADS.length);

function noParams(raw, op) {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) {
    throw new Refusal('BAD_PARAMS', `${op} takes no params`);
  }
  return {};
}

/** `name`'s entry in `heads`, or REF_UNKNOWN. */
function headOf(heads, ref) {
  const h = heads.get(ref);
  if (!h) throw new Refusal('REF_UNKNOWN', `no branch ${shortOf(ref)}`);
  return h;
}

/** A name readHeads did not list: SYMBOLIC_REF when it is a dangling symbolic ref, else REF_UNKNOWN. */
async function assertListed(git, heads, ref) {
  if (heads.has(ref)) return;
  await assertNoSymref(git, ref);
  headOf(heads, ref);
}

/** headOf, refusing a symbolic ref (SYMBOLIC_REF): the subject of a ref write must be the branch itself. */
function plainHeadOf(heads, ref) {
  const h = headOf(heads, ref);
  assertNotSymbolic(ref, h);
  return h;
}

/** `oid` names a commit, or REV_UNKNOWN. */
async function assertCommit(git, oid) {
  if (await commitOid(git, oid) !== oid) throw new Refusal('REV_UNKNOWN', `${oid} is not a commit`);
}

/** Exit 0 of `merge-base --is-ancestor` → true, 1 → false. */
async function isAncestor(git, a, b) {
  return (await git(['merge-base', '--is-ancestor', a, b], { okExit: [0, 1] })).exitCode === 0;
}

const headMove = (own, branch, oid) => ({ old: { branch: own.branch, oid: own.oid }, new: { branch, oid } });

/** Switches this checkout to local branch `short` (CHECKOUT_CONFLICT when local changes would be overwritten). */
const switchTo = (git, short) => guardOverwrite(git, ['switch', '--no-guess', '--end-of-options', short], { okExit: [0] });

/** A remote-tracking ref → its local branch: create a tracking one, or switch to the existing one (fast-forwarding it when it tracks `ref`). */
async function checkoutRemote(git, ref, { heads, own, ccOwned }) {
  const remotes = parseRemotes(text(await git(['remote'])));
  const { branch } = splitRemoteRef(ref, remotes);
  const remote = (await refEntries(git, [ref])).get(ref);
  if (!remote) throw new Refusal('REF_UNKNOWN', `no remote branch ${ref.slice('refs/remotes/'.length)}`);
  // refs/remotes/<r>/HEAD and other aliases: checking one out would check out its target under another name.
  assertNotSymbolic(ref, remote);
  shortBranch(branch);
  const remoteOid = remote.oid;
  const localRef = local(branch);
  const existing = heads.get(localRef);
  assertNotSymbolic(localRef, existing);
  const result = { branch: localRef, created: false, localExisted: Boolean(existing), fastForwarded: false, ffBlocked: null };
  if (!existing) {
    assertCcHeadAck(own, ccOwned);
    await guardOverwrite(git, ['switch', '--no-guess', '--track', '-c', branch, '--end-of-options', ref]);
    return { ...result, created: true, undo: undoRecord({ refs: [{ ref: localRef, old: null, new: remoteOid, upstream: ref }], head: headMove(own, localRef, remoteOid) }) };
  }
  // Already on it: nothing switches, so only a fast-forward can move HEAD — additive, no cc acknowledgement.
  const switching = own.branch !== localRef;
  if (switching) {
    assertCcHeadAck(own, ccOwned);
    assertNotCheckedOut(heads, localRef);
    await switchTo(git, branch);
  }
  const head = switching ? headMove(own, localRef, existing.oid) : null;
  const ff = existing.upstream === ref && existing.oid !== remoteOid && await isAncestor(git, existing.oid, remoteOid);
  if (!ff) return { ...result, undo: undoRecord({ head }) };
  try {
    await guardOverwrite(git, ['merge', '--ff-only', '--end-of-options', remoteOid]);
  } catch (e) {
    // The switch stands; local changes keep the branch where it was.
    if (e.code !== 'CHECKOUT_CONFLICT') throw e;
    return { ...result, ffBlocked: e.extra.files, undo: undoRecord({ head }) };
  }
  return {
    ...result, fastForwarded: true,
    undo: undoRecord({ refs: [{ ref: localRef, old: existing.oid, new: remoteOid }], head: headMove(own, localRef, remoteOid) }),
  };
}

export const ops = [
  {
    name: 'branch.tracking',
    kind: 'read',
    params: (raw) => noParams(raw, 'branch.tracking'),
    async run(git) {
      const [refs, remotes] = await Promise.all([
        git(['for-each-ref', '--format=%(refname)%00%(upstream)%00%(upstream:track,nobracket)', 'refs/heads']),
        git(['remote']),
      ]);
      return { remotes: parseRemotes(text(remotes)), branches: parseTracking(text(refs)) };
    },
  },
  {
    name: 'branch.create',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'from', 'checkout', 'ccOwned'], 'branch.create');
      return {
        name: shortBranch(p.name), from: p.from === undefined ? null : assertOid(p.from),
        checkout: optBool(p.checkout, 'checkout'), ccOwned: optBool(p.ccOwned, 'ccOwned'),
      };
    },
    async run(git, { name, from, checkout, ccOwned }) {
      // A checkout writes the working tree and the index: never a bare repository's own files (src/git/worktree.js).
      if (checkout) await assertWorktree(git);
      const ref = local(name);
      const [heads, own] = await Promise.all([readHeads(git), ownHead(git)]);
      if (heads.has(ref)) throw new Refusal('REF_EXISTS', `branch ${name} already exists`);
      // A dangling symbolic ref is not listed above, and git would create its target under this name.
      await assertNoSymref(git, ref);
      const oid = from ?? own.oid;
      if (!oid) throw new Refusal('NO_HEAD', 'HEAD has no commit to branch from');
      if (checkout) assertCcHeadAck(own, ccOwned);
      if (from) await assertCommit(git, from);
      if (checkout) await guardOverwrite(git, ['switch', '--no-guess', '--no-track', '-c', name, '--end-of-options', oid]);
      else await git(['branch', '--no-track', '--end-of-options', name, oid]);
      return {
        ref, oid, checkedOut: checkout,
        undo: undoRecord({ refs: [{ ref, old: null, new: oid }], head: checkout ? headMove(own, ref, oid) : null }),
      };
    },
    undo: plans.create,
  },
  {
    name: 'branch.checkout',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['ref', 'ccOwned'], 'branch.checkout');
      return { ref: fullRef(p.ref, [HEADS, 'refs/remotes/']), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { ref, ccOwned }) {
      await assertWorktree(git);
      const [heads, own] = await Promise.all([readHeads(git), ownHead(git)]);
      if (!ref.startsWith(HEADS)) return checkoutRemote(git, ref, { heads, own, ccOwned });
      const result = { branch: ref, created: false, localExisted: true, fastForwarded: false, ffBlocked: null };
      if (own.branch === ref) return { ...result, undo: undoRecord() };
      const h = plainHeadOf(heads, ref);
      assertCcHeadAck(own, ccOwned);
      assertNotCheckedOut(heads, ref);
      await switchTo(git, shortOf(ref));
      return { ...result, undo: undoRecord({ head: headMove(own, ref, h.oid) }) };
    },
    undo: plans.checkout,
  },
  {
    name: 'branch.rename',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'newName', 'ccOwned'], 'branch.rename');
      return { name: shortBranch(p.name), newName: shortBranch(p.newName), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { name, newName, ccOwned }) {
      const [heads, own] = await Promise.all([readHeads(git), ownHead(git)]);
      const ref = local(name);
      const to = local(newName);
      await assertListed(git, heads, ref);
      const h = plainHeadOf(heads, ref);
      if (heads.has(to)) throw new Refusal('REF_EXISTS', `branch ${newName} already exists`);
      await assertNoSymref(git, to);
      // cc's worktree record names a checked-out cc branch: renaming it breaks cc even in its own checkout.
      assertNotCheckedOut(heads, ref, { allowOwn: !isCcOwned(name), own });
      assertCcAck([name, newName], ccOwned);
      await git(['branch', '-m', '--end-of-options', name, newName]);
      return {
        ref: to,
        undo: undoRecord({
          refs: [{ ref, old: h.oid, new: null }, { ref: to, old: null, new: h.oid }],
          head: own.branch === ref ? headMove(own, to, h.oid) : null,
        }),
      };
    },
    undo: plans.rename,
  },
  {
    name: 'branch.delete',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['names', 'force', 'ccOwned'], 'branch.delete');
      return { names: nameList(p.names, 'names'), force: optBool(p.force, 'force'), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { names, force, ccOwned }) {
      const heads = await readHeads(git);
      // Every name is checked first: one bad name refuses the request before anything is deleted.
      for (const n of names) {
        // A live symbolic ref is deleted alone (below); a dangling one is refused, never reported unknown.
        await assertListed(git, heads, local(n));
        assertNotCheckedOut(heads, local(n));
      }
      assertCcAck(names, ccOwned);
      const r = await git(['branch', force ? '-D' : '-d', '--end-of-options', ...names], { okExit: [0, 1] });
      const stderr = decoder.decode(r.stderr);
      // git deletes what it can and reports the rest: the refs, re-read, are the truth.
      const after = await readHeads(git);
      const deleted = [];
      const notMerged = [];
      for (const n of names) {
        if (!after.has(local(n))) deleted.push(n);
        else if (stderr.includes(`'${n}' is not fully merged`)) notMerged.push(n);
        else throw new Refusal('GIT_FAILED', `git branch did not delete ${n}`, { exitCode: r.exitCode, stderr });
      }
      return {
        deleted, notMerged,
        // A symbolic ref is deleted alone (its target stays): its undo names the target, not the target's oid.
        undo: undoRecord({
          refs: deleted.map((n) => {
            const h = heads.get(local(n));
            return h.symref
              ? { ref: local(n), old: null, new: null, symref: h.symref }
              : { ref: local(n), old: h.oid, new: null, upstream: h.upstream };
          }),
        }),
      };
    },
    undo: plans.deleteBranches,
  },
  {
    name: 'branch.deleteRemote',
    kind: 'write',
    // Each remote ref update is atomic on the remote: an abort leaves at most unreferenced objects there and a stale
    // remote-tracking ref here, never a half-changed index or worktree. Cancel also frees a hung SSH session.
    cancellable: true,
    params(raw) {
      const p = paramsObject(raw, ['remote', 'branches', 'ccOwned'], 'branch.deleteRemote');
      return { remote: remoteName(p.remote), branches: nameList(p.branches, 'branches'), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { remote, branches, ccOwned }) {
      await knownRemote(git, remote);
      assertCcAck(branches, ccOwned);
      // The tracking ref git deletes with each branch: the first the remote's fetch refspecs map it to (tracking.js).
      const specs = await fetchSpecs(git, remote);
      const trackingOf = new Map(branches.map((b) => [b, trackingRefsFor(specs, local(b))[0] ?? null]));
      const before = await refObjects(git, [...trackingOf.values()].filter(Boolean));
      const result = await push(git, remote, branches.map((b) => `:${HEADS}${b}`));
      assertSomethingPushed(result, remote);
      const deleted = result.updated.filter((u) => u.flag === '-').map((u) => shortOf(u.ref));
      return {
        deleted, rejected: result.rejected, unrequested: result.unrequested,
        undo: undoRecord({
          remoteRefs: deleted.map((b) => {
            const tracking = trackingOf.get(b);
            return { remote, ref: local(b), old: tracking ? before.get(tracking) ?? null : null, new: null, tracking };
          }),
        }),
      };
    },
  },
  {
    name: 'branch.setUpstream',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'upstream'], 'branch.setUpstream');
      if (p.upstream === undefined) throw new Refusal('BAD_PARAMS', 'upstream is required (null unsets it)');
      return { name: shortBranch(p.name), upstream: p.upstream === null ? null : fullRef(p.upstream, ['refs/remotes/']) };
    },
    async run(git, { name, upstream }) {
      const heads = await readHeads(git);
      const previous = plainHeadOf(heads, local(name)).upstream;
      if (upstream) {
        if (!(await refObjects(git, [upstream])).has(upstream)) throw new Refusal('REF_UNKNOWN', `no remote branch ${upstream.slice('refs/remotes/'.length)}`);
        await git(['branch', `--set-upstream-to=${upstream}`, '--end-of-options', name]);
      } else if (previous) {
        await git(['branch', '--unset-upstream', '--end-of-options', name]);
      }
      return { name, upstream, previous };
    },
  },
  {
    name: 'branch.fastForward',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'to', 'expect'], 'branch.fastForward');
      return { name: shortBranch(p.name), to: assertOid(p.to), expect: assertOid(p.expect) };
    },
    async run(git, { name, to, expect }) {
      const ref = local(name);
      const [heads, own] = await Promise.all([readHeads(git), ownHead(git)]);
      const h = plainHeadOf(heads, ref);
      if (h.oid !== expect) throw new Refusal('REF_MOVED', `${name} is no longer at ${expect}`);
      assertNotCheckedOut(heads, ref, { allowOwn: true, own });
      if (to === expect) return { upToDate: true, undo: undoRecord() };
      if (!(await isAncestor(git, expect, to))) throw new Refusal('NOT_FAST_FORWARD', `${name} cannot be fast-forwarded to ${to}`);
      const isOwn = own.branch === ref;
      // This checkout's branch fast-forwards with `merge --ff-only`, which updates the working tree; a free one is a ref update.
      if (isOwn) await assertWorktree(git);
      if (isOwn) await guardOverwrite(git, ['merge', '--ff-only', '--end-of-options', to]);
      else await casUpdate(git, ref, to, expect, 'code-git: fast-forward');
      return {
        upToDate: false,
        undo: undoRecord({ refs: [{ ref, old: expect, new: to }], head: isOwn ? headMove(own, ref, to) : null }),
      };
    },
    undo: plans.fastForward,
  },
  {
    name: 'branch.move',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'to', 'expect', 'ccOwned'], 'branch.move');
      return { name: shortBranch(p.name), to: assertOid(p.to), expect: assertOid(p.expect), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { name, to, expect, ccOwned }) {
      const ref = local(name);
      const heads = await readHeads(git);
      plainHeadOf(heads, ref);
      // This checkout's own branch moves with head.reset, which also decides what happens to the index and worktree.
      assertNotCheckedOut(heads, ref);
      assertCcAck([name], ccOwned);
      await assertCommit(git, to);
      await casUpdate(git, ref, to, expect, 'code-git: reset');
      return { undo: undoRecord({ refs: [{ ref, old: expect, new: to }] }) };
    },
    undo: plans.move,
  },
];
