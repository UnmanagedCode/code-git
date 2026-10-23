import { Refusal } from '../../refusals.js';

// The pushed rule (D3, docs/undo.md → Pushed): an undo of an op that created commits is refused when any of them is
// reachable from any remote-tracking ref, as the refs are now (no fetch first), whatever the upstream config says.

const decoder = new TextDecoder('utf-8', { fatal: false });
const lines = (r) => decoder.decode(r.stdout).split('\n').filter(Boolean);

/** UNDO_PUSHED ({refs}: the remote-tracking refs holding the newest pushed one) when a commit of `created` is on a remote. */
export async function assertNotPushed(git, { tip, not }) {
  const stdin = `${[tip, ...not.map((o) => `^${o}`)].join('\n')}\n`;
  const [all, unpushed] = await Promise.all([
    git(['rev-list', '--stdin'], { stdin }),
    git(['rev-list', '--stdin', '--not', '--remotes'], { stdin }),
  ]);
  const local = new Set(lines(unpushed));
  const pushed = lines(all).find((oid) => !local.has(oid));
  if (!pushed) return;
  const refs = lines(await git(['for-each-ref', '--format=%(refname)', `--contains=${pushed}`, 'refs/remotes/']));
  throw new Refusal('UNDO_PUSHED', `cannot undo: ${pushed.slice(0, 7)} is already on ${refs.map((r) => r.slice('refs/remotes/'.length)).join(', ') || 'a remote'}`, { refs, oid: pushed });
}
