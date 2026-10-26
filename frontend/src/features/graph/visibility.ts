import type { GraphPrefs, Section } from '@/state/graphPrefs';
import type { Checkout, Ref, RefsResult } from './types';

/** Tips per graph.page request: TIPS_MAX of src/git/ops/graph.js, which refuses more. */
export const TIPS_MAX = 10_000;

export interface Visibility {
  /** Full refnames shown in the graph. */
  visible: Set<string>;
  /** The snapshot: commit oids the graph pages from, sorted and unique, at most TIPS_MAX. */
  tips: string[];
  /** Distinct tip commits left out to stay within TIPS_MAX (0 normally). */
  tipsDropped: number;
  soloActive: boolean;
  stashesVisible: boolean;
  /** Whether a checkout's WIP row is shown. */
  wipVisible(c: Pick<Checkout, 'isOwn' | 'branch'>): boolean;
}

/** The refname prefix of each list's namespace. */
export const SECTION_BASE = { local: 'refs/heads/', remote: 'refs/remotes/', tags: 'refs/tags/' } as const;

/** The namespace a ref's folders live in: `refs/heads/`, `refs/remotes/<remote>/` or `refs/tags/`. */
export function refBase(r: Ref): string {
  return r.kind === 'local' ? SECTION_BASE.local : r.kind === 'remote' ? `${SECTION_BASE.remote}${r.remote === null ? '' : `${r.remote}/`}` : SECTION_BASE.tags;
}

/** Whether `r` is under folder `prefix`: a prefix of its name, inside the ref's own namespace and longer than it. */
export function inFolder(r: Ref, prefix: string): boolean {
  const b = refBase(r);
  return prefix.length > b.length && prefix.startsWith(b) && r.name.startsWith(prefix);
}

export const sectionOf = (r: Ref): Exclude<Section, 'stashes'> => (r.kind === 'local' ? 'local' : r.kind === 'remote' ? 'remote' : 'tags');

/**
 * Which refs the graph shows and the tips it pages from. Solo wins over hide: any soloed ref, folder, remote or section
 * limits the graph to the union of those, and every hide is ignored. Otherwise a ref matching a hidden ref, folder,
 * remote or section is left out. The checked-out branch is never hidden. HEAD and detached worktree HEADs are tips unless soloing.
 */
export function resolveVisibility(refs: RefsResult, prefs: GraphPrefs): Visibility {
  const current = refs.head.branch;
  const solo = refs.refs.filter((r) => prefs.soloed.includes(r.name)
    || prefs.soloedFolders.some((p) => inFolder(r, p))
    || (r.kind === 'remote' && r.remote !== null && prefs.soloedRemotes.includes(r.remote))
    || (prefs.soloedSections as string[]).includes(sectionOf(r)));
  const soloActive = solo.length > 0;
  const shown = soloActive ? solo : refs.refs.filter((r) => r.name === current || !(prefs.hidden.includes(r.name)
    || prefs.hiddenFolders.some((p) => inFolder(r, p))
    || (r.kind === 'remote' && r.remote !== null && prefs.hiddenRemotes.includes(r.remote))
    || prefs.hiddenSections.includes(sectionOf(r))));
  const visible = new Set(shown.map((r) => r.name));
  // In priority order, so a clamp to TIPS_MAX keeps HEAD, the worktrees, then branches before remotes and tags.
  const ordered: (string | null)[] = [];
  if (!soloActive) {
    ordered.push(refs.head.oid);
    for (const w of refs.worktrees ?? []) if (w.detached) ordered.push(w.head);
  }
  const rank = { local: 0, remote: 1, tag: 2 } as const;
  for (const r of [...shown].sort((a, b) => Number(b.name === current) - Number(a.name === current) || rank[a.kind] - rank[b.kind])) ordered.push(r.oid);
  const unique = [...new Set(ordered.filter((o): o is string => !!o))];
  return {
    visible,
    tips: unique.slice(0, TIPS_MAX).sort(),
    tipsDropped: Math.max(0, unique.length - TIPS_MAX),
    soloActive,
    stashesVisible: !prefs.hiddenSections.includes('stashes'),
    wipVisible: (c) => c.isOwn || (c.branch !== null ? visible.has(c.branch) : !soloActive),
  };
}
