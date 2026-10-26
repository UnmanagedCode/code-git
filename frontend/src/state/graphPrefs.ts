import { clampWidth, COLUMN_IDS, COLUMNS, isColumnId, type ColumnId, type OptionalColumnId } from '@/features/graph/columns';
import { useMemo } from 'react';
import { getItem, setItem } from '@/lib/storage';
import { createStore, useStore } from './store';

// Per-repo graph preferences (visibility, pins, columns), persisted under `graph:<prefsKey>` (prefsKey in state/tabs.ts):
// refs are shared by every checkout of a project, so its worktree tabs share one record; a submodule has its own.

export type Section = 'local' | 'remote' | 'tags' | 'stashes';
const SECTIONS: Section[] = ['local', 'remote', 'tags', 'stashes'];

export interface GraphPrefs {
  hidden: string[];
  hiddenRemotes: string[];
  hiddenSections: Section[];
  soloed: string[];
  soloedRemotes: string[];
  soloedSections: Exclude<Section, 'stashes'>[];
  /** Full refnames, in pin order. */
  pinned: string[];
  /** Folder prefixes (`refs/heads/code-conductor/`) hidden: a ref created later under one inherits it. */
  hiddenFolders: string[];
  /** Folder prefixes soloed: a ref created later under one inherits it. */
  soloedFolders: string[];
  /** Folder prefixes the refs panel shows collapsed; the default is expanded. */
  collapsedFolders: string[];
  columns: { order: ColumnId[]; visible: OptionalColumnId[]; widths: Partial<Record<ColumnId, number>> };
}

export const DEFAULT_PREFS: GraphPrefs = {
  hidden: [], hiddenRemotes: [], hiddenSections: [], soloed: [], soloedRemotes: [], soloedSections: [], pinned: [],
  hiddenFolders: [], soloedFolders: [], collapsedFolders: [],
  columns: { order: [...COLUMN_IDS], visible: [], widths: {} },
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))] : []);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T[] => strings(v).filter((x): x is T => (allowed as readonly string[]).includes(x));

/** A folder prefix: a full refname prefix inside a refs namespace, ending in `/`. */
export const isFolderPrefix = (s: string): boolean => /^refs\/(heads|remotes|tags)\/.+\/$/.test(s);
const folderPrefixes = (v: unknown): string[] => strings(v).filter(isFolderPrefix);

/** A stored record made safe: unknown or ill-typed entries dropped, column order repaired, widths clamped. */
export function validatePrefs(raw: unknown): GraphPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_PREFS;
  const r = raw as Record<string, unknown>;
  const cols = (r.columns && typeof r.columns === 'object' && !Array.isArray(r.columns) ? r.columns : {}) as Record<string, unknown>;
  const order = strings(cols.order).filter(isColumnId);
  for (const id of COLUMN_IDS) if (!order.includes(id)) order.push(id);
  const widths: Partial<Record<ColumnId, number>> = {};
  if (cols.widths && typeof cols.widths === 'object') {
    for (const [k, v] of Object.entries(cols.widths)) if (isColumnId(k) && COLUMNS[k].resizable && Number.isFinite(v)) widths[k] = clampWidth(k, v as number);
  }
  return {
    hidden: strings(r.hidden), hiddenRemotes: strings(r.hiddenRemotes), hiddenSections: oneOf(r.hiddenSections, SECTIONS),
    soloed: strings(r.soloed), soloedRemotes: strings(r.soloedRemotes), soloedSections: oneOf(r.soloedSections, ['local', 'remote', 'tags'] as const),
    pinned: strings(r.pinned),
    hiddenFolders: folderPrefixes(r.hiddenFolders), soloedFolders: folderPrefixes(r.soloedFolders), collapsedFolders: folderPrefixes(r.collapsedFolders),
    columns: { order, visible: oneOf(cols.visible, COLUMN_IDS.filter((id) => COLUMNS[id].optional) as OptionalColumnId[]), widths },
  };
}

const key = (prefsKey: string) => `graph:${prefsKey}`;

export function loadPrefs(prefsKey: string): GraphPrefs {
  try {
    return validatePrefs(JSON.parse(getItem(key(prefsKey)) ?? 'null'));
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Loaded on first read, by prefsKey. */
export const graphPrefsStore = createStore<ReadonlyMap<string, GraphPrefs>>(new Map());
export const resetGraphPrefs = (): void => graphPrefsStore.set(new Map());

export function getPrefs(prefsKey: string): GraphPrefs {
  const m = graphPrefsStore.get();
  const have = m.get(prefsKey);
  if (have) return have;
  const loaded = loadPrefs(prefsKey);
  graphPrefsStore.set(new Map(m).set(prefsKey, loaded));
  return loaded;
}

export function updatePrefs(prefsKey: string, f: (p: GraphPrefs) => GraphPrefs): void {
  const next = validatePrefs(f(getPrefs(prefsKey)));
  graphPrefsStore.set((m) => new Map(m).set(prefsKey, next));
  setItem(key(prefsKey), JSON.stringify(next));
}

export function useGraphPrefs(prefsKey: string): GraphPrefs {
  const m = useStore(graphPrefsStore);
  // Read storage without writing the store during render; the first update stores it.
  const stored = useMemo(() => loadPrefs(prefsKey), [prefsKey]);
  return m.get(prefsKey) ?? stored;
}

/** `list` with `item` added (at the end) or removed. */
export const toggled = <T>(list: T[], item: T, on: boolean): T[] => (on ? (list.includes(item) ? list : [...list, item]) : list.filter((x) => x !== item));
