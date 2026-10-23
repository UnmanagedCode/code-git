import type { Target } from '@/lib/endpoints';
import { activityStore } from './useActivity';

// When a watcher may read a project's git state after a write: once the write's op run ended, never between its
// commands (a half-done submodule removal, a rebase between fetch and replay). Read from the activity store's runs.

/** Whether a write op run of `project` is running, as the activity store last read it. */
export const writeRunning = (project: string): boolean =>
  activityStore.get().runs.some((r) => r.status === 'running' && r.target.project === project);

/**
 * Calls `fn` once a write run of `project` whose target `match`es ended and no write run of `project` is running, so
 * overlapping writes give one call, after the last. A run already running when this starts is waited for.
 */
export function onSettledWrite(project: string, match: (t: Target) => boolean, fn: () => void): () => void {
  const mine = () => activityStore.get().runs.filter((r) => r.target.project === project);
  const start = mine();
  const open = start.filter((r) => r.status === 'running').map((r) => r.id);
  // Every run up to `seen` has ended (or was there before the watcher and is not its business).
  let seen = open.length ? Math.min(...open) - 1 : Math.max(0, ...start.map((r) => r.id));
  return activityStore.subscribe(() => {
    const runs = mine();
    if (runs.some((r) => r.status === 'running')) return;
    const fresh = runs.filter((r) => r.id > seen);
    if (!fresh.length) return;
    // Nothing of the project runs now, so everything up to the newest run has ended.
    seen = Math.max(...fresh.map((r) => r.id));
    if (fresh.some((r) => match(r.target))) fn();
  });
}
