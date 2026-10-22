import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetDiff } from '@/state/diff';
import { resetShownPanels } from '@/state/shownPanel';
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.replaceState(null, '', '?');
});
