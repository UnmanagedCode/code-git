import type { DiffFile } from '@/features/diff/api';
import type { Stash } from '@/features/graph/types';
import { filesResult, OID } from './diffFixtures';
import { workdirWorld, type WorkdirWorld } from './workdirWorld';

// workdirWorld with stashes in graph.refs, and a diff.files answering a stash's W, I and U commits with their parents.

export const BASE = OID('a');
export const W = OID('c');
export const I = OID('d');
export const U = OID('e');
/** A stash with untracked files (three parents), at stash@{n}. */
export const stashFx = (over: Partial<Stash> = {}): Stash => ({ oid: W, parents: [BASE, I, U], selector: 'stash@{0}', time: 1, subject: 'On main: my work', ...over });

export function stashWorld(w: WorkdirWorld & { stashes?: Stash[]; commitFiles?: DiffFile[] } = {}) {
  const stashes = w.stashes ?? [stashFx()];
  const parentsOf = (rev: string): string[] => {
    for (const s of stashes) {
      if (s.oid === rev) return s.parents;
      if (s.parents.slice(1).includes(rev)) return rev === s.parents[1] ? [s.parents[0]] : [];
    }
    return [BASE];
  };
  return workdirWorld({
    ...w,
    answers: {
      'graph.refs': { head: { oid: BASE, branch: 'refs/heads/main', detached: false, unborn: false }, refs: [], stashes, worktrees: [], worktreesError: null },
      'diff.files': (p: { source: { kind: string; rev?: string } }) => {
        if (p.source.kind !== 'commit') {
          const kind = p.source.kind as 'unstaged' | 'staged';
          const pair = kind === 'unstaged'
            ? { old: { type: 'index' as const }, new: { type: 'worktree' as const } }
            : { old: { type: 'tree' as const, oid: BASE }, new: { type: 'index' as const } };
          return filesResult((kind === 'unstaged' ? w.unstaged : w.staged) ?? [], { pair, commit: null });
        }
        const rev = p.source.rev!;
        return filesResult(w.commitFiles ?? [], { commit: { oid: rev, parents: parentsOf(rev) } });
      },
      ...w.answers,
    },
  });
}
