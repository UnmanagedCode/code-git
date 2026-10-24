import { useEffect } from 'react';
import { createStore, useStore } from '@/state/store';
import { useGraphData } from '@/state/graph';
import { refsKey, type Tab } from '@/state/tabs';
import { flowConfig, FLOW_TYPES, type FlowConfigResult, type FlowType } from './api';

// The git-flow settings per refsKey (a project's worktrees share one config; a submodule has its own). Loaded when a
// tab's graph refs change (as the tracking badges are) and after every git-flow op, so the branch menu's Finish item and
// the repository menu read them synchronously.

export const flowStore = createStore<ReadonlyMap<string, FlowConfigResult>>(new Map());
const seen = new Map<string, object>();
let epoch = 0;

export function resetFlow(): void {
  epoch++;
  seen.clear();
  flowStore.set(new Map());
}

export const getFlow = (tab: Tab): FlowConfigResult | null => flowStore.get().get(refsKey(tab)) ?? null;

/** Reads the settings again; a failure keeps the last ones (the menus then offer what they knew). */
export async function refreshFlow(tab: Tab): Promise<void> {
  const at = epoch;
  try {
    const c = await flowConfig(tab);
    if (at === epoch) flowStore.set((m) => new Map(m).set(refsKey(tab), c));
  } catch {
    // The menus are an aid: the next refs change retries.
  }
}

/** Loads the settings whenever this tab's graph refs change. */
export function useFlowLoader(tab: Tab): void {
  const refs = useGraphData(tab).refs;
  useEffect(() => {
    if (!refs || seen.get(refsKey(tab)) === refs) return;
    seen.set(refsKey(tab), refs);
    void refreshFlow(tab);
  }, [refs, tab]);
}

export const useFlow = (tab: Tab): FlowConfigResult | null => useStore(flowStore).get(refsKey(tab)) ?? null;

/** A flow branch's type and name from its short name (the longest configured prefix wins); null for any other branch. */
export function flowBranchOf(config: FlowConfigResult | null, short: string): { type: FlowType; name: string } | null {
  if (!config?.initialized) return null;
  let best: { type: FlowType; name: string; len: number } | null = null;
  for (const type of FLOW_TYPES) {
    const p = config.prefixes[type];
    if (p && short.startsWith(p) && short.length > p.length && (!best || p.length > best.len)) best = { type, name: short.slice(p.length), len: p.length };
  }
  return best && { type: best.type, name: best.name };
}
