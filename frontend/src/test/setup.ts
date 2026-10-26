import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, vi } from 'vitest';
import { toast } from 'sonner';
import { resetDiff } from '@/state/diff';
import { resetFileView } from '@/state/fileView';
import { resetDetailsHeader } from '@/state/detailsHeader';
import { resetPaneWidths } from '@/state/paneWidths';
import { resetShownPanels } from '@/state/shownPanel';
import { resetDrag } from '@/features/graph/drag';
import { resetJump } from '@/features/graph/jump';
import { contextMenuStore } from '@/shell/ContextMenuHost';
import { resetOverlays } from '@/shell/overlays';
import { resetUndo } from '@/state/undo';
import { resetHistory } from '@/features/history/state';
import { resetGraph } from '@/state/graph';
import { resetGraphPrefs } from '@/state/graphPrefs';
import { resetGraphSelection } from '@/state/graphSelection';
import { EMPTY, tabsStore } from '@/state/tabs';
import { resetActivity } from '@/state/useActivity';
import { resetSummaries } from '@/state/useRepoSummary';
import { resetRepos } from '@/state/useRepos';
import { resetWorkdir } from '@/state/workdir';
import { resetConfirm } from '@/lib/confirm';
import { resetLineSelection } from '@/state/lineSelection';
import { resetRefDialog } from '@/state/refDialog';
import { resetRefSelection } from '@/state/refSelection';
import { resetTracking } from '@/state/branchTracking';
import { resetStashDialog } from '@/state/stashDialog';
import { resetRemotes } from '@/state/remotes';
import { resetRemotePrefs } from '@/state/remotePrefs';
import { resetRemoteDialog } from '@/state/remoteDialog';
import { resetAutoFetch } from '@/features/remotes/autoFetch';
import { resetSequenceDialog } from '@/state/sequenceDialog';
import { resetRebaseEditor } from '@/features/rebase/state';
import { resetConflictTool } from '@/features/conflicts/state';
import { resetSubmoduleExit } from '@/features/submodules/exit';
import { resetSubmodules } from '@/features/submodules/state';
import { resetSubmoduleDialog } from '@/state/submoduleDialog';
import { resetFlow } from '@/features/flow/state';
import { resetFlowDialog } from '@/state/flowDialog';
import { resetLfsDialog } from '@/state/lfsDialog';
import { installFakeEventSource } from './fakeEventSource';

beforeEach(() => installFakeEventSource());

// A dismissed toast removes itself TIME_BEFORE_UNMOUNT (200 ms in sonner) later, through a timer the Toaster's unmount
// does not clear: in a file that showed a toast, let it run before the environment's window goes away (it would throw
// "window is not defined" outside any test).
afterAll(async () => {
  if (toast.getHistory().length) await new Promise((r) => setTimeout(r, 250));
});

afterEach(() => {
  cleanup();
  tabsStore.set(EMPTY);
  resetRepos();
  resetActivity();
  resetSummaries();
  resetDiff();
  resetFileView();
  resetDetailsHeader();
  resetPaneWidths();
  resetShownPanels();
  // The graph's triggers first: they read the prefs.
  resetGraph();
  resetGraphPrefs();
  resetGraphSelection();
  resetDrag();
  resetJump();
  contextMenuStore.set(null);
  resetOverlays();
  resetUndo();
  resetHistory();
  resetWorkdir();
  resetConfirm();
  resetLineSelection();
  resetRefDialog();
  resetRefSelection();
  resetTracking();
  resetStashDialog();
  resetRemotes();
  resetRemotePrefs();
  resetRemoteDialog();
  resetAutoFetch();
  resetSequenceDialog();
  resetRebaseEditor();
  resetConflictTool();
  resetSubmoduleExit();
  resetSubmoduleDialog();
  resetSubmodules();
  resetFlow();
  resetFlowDialog();
  resetLfsDialog();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.replaceState(null, '', '?');
});
