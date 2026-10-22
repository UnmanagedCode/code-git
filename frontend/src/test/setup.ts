import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetDiff } from '@/state/diff';
import { resetShownPanels } from '@/state/shownPanel';
import { resetDrag } from '@/features/graph/drag';
import { contextMenuStore } from '@/shell/ContextMenuHost';
import { resetGraph } from '@/state/graph';
import { resetGraphPrefs } from '@/state/graphPrefs';
import { resetGraphSelection } from '@/state/graphSelection';
import { EMPTY, tabsStore } from '@/state/tabs';
import { resetActivity } from '@/state/useActivity';
import { resetSummaries } from '@/state/useRepoSummary';
import { resetRepos } from '@/state/useRepos';
import { installFakeEventSource } from './fakeEventSource';

beforeEach(() => installFakeEventSource());

afterEach(() => {
  cleanup();
  tabsStore.set(EMPTY);
  resetRepos();
  resetActivity();
  resetSummaries();
  resetDiff();
  resetShownPanels();
  resetGraphPrefs();
  resetGraph();
  resetGraphSelection();
  resetDrag();
  contextMenuStore.set(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.replaceState(null, '', '?');
});
