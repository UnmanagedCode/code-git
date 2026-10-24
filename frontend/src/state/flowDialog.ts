import type { FlowType } from '@/features/flow/api';
import { createStore, useStore } from './store';
import type { Tab } from './tabs';

// The one open git-flow dialog, rendered by <FlowHost/>.

export type FlowDialog =
  | { kind: 'init'; tab: Tab }
  | { kind: 'start'; tab: Tab; type: FlowType }
  /** `branch`: the flow branch's short name; `expect`: its oid when the menu was opened. */
  | { kind: 'finish'; tab: Tab; type: FlowType; name: string; branch: string; expect: string };

export const flowDialogStore = createStore<FlowDialog | null>(null);
export const openFlowDialog = (d: FlowDialog): void => flowDialogStore.set(d);
export const closeFlowDialog = (): void => flowDialogStore.set(null);
export const resetFlowDialog = closeFlowDialog;
export const useFlowDialog = () => useStore(flowDialogStore);
