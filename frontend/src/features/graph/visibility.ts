import type { GraphPrefs, Section } from '@/state/graphPrefs';
import type { Checkout, Ref, RefsResult } from './types';

export interface Visibility {
  /** Full refnames shown in the graph. */
  visible: Set<string>;
  /** The snapshot: commit oids the graph pages from, sorted and unique. */
  tips: string[];
  soloActive: boolean;
  stashesVisible: boolean;
  /** Whether a checkout's WIP row is shown. */
  wipVisible(c: Pick<Checkout, 'isOwn' | 'branch'>): boolean;
}

export const sectionOf = (r: Ref): Exclude<Section, 'stashes'> => (r.kind === 'local' ? 'local' : r.kind === 'remote' ? 'remote' : 'tags');

/**
 * Which refs the graph shows and the tips it pages from. Solo wins over hide: any soloed ref, remote or section limits
 * the graph to those. The checked-out branch is never hidden. HEAD and detached worktree HEADs are tips unless soloing.
 */
export function resolveVisibility(refs: RefsResult, prefs: GraphPrefs): Visibility {
  const current = refs.head.branch;
  const solo = refs.refs.filter((r) => prefs.soloed.includes(r.name)
    || (r.kind === 'remote' && r.remote !== null && prefs.soloedRemotes.includes(r.remote))
    || (prefs.soloedSections as string[]).includes(sectionOf(r)));
  const soloActive = solo.length > 0;
  const shown = soloActive ? solo : refs.refs.filter((r) => r.name === current || !(prefs.hidden.includes(r.name)
    || (r.kind === 'remote' && r.remote !== null && prefs.hiddenRemotes.includes(r.remote))
    || prefs.hiddenSections.includes(sectionOf(r))));
  const visible = new Set(shown.map((r) => r.name));
  const tips = new Set(shown.map((r) => r.oid).filter((o): o is string => !!o));
  if (!soloActive) {
    if (refs.head.oid) tips.add(refs.head.oid);
    for (const w of refs.worktrees ?? []) if (w.detached && w.head) tips.add(w.head);
  }
  return {
    visible,
    tips: [...tips].sort(),
    soloActive,
    stashesVisible: !prefs.hiddenSections.includes('stashes'),
    wipVisible: (c) => c.isOwn || (c.branch !== null ? visible.has(c.branch) : !soloActive),
  };
}
