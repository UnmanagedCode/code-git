import type { SubmoduleEntry } from '@/features/submodules/api';
import { OID } from './diffFixtures';
import { workdirWorld, type WorkdirWorld } from './workdirWorld';

// workdirWorld with a submodule list per target (`list`: the parent's and each submodule tab's differ); every submodule
// write is answered ok unless `answers` overrides it. `targets(op)`: the target each call sent.

export const HEAD = OID('5');
export const COMMITTED = OID('6');

/** A cloned, initialized submodule at `path`, checked out at what its parent committed. */
export const subEntry = (over: Partial<SubmoduleEntry> = {}): SubmoduleEntry => ({
  name: over.path ?? 'libs/a', path: 'libs/a', url: 'https://h/a.git', resolvedUrl: 'https://h/a.git', branch: null,
  initialized: true, populated: true, recorded: COMMITTED, committed: COMMITTED, head: COMMITTED,
  outOfSync: false, modified: false, untracked: false, added: false, conflicted: false, typeChanged: false, blocked: null, urlProblem: null, ...over,
});

export interface SubmoduleTarget { project: string; worktree?: string; sub?: string[] }

export function submoduleWorld(w: WorkdirWorld & { list?: (t: SubmoduleTarget) => SubmoduleEntry[] } = {}) {
  const x = workdirWorld({
    ...w,
    answers: { 'submodule.list': (_p: unknown, t: SubmoduleTarget) => ({ submodules: w.list?.(t) ?? [], truncated: false }), ...w.answers },
  });
  const targets = (name: string) => x.fetch.calls.filter((c) => c.url.pathname.endsWith(`/ops/${name}`)).map((c) => (c.body as { target: SubmoduleTarget }).target);
  return { ...x, targets };
}
