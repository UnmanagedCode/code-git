import { runOp, type Target } from '@/lib/endpoints';

// The git-flow ops' wire shapes (docs/protocol.md → Git-flow ops, docs/gitflow.md) and runOp wrappers.

export type FlowType = 'feature' | 'release' | 'hotfix';
export const FLOW_TYPES: FlowType[] = ['feature', 'release', 'hotfix'];
export interface FlowPrefixes { feature: string; release: string; hotfix: string; versionTag: string }
export interface FlowSettings { main: string; develop: string; prefixes: FlowPrefixes }
/** What the config holds: each setting null when unset. */
export interface FlowConfig {
  initialized: boolean;
  main: string | null;
  develop: string | null;
  prefixes: { [K in keyof FlowPrefixes]: string | null };
}
export interface FlowConfigResult extends FlowConfig { defaults: { main: string | null; develop: string; prefixes: FlowPrefixes } }
export interface FinishResult {
  branch: string;
  merges: { into: string; outcome: 'merged' | 'upToDate'; oid: string }[];
  tag: { name: string; oid: string } | null;
  deleted: boolean;
  head: string;
}

export const flowConfig = (t: Target) => runOp<FlowConfigResult>('flow.config', t, {});
export const flowInit = (t: Target, s: FlowSettings) => runOp<{ config: FlowConfig; createdDevelop: boolean }>('flow.init', t, s);
export const flowStart = (t: Target, type: FlowType, name: string, ccOwned?: true) =>
  runOp<{ branch: string; base: string; oid: string }>('flow.start', t, { type, name, ...(ccOwned ? { ccOwned } : {}) });
export const flowFinish = (t: Target, p: { type: FlowType; name: string; expect: string; tagMessage?: string }, ccOwned?: true) =>
  runOp<FinishResult>('flow.finish', t, { ...p, ...(ccOwned ? { ccOwned } : {}) });
