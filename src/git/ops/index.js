import { Refusal } from '../../refusals.js';
import { ops as diff } from './diff.js';
import { ops as graph } from './graph.js';
import { ops as repo } from './repo.js';
import { ops as stage } from './stage.js';
import { ops as commit } from './commit.js';
import { ops as ignore } from './ignore.js';
import { ops as files } from './files.js';
import { ops as patch } from './patch.js';
import { ops as branch } from './branch.js';
import { ops as tag } from './tag.js';
import { ops as head } from './head.js';
import { ops as stash } from './stash.js';
import { ops as remote } from './remote.js';
import { ops as merge } from './merge.js';
import { ops as rebase } from './rebase.js';
import { ops as conflict } from './conflict.js';
import { ops as submodule } from './submodule.js';

// The op registry. A feature adds `ops/<feature>.js` exporting `ops = [{name, kind, cancellable?, params, run, undo?}]`
// and one entry in the list below. A write registers for undo with `undo(params, result) → UndoPlan | null` on its own
// definition (docs/undo.md → Registering an op).

const NAME_RE = /^[a-z]+\.[a-zA-Z]+$/;

/**
 * Validates op definitions and freezes them into a name → op map. `cancellable` defaults to
 * `kind === 'read'`: a write aborted mid-command can leave index.lock or a half-done rebase, so it opts in.
 */
export function buildRegistry(lists) {
  const map = new Map();
  for (const def of lists.flat()) {
    if (typeof def?.name !== 'string' || !NAME_RE.test(def.name)) throw new Error(`op registry: bad op name ${JSON.stringify(def?.name)}`);
    if (map.has(def.name)) throw new Error(`op registry: duplicate op ${def.name}`);
    if (def.kind !== 'read' && def.kind !== 'write') throw new Error(`op registry: ${def.name}: kind must be 'read' or 'write'`);
    if (def.cancellable !== undefined && typeof def.cancellable !== 'boolean') throw new Error(`op registry: ${def.name}: cancellable must be a boolean`);
    if (typeof def.params !== 'function' || typeof def.run !== 'function') throw new Error(`op registry: ${def.name}: params and run must be functions`);
    if (def.undo !== undefined && typeof def.undo !== 'function') throw new Error(`op registry: ${def.name}: undo must be a function`);
    if (def.undo !== undefined && def.kind !== 'write') throw new Error(`op registry: ${def.name}: only a write has an undo`);
    map.set(def.name, Object.freeze({ ...def, cancellable: def.cancellable ?? def.kind === 'read' }));
  }
  return map;
}

export const OPS = buildRegistry([repo, diff, graph, stage, commit, ignore, files, patch, branch, tag, head, stash, remote, merge, rebase, conflict, submodule]);

export function getOp(registry, name) {
  const op = registry.get(name);
  if (!op) throw new Refusal('UNKNOWN_OP', `unknown op ${JSON.stringify(name)}`);
  return op;
}
