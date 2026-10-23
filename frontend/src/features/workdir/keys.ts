import type { Shortcut } from '@/shell/shortcuts';

// The Changes panel's keys (the catalog: shell/shortcuts.ts): its global ones, its file rows' (moving and opening are
// every file list's: features/diff/keys.ts), the commit box's.

const ANY = 'any' as const;
export const STAGE_ALL_KEY: Shortcut = { id: 'workdir.stageAll', label: 'Stage all', scope: 'Changes', combos: [{ key: 's', mod: true, shift: true }] };
export const UNSTAGE_ALL_KEY: Shortcut = { id: 'workdir.unstageAll', label: 'Unstage all', scope: 'Changes', combos: [{ key: 'u', mod: true, shift: true }] };
export const FOCUS_COMMIT_KEY: Shortcut = { id: 'workdir.focusCommit', label: 'Write the commit message', scope: 'Changes', combos: [{ key: 'm', mod: true, shift: true }] };
export const ROW_STAGE_KEY: Shortcut = { id: 'workdir.stageFile', label: 'Stage the focused file', scope: 'Changes', combos: [{ key: 's', shift: ANY }] };
export const ROW_UNSTAGE_KEY: Shortcut = { id: 'workdir.unstageFile', label: 'Unstage the focused file', scope: 'Changes', combos: [{ key: 'u', shift: ANY }] };
export const WORKDIR_KEYS: Shortcut[] = [STAGE_ALL_KEY, UNSTAGE_ALL_KEY, FOCUS_COMMIT_KEY, ROW_STAGE_KEY, ROW_UNSTAGE_KEY];

export const COMMIT_KEY: Shortcut = { id: 'commit.commit', label: 'Commit (amend in amend mode)', scope: 'Commit box', combos: [{ key: 'Enter', mod: true }] };
export const COMMIT_STAGE_ALL_KEY: Shortcut = { id: 'commit.stageAllCommit', label: 'Stage everything, then commit', scope: 'Commit box', combos: [{ key: 'Enter', mod: true, shift: true }] };
export const COMMIT_KEYS: Shortcut[] = [COMMIT_KEY, COMMIT_STAGE_ALL_KEY];
