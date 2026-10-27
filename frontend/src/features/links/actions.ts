import { MessageSquareCodeIcon } from 'lucide-react';
import type { CommitCtx, CommitsCtx } from '@/features/graph/contexts';
import { navigateTop } from '@/lib/host';
import type { MenuAction } from '@/shell/menus';
import { rangeToHead, reviewHref } from './codeReview';

// The graph's links out to code-review. Each navigates cc's top document (lib/host.ts → navigateTop): menu items run on
// select, and only the hash changes, so cc does not reload.

const rangeHref = (c: CommitsCtx): string | null => {
  const range = rangeToHead(c);
  return range ? reviewHref(c.tab, { range }) : null;
};

export const LINK_ACTIONS: MenuAction<never>[] = [
  {
    id: 'links.commit.codeReview', context: 'commit', icon: MessageSquareCodeIcon, label: 'Review in code-review', group: 'view', order: 850,
    when: (c: CommitCtx) => !!reviewHref(c.tab, { sha: c.commit.oid }),
    run: (c: CommitCtx) => { const href = reviewHref(c.tab, { sha: c.commit.oid }); if (href) navigateTop(href); },
  },
  {
    id: 'links.commits.codeReview', context: 'commits', icon: MessageSquareCodeIcon, label: 'Review range in code-review', group: 'view', order: 850,
    when: (c: CommitsCtx) => !!rangeHref(c),
    run: (c: CommitsCtx) => { const href = rangeHref(c); if (href) navigateTop(href); },
  },
] as MenuAction<never>[];
