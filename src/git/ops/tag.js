import { Refusal } from '../../refusals.js';
import { commitOid } from '../diff/source.js';
import { paramsObject } from '../params.js';
import { nameList, shortBranch } from '../refs/check.js';
import { REF_LIMITS } from '../refs/limits.js';
import { tagObjects } from '../refs/resolve.js';
import { undoRecord } from '../refs/undo.js';
import { assertSomethingPushed, knownRemote, push, remoteName } from '../remote/push.js';
import { assertOid } from '../validate.js';

// Tag ops (docs/refs.md). A tag's recorded oid is its tag object (unpeeled), so a deleted annotated tag can be
// restored with its message. The network ops are cancellable for the reason given on branch.deleteRemote.

const TAGS = 'refs/tags/';
const tagRef = (n) => `${TAGS}${n}`;
const shortOf = (ref) => ref.slice(TAGS.length);

/** Every name in `names` exists as a tag, else REF_UNKNOWN; → Map(name → object id). */
async function existingTags(git, names) {
  const found = await tagObjects(git, names);
  const missing = names.filter((n) => !found.has(n));
  if (missing.length) throw new Refusal('REF_UNKNOWN', `no tag ${missing.join(', ')}`, { names: missing });
  return found;
}

export const ops = [
  {
    name: 'tag.create',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['name', 'oid', 'message'], 'tag.create');
      if (p.message !== undefined && (typeof p.message !== 'string' || p.message.includes('\0'))) throw new Refusal('BAD_PARAMS', 'message must be a string without NUL');
      if (p.message !== undefined && Buffer.byteLength(p.message) > REF_LIMITS.tagMessageMaxBytes) {
        throw new Refusal('BAD_PARAMS', `message is over ${REF_LIMITS.tagMessageMaxBytes} bytes`);
      }
      return { name: shortBranch(p.name), oid: assertOid(p.oid), message: p.message?.trim() ? p.message : null };
    },
    async run(git, { name, oid, message }) {
      if ((await tagObjects(git, [name])).has(name)) throw new Refusal('REF_EXISTS', `tag ${name} already exists`);
      if (await commitOid(git, oid) !== oid) throw new Refusal('REV_UNKNOWN', `${oid} is not a commit`);
      // A message is annotated, byte for byte (verbatim: no comment stripping); the config's tag.gpgSign still applies.
      if (message) await git(['tag', '-a', '--cleanup=verbatim', '-F', '-', '--end-of-options', name, oid], { stdin: message });
      else await git(['tag', '--end-of-options', name, oid]);
      const object = (await tagObjects(git, [name])).get(name);
      return { ref: tagRef(name), oid: object, undo: undoRecord({ refs: [{ ref: tagRef(name), old: null, new: object }] }) };
    },
  },
  {
    name: 'tag.delete',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['names'], 'tag.delete');
      return { names: nameList(p.names, 'names') };
    },
    async run(git, { names }) {
      const found = await existingTags(git, names);
      await git(['tag', '-d', '--end-of-options', ...names]);
      return { deleted: names, undo: undoRecord({ refs: names.map((n) => ({ ref: tagRef(n), old: found.get(n), new: null })) }) };
    },
  },
  {
    name: 'tag.push',
    kind: 'write',
    cancellable: true,
    params(raw) {
      const p = paramsObject(raw, ['remote', 'names'], 'tag.push');
      return { remote: remoteName(p.remote), names: nameList(p.names, 'names') };
    },
    async run(git, { remote, names }) {
      await knownRemote(git, remote);
      const found = await existingTags(git, names);
      // Never forced: a tag that differs on the remote is rejected, not overwritten.
      const result = await push(git, remote, names.map((n) => `${tagRef(n)}:${tagRef(n)}`));
      assertSomethingPushed(result, remote);
      const pushed = result.updated.map((u) => shortOf(u.ref));
      return {
        pushed, upToDate: result.upToDate.map(shortOf), rejected: result.rejected, unrequested: result.unrequested,
        undo: undoRecord({ remoteRefs: pushed.map((n) => ({ remote, ref: tagRef(n), old: null, new: found.get(n) })) }),
      };
    },
  },
  {
    name: 'tag.deleteRemote',
    kind: 'write',
    cancellable: true,
    params(raw) {
      const p = paramsObject(raw, ['remote', 'names'], 'tag.deleteRemote');
      return { remote: remoteName(p.remote), names: nameList(p.names, 'names') };
    },
    async run(git, { remote, names }) {
      await knownRemote(git, remote);
      // The best-known old value: the local tag of that name, if any.
      const local = await tagObjects(git, names);
      const result = await push(git, remote, names.map((n) => `:${tagRef(n)}`));
      assertSomethingPushed(result, remote);
      const deleted = result.updated.filter((u) => u.flag === '-').map((u) => shortOf(u.ref));
      return {
        deleted, rejected: result.rejected, unrequested: result.unrequested,
        undo: undoRecord({ remoteRefs: deleted.map((n) => ({ remote, ref: tagRef(n), old: local.get(n) ?? null, new: null })) }),
      };
    },
  },
];
