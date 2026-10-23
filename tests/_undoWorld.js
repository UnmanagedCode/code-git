import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getOp, OPS } from '../src/git/ops/index.js';
import { createJournal } from '../src/git/undo/journal.js';
import { journalAround } from '../src/git/undo/record.js';
import { ctxFor, gitFor } from './_ctx.js';
import { refsWorld } from './_refsWorld.js';

// The world the undo tests share: refsWorld (a repo with `main` at `base`, a bare `origin`), with ops run as the ops
// route runs them — through journalAround, with one journal — and helpers that read the journal, undo and redo, and
// take an exact snapshot of the checkout's state.

export async function undoWorld(t) {
  const w = await refsWorld(t);
  const journal = createJournal();
  /**
   * Runs op `name` as routes/ops.js does: params checked, the journal around it, `{target, journal}` passed. `at`: a cc
   * worktree name, null for the main checkout, or `{worktree?, sub}` for a submodule target (its journal key only: git
   * runs in the checkout).
   */
  const op = async (name, params = {}, at = null) => {
    const def = getOp(OPS, name);
    const target = at !== null && typeof at === 'object' ? { project: 'repo', worktree: at.worktree ?? null, sub: at.sub } : { project: 'repo', worktree: at };
    const ctx = ctxFor(target, def.kind, { op: name, cancellable: def.cancellable });
    const p = def.params(params);
    return journalAround(journal, def, target, p, () => def.run(gitFor(ctx), p, { target, journal }));
  };
  const state = (worktree = null) => op('undo.state', {}, worktree);
  /** Undoes (redoes) the entry in the slot, with `extra` params (`ccOwned`). */
  const undo = async (extra = {}, worktree = null) => op('undo.undo', { id: (await state(worktree)).undo?.id ?? 1, ...extra }, worktree);
  const redo = async (extra = {}, worktree = null) => op('undo.redo', { id: (await state(worktree)).redo?.id ?? 1, ...extra }, worktree);
  return { ...w, journal, op, state, undo, redo, snap: (dir = w.repo.dir) => snapshot(w.repo, dir) };
}

/** Every file under `dir` but `.git`: content (a symlink: its target) and mode. */
function files(dir) {
  const out = {};
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      if (!rel && name === '.git') continue;
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(path.join(dir, r));
      if (st.isSymbolicLink()) out[r] = { link: fs.readlinkSync(path.join(dir, r)) };
      else if (st.isDirectory()) walk(r);
      else out[r] = { content: fs.readFileSync(path.join(dir, r), 'utf8'), exec: (st.mode & 0o111) !== 0 };
    }
  };
  walk('');
  return out;
}

/**
 * The checkout's whole state, exactly: HEAD (symbolic or detached), every ref with its target, the index (mode, oid,
 * stage, path), the worktree's files and the branch config (upstreams).
 */
export function snapshot(repo, dir) {
  const g = (...args) => { try { return repo.git('-C', dir, ...args); } catch { return null; } };
  return {
    head: g('symbolic-ref', '-q', 'HEAD') ?? `detached ${g('rev-parse', 'HEAD')}`,
    oid: g('rev-parse', '-q', '--verify', 'HEAD'),
    refs: g('for-each-ref', '--format=%(refname) %(objectname) %(symref)'),
    index: g('ls-files', '-s'),
    files: files(dir),
    branchConfig: g('config', '--get-regexp', '^branch\\.'),
  };
}

/** Runs `run` (the op), undoes it — the state is exactly the one before — and redoes it — exactly the one after. */
export async function roundTrip(w, run, { extra = {}, worktree = null, dir } = {}) {
  const before = w.snap(dir);
  const result = await run();
  const after = w.snap(dir);
  assert.notDeepEqual(after, before, 'the op changed something');
  const s = await w.state(worktree);
  assert.ok(s.undo, 'the op recorded an undo');
  const undone = await w.undo(extra, worktree);
  assert.deepEqual(w.snap(dir), before, 'undo restores the state before the op');
  assert.equal(undone.entry.id, s.undo.id);
  const s2 = await w.state(worktree);
  assert.equal(s2.undo, null);
  assert.equal(s2.redo.id, s.undo.id, 'the entry moved to the redo slot');
  await w.redo(extra, worktree);
  assert.deepEqual(w.snap(dir), after, 'redo restores the state after the op');
  const s3 = await w.state(worktree);
  assert.equal(s3.undo.id, s.undo.id, 'and it moved back to the undo slot');
  assert.equal(s3.redo, null);
  return { result, before, after, state: s };
}
