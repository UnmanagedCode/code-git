import { Refusal } from '../../refusals.js';
import { checkSettings, DEFAULT_PREFIXES, flowSettings, KEYS, readFlowConfig, TYPES } from '../flow/config.js';
import { bad, optBool, paramsObject } from '../params.js';
import { shortBranch } from '../refs/check.js';
import { assertCcHeadAck, assertNotCheckedOut, assertNotSymbolic, isCcOwned, ownHead, readHeads } from '../refs/heads.js';
import { REF_LIMITS } from '../refs/limits.js';
import { assertNoSymref, tagObjects } from '../refs/resolve.js';
import { guardOverwrite } from '../refs/write.js';
import { merge } from '../remote/integrate.js';
import { assertClean, assertNoOperation } from '../sequence/guard.js';
import { SEQUENCE_LIMITS } from '../sequence/limits.js';
import { assertGitAtLeast } from '../stash/version.js';
import { assertOid, assertRefName } from '../validate.js';
import { assertWorktree } from '../worktree.js';

// Git-flow (docs/gitflow.md): nvie's branching model run as plain branch, merge and tag commands — never the git-flow
// extension. Writes without an undo: the journal clears the slots. `--end-of-options` precedes every user-named argument.

const decoder = new TextDecoder('utf-8', { fatal: false });
const HEADS = 'refs/heads/';
const local = (short) => `${HEADS}${short}`;
/** What a finish merges the flow branch into, in nvie's order; the tag goes on main after its merge. */
const MERGE_INTO = { feature: ['develop'], release: ['main', 'develop'], hotfix: ['main', 'develop'] };
/** Where start branches from. */
const BASE = { feature: 'develop', release: 'develop', hotfix: 'main' };
const tagged = (type) => type !== 'feature';
const FILES_SHOWN = 100;

function flowType(v) {
  if (!TYPES.includes(v)) throw bad(`type must be one of ${TYPES.join(', ')}`);
  return v;
}

/** `heads`' entry for local branch `short`: REF_UNKNOWN when missing, SYMBOLIC_REF when an alias. */
function plainHead(heads, short) {
  const h = heads.get(local(short));
  if (!h) throw new Refusal('REF_UNKNOWN', `no branch ${short}`);
  assertNotSymbolic(local(short), h);
  return h;
}

/** The flow branch for `type` + `name`: a valid branch name, never under code-conductor/. */
function flowBranch(settings, type, name) {
  const branch = shortBranch(`${settings.prefixes[type]}${name}`);
  if (isCcOwned(branch)) throw new Refusal('BAD_REF', `${branch} is under code-conductor/: cc owns those branches`);
  return branch;
}

/** The version tag a release or hotfix `name` gets: REF_EXISTS when it exists, SYMBOLIC_REF when an alias does. */
async function assertTagFree(git, tag) {
  assertRefName(tag);
  if ((await tagObjects(git, [tag])).has(tag)) throw new Refusal('REF_EXISTS', `tag ${tag} already exists`);
  await assertNoSymref(git, `refs/tags/${tag}`);
}

/** Conflicted paths `merge-tree --write-tree -z --name-only` lists after the tree id (exit 1); [] for a clean merge. */
async function preflight(git, into, oid) {
  const r = await git(['merge-tree', '--write-tree', '-z', '--name-only', '--no-messages', '--end-of-options', into, oid], { okExit: [0, 1] });
  if (r.exitCode === 0) return [];
  return decoder.decode(r.stdout).split('\0').slice(1).filter(Boolean);
}

