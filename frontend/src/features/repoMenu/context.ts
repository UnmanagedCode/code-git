import type { Tab } from '@/state/tabs';

/** The toolbar's "Repository actions" menu: actions about the whole checkout register under this context. */
export const REPO_CONTEXT = 'repo';
export interface RepoCtx { tab: Tab }
