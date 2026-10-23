import { Refusal } from '../../refusals.js';
import { assertRefName } from '../validate.js';

// C5 owns these (src/git/refs/check.js shortBranch, src/git/refs/heads.js ownHead / isCcOwned / assertCcHeadAck,
// src/git/refs/write.js guardOverwrite, src/git/parse/refs.js parseConflictFiles), copied unchanged because C5 had not
// landed when the stash card needed them. Whichever of the two lands second deletes this file and imports from there.

const decoder = new TextDecoder('utf-8', { fatal: false });
const text = (r) => decoder.decode(r.stdout).trim();
const CC_PREFIX = 'code-conductor/';

/** A branch or tag name without its `refs/…/` prefix. `HEAD` and a leading `refs/` would name something else. */
export function shortBranch(s) {
  assertRefName(s);
  if (s === 'HEAD' || s.startsWith('refs/')) throw new Refusal('BAD_REF', `invalid name: ${s === 'HEAD' ? 'HEAD' : 'starts with refs/'}`);
  return s;
}

/** This checkout's HEAD: {branch: refname | null (detached), oid: oid | null (unborn)}. */
export async function ownHead(git) {
  const [sym, oid] = await Promise.all([
    git(['symbolic-ref', '-q', 'HEAD'], { okExit: [0, 1] }),
    git(['rev-parse', '--verify', '-q', 'HEAD'], { okExit: [0, 1] }),
  ]);
  return { branch: sym.exitCode === 0 ? text(sym) || null : null, oid: oid.exitCode === 0 ? text(oid) || null : null };
}

/** A branch cc owns (its worktree records name it): `code-conductor/…`, short name. */
export const isCcOwned = (short) => short.startsWith(CC_PREFIX);

/** Throws CC_OWNED_BRANCH (`head: true`) when this checkout's HEAD is a cc-owned branch and the UI did not acknowledge moving it. */
export function assertCcHeadAck(own, ack) {
  const short = own.branch?.startsWith('refs/heads/') ? own.branch.slice('refs/heads/'.length) : null;
  if (short && isCcOwned(short) && ack !== true) {
    throw new Refusal('CC_OWNED_BRANCH', `this checkout is code-conductor's worktree on ${short}`, { branches: [short], head: true });
  }
}

const OVERWRITE_RE = /would be overwritten by|untracked working tree files would be/;

/**
 * The files git names after "… would be overwritten by checkout:" / "by merge:" / "untracked working tree files would be
 * overwritten…": the tab-indented lines that follow. [] when git said no such thing.
 */
export function parseConflictFiles(stderr) {
  const files = [];
  let inList = false;
  for (const line of stderr.split('\n')) {
    if (OVERWRITE_RE.test(line)) { inList = true; continue; }
    if (inList && line.startsWith('\t')) { files.push(line.slice(1)); continue; }
    inList = false;
  }
  return [...new Set(files)];
}

/** Runs `args`; git's "… would be overwritten" refusal becomes CHECKOUT_CONFLICT with the `files` it named and its `stderr`. */
export async function guardOverwrite(git, args, opts) {
  try {
    return await git(args, opts);
  } catch (e) {
    const files = e.code === 'GIT_FAILED' ? parseConflictFiles(e.extra.stderr ?? '') : [];
    if (files.length) throw new Refusal('CHECKOUT_CONFLICT', 'local changes would be overwritten', { files, stderr: e.extra.stderr });
    throw e;
  }
}
