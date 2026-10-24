import { remoteNames, renameGates, renameRemote } from '../../remote/config.js';
import { stale } from './shared.js';

// `remoteRename`: a remote renamed back (undo) or again (redo) with `git remote rename`, under remote.rename's own gates,
// so its tracking refs and every branch key naming it follow (docs/undo.md → Steps).

const ends = (step, dir) => (dir === 'undo' ? { cur: step.to, next: step.from } : { cur: step.from, next: step.to });

async function preflight(git, step, dir) {
  const { cur, next } = ends(step, dir);
  const names = await remoteNames(git);
  if (!names.includes(cur)) throw stale(`there is no remote ${cur} any more`);
  if (names.includes(next)) throw stale(`a remote ${next} exists again`);
  const left = await git(['for-each-ref', '--count=1', '--format=%(refname)', '--end-of-options', `refs/remotes/${next}`]);
  if (left.stdout.length) throw stale(`refs/remotes/${next}/ holds refs again`);
  await renameGates(git, cur, next);
}

async function apply(git, step, dir) {
  const { cur, next } = ends(step, dir);
  await renameRemote(git, cur, next);
}

export const remoteRename = { kind: 'remoteRename', preflight, apply };
