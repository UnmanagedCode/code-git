import { Refusal } from '../../refusals.js';
import { ops as diff } from './diff.js';
import { ops as graph } from './graph.js';
import { ops as repo } from './repo.js';

// The op registry. A feature adds `ops/<feature>.js` exporting `ops = [{name, kind, cancellable?, params, run}]`
// and one entry in the list below.

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
    map.set(def.name, Object.freeze({ ...def, cancellable: def.cancellable ?? def.kind === 'read' }));
  }
  return map;
}

export const OPS = buildRegistry([repo, diff, graph]);

export function getOp(registry, name) {
  const op = registry.get(name);
  if (!op) throw new Refusal('UNKNOWN_OP', `unknown op ${JSON.stringify(name)}`);
  return op;
}
