import { headOf } from '@/features/branches/refInfo';
import type { CommitsCtx } from '@/features/graph/contexts';
import { chainOf } from '@/features/sequence/actions';
import { topHref } from '@/lib/host';
import { integrationsStore } from '@/state/integrations';
import type { Tab } from '@/state/tabs';

// "Review in code-review": cc's URL for code-review's new-review view of a commit or a range ending at HEAD
// (docs/protocol.md → Links to code-review).

export type ReviewSelection = { sha: string } | { range: [base: string, head: string] };

/** code-review's subpath: `?project=…[&worktree=…]&view=new&sha=<oid>` or `…&range=<base>...<head>`. */
export function reviewSubpath(tab: Tab, sel: ReviewSelection): string {
  const q = new URLSearchParams({ project: tab.project });
  if (tab.worktree) q.set('worktree', tab.worktree);
  q.set('view', 'new');
  if ('sha' in sel) q.set('sha', sel.sha);
  else q.set('range', `${sel.range[0]}...${sel.range[1]}`);
  return `?${q}`;
}

/** cc's URL with code-review's view in its hash; null on a submodule tab, without code-review, or outside cc. */
export function reviewHref(tab: Tab, sel: ReviewSelection): string | null {
  const id = integrationsStore.get().codeReview;
  if (tab.sub?.length || !id) return null;
  return topHref(`#plugin/${encodeURIComponent(id)}/${reviewSubpath(tab, sel)}`);
}

/**
 * The selection as `[base, HEAD's oid]` when it is one first-parent chain whose newest commit is HEAD: only then does
 * `base...HEAD` review exactly the selected commits. HEAD goes as its oid, so a moved HEAD is a mismatch, not another range.
 */
export function rangeToHead(c: CommitsCtx): [string, string] | null {
  const chain = chainOf(c);
  if (!chain || chain[0].oid !== headOf(c.tab).oid) return null;
  return [chain.at(-1)!.parents[0], chain[0].oid];
}