export const ops = [
  {
    name: 'flow.config',
    kind: 'read',
    params(raw) {
      paramsObject(raw ?? {}, [], 'flow.config');
      return {};
    },
    async run(git) {
      const [config, heads, own] = await Promise.all([readFlowConfig(git), readHeads(git), ownHead(git)]);
      const main = ['main', 'master'].find((b) => heads.has(local(b))) ?? (own.branch?.startsWith(HEADS) ? own.branch.slice(HEADS.length) : null);
      return { ...config, defaults: { main, develop: 'develop', prefixes: { ...DEFAULT_PREFIXES } } };
    },
  },
  {
    name: 'flow.init',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['main', 'develop', 'prefixes'], 'flow.init');
      if (p.prefixes !== null && typeof p.prefixes === 'object' && !Array.isArray(p.prefixes)) paramsObject(p.prefixes, [...TYPES, 'versionTag'], 'prefixes');
      return checkSettings(p);
    },
    async run(git, { main, develop, prefixes }) {
      const [heads, own] = await Promise.all([readHeads(git), ownHead(git)]);
      if (!own.oid) throw new Refusal('NO_HEAD', 'HEAD has no commit: make a first commit before initializing git-flow');
      const m = plainHead(heads, main);
      const existing = heads.get(local(develop));
      assertNotSymbolic(local(develop), existing);
      if (!existing) {
        await assertNoSymref(git, local(develop));
        await git(['branch', '--no-track', '--end-of-options', develop, m.oid]);
      }
      const values = { main, develop, ...prefixes };
      for (const k of Object.keys(KEYS)) await git(['config', '--local', '--end-of-options', KEYS[k], values[k]]);
      return { config: await readFlowConfig(git), createdDevelop: !existing };
    },
  },
  {
    name: 'flow.start',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['type', 'name', 'ccOwned'], 'flow.start');
      return { type: flowType(p.type), name: assertRefName(p.name), ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { type, name, ccOwned }) {
      await assertWorktree(git);
      const settings = await flowSettings(git);
      const branch = flowBranch(settings, type, name);
      const [heads, own] = await Promise.all([readHeads(git), ownHead(git)]);
      if (heads.has(local(branch))) throw new Refusal('REF_EXISTS', `branch ${branch} already exists`);
      await assertNoSymref(git, local(branch));
      const baseName = settings[BASE[type]];
      const base = plainHead(heads, baseName);
      if (tagged(type)) {
        // nvie: one release (or hotfix) at a time.
        const other = [...heads.keys()].find((ref) => ref.startsWith(local(settings.prefixes[type])));
        if (other) throw new Refusal('FLOW_EXISTS', `${other.slice(HEADS.length)} is still open: finish it first`, { branch: other.slice(HEADS.length) });
        await assertTagFree(git, `${settings.prefixes.versionTag}${name}`);
      }
      assertCcHeadAck(own, ccOwned);
      await guardOverwrite(git, ['switch', '--no-guess', '--no-track', '-c', branch, '--end-of-options', base.oid]);
      return { branch, base: baseName, oid: base.oid };
    },
  },
  {
    name: 'flow.finish',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['type', 'name', 'expect', 'tagMessage', 'ccOwned'], 'flow.finish');
      const type = flowType(p.type);
      const name = assertRefName(p.name);
      let tagMessage = null;
      if (tagged(type)) {
        if (typeof p.tagMessage !== 'string' || !p.tagMessage.trim() || p.tagMessage.includes('\0')) throw bad('a release or hotfix needs a tag message: non-blank, without NUL');
        if (Buffer.byteLength(p.tagMessage) > REF_LIMITS.tagMessageMaxBytes) throw bad(`tagMessage is over ${REF_LIMITS.tagMessageMaxBytes} bytes`);
        tagMessage = p.tagMessage;
      } else if (p.tagMessage !== undefined) {
        throw bad('a feature is not tagged: no tagMessage');
      }
      return { type, name, expect: assertOid(p.expect), tagMessage, ccOwned: optBool(p.ccOwned, 'ccOwned') };
    },
    async run(git, { type, name, expect, tagMessage, ccOwned }) {
      // Every gate before the first write: a refusal leaves refs, HEAD, the index and the worktree as they were.
      await assertWorktree(git);
      await assertNoOperation(git);
      await assertClean(git, 'commit or stash the local changes first: a finish switches branches and merges');
      await assertGitAtLeast(git, [2, 38], 'git-flow finish');
      const settings = await flowSettings(git);
      const branch = flowBranch(settings, type, name);
      const [heads, own] = await Promise.all([readHeads(git), ownHead(git)]);
      if (!heads.has(local(branch))) await assertNoSymref(git, local(branch));
      const tip = plainHead(heads, branch).oid;
      if (tip !== expect) throw new Refusal('REF_MOVED', `${branch} is no longer at ${expect}`);
      const into = MERGE_INTO[type].map((k) => settings[k]);
      const oids = new Map(into.map((b) => [b, plainHead(heads, b).oid]));
      // Switched to (main, develop) or deleted (the flow branch): another checkout must not have it. This one may.
      for (const b of [branch, ...into]) assertNotCheckedOut(heads, local(b), { allowOwn: true, own });
      assertCcHeadAck(own, ccOwned);
      const tag = tagged(type) ? `${settings.prefixes.versionTag}${name}` : null;
      if (tag) await assertTagFree(git, tag);
      for (const b of into) {
        const files = await preflight(git, oids.get(b), tip);
        if (files.length) {
          throw new Refusal('FLOW_CONFLICT', `merging ${branch} into ${b} would conflict: nothing was changed`, { into: b, files: files.slice(0, FILES_SHOWN) });
        }
      }

      const done = [];
      let current = { step: null, into: null };
      const stepped = async (step, b, fn) => {
        current = { step, into: b };
        const out = await fn();
        done.push(b ? { step, into: b } : { step });
        return out;
      };
      const merges = [];
      let tagResult = null;
      let deleted = false;
      try {
        let at = own.branch;
        for (const b of into) {
          if (at !== local(b)) {
            await stepped('switch', b, () => guardOverwrite(git, ['switch', '--no-guess', '--end-of-options', b]));
            at = local(b);
          }
          const before = (await ownHead(git)).oid;
          await stepped('merge', b, async () => {
            const r = await merge(git, tip, { mode: 'noFf', message: `Merge branch '${branch}'`, timeoutMs: SEQUENCE_LIMITS.timeoutMs });
            // The preflight said clean; a conflict now (a race, a merge driver) stays in progress for the Changes banner.
            if (r.conflicts) throw new Refusal('CONFLICTED', `merging ${branch} into ${b} stopped on conflicts`, { files: r.files.slice(0, FILES_SHOWN) });
          });
          const after = (await ownHead(git)).oid;
          merges.push({ into: b, outcome: after === before ? 'upToDate' : 'merged', oid: after });
          if (tag && b === settings.main) {
            await stepped('tag', null, () => git(['tag', '-a', '--cleanup=verbatim', '-F', '-', '--end-of-options', tag, after], { stdin: tagMessage }));
            tagResult = { name: tag, oid: (await tagObjects(git, [tag])).get(tag) };
          }
        }
        // Merged into develop (HEAD), so `-d` suffices; a refusal (exit 1) leaves the branch and is reported, not raised.
        await stepped('delete', null, () => git(['branch', '-d', '--end-of-options', branch], { okExit: [0, 1] }));
        deleted = !(await readHeads(git)).has(local(branch));
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        const cause = { code: e.code, message: e.message, stderr: e.extra?.stderr ?? null, ...(e.extra?.files ? { files: e.extra.files } : {}) };
        throw new Refusal('FLOW_INCOMPLETE', `the finish stopped at its ${current.step} step${current.into ? ` (${current.into})` : ''}: ${e.message}`, {
          step: current.step, ...(current.into ? { into: current.into } : {}), done, cause,
        });
      }
      return { branch, merges, tag: tagResult, deleted, head: settings.develop };
    },
  },
];
