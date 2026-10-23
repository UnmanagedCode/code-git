import { trackOp, type TrackOptions, type Tracked } from '@/lib/opToast';
import { refreshGraph } from '@/state/graph';
import type { Tab } from '@/state/tabs';
import { refreshAfterWrite } from '@/state/workdir';
import { loadSubmodules } from './state';

// Every submodule op from the UI runs through runSubmoduleOp: its toast, then the submodule list, the Changes lists, the
// header summary and the graph of the repo it acted on refreshed whatever the outcome (a pointer, .gitmodules or a
// staged gitlink may have changed).

export async function runSubmoduleOp<T>(tab: Tab, labels: TrackOptions<T>, fn: () => Promise<T>): Promise<Tracked<T>> {
  const r = await trackOp(fn, labels);
  await Promise.all([loadSubmodules(tab), refreshAfterWrite(tab), refreshGraph(tab, 'write')]);
  return r;
}
