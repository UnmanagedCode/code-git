import { Refusal } from '../../refusals.js';
import { paramsObject } from '../params.js';
import { refEntries } from '../refs/resolve.js';
import { undoRecord } from '../refs/undo.js';
import { assertNotLegacy, listRemotes, remoteNames, remoteSnapshot } from '../remote/config.js';
import { remoteName } from '../remote/push.js';
import { assertNoTrackingSymrefs, fetchSpecs, trackedSnapshot } from '../remote/tracking.js';
import { newRemoteName, remoteUrl } from '../remote/url.js';

// Remote ops (docs/remotes.md, docs/protocol.md → Remote ops): the remotes' config, fetch, pull and branch push. Every
// name and url is checked before any exec; `--end-of-options` precedes every user-named argument.

const REMOTES = 'refs/remotes/';

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
];
