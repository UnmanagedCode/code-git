import type { ActivityEntry } from './endpoints';

/**
 * One shared EventSource on `api/activity/events`, opened with the first subscriber and closed with the last. Events are
 * signals: a handler refetches what it shows. It gets the entry the event carries (to tell which checkout a write ran
 * in), or nothing on a (re)connect, which may have missed events.
 */
let make: () => EventSource = () => new EventSource('api/activity/events');
/** Test seam: replace the EventSource factory. */
export const setEventSourceFactory = (f: () => EventSource): void => { make = f; };

type Handler = (entry?: ActivityEntry) => void;
const handlers = new Set<Handler>();
let source: EventSource | null = null;

export function subscribeActivity(fn: Handler): () => void {
  handlers.add(fn);
  if (!source) {
    source = make();
    source.addEventListener('activity', (e) => {
      let entry: ActivityEntry | undefined;
      try { entry = JSON.parse((e as MessageEvent<string>).data) as ActivityEntry; } catch { entry = undefined; }
      handlers.forEach((h) => h(entry));
    });
    // A reconnect may have missed events: refetch.
    source.addEventListener('open', () => handlers.forEach((h) => h()));
  }
  return () => {
    handlers.delete(fn);
    if (!handlers.size) {
      source?.close();
      source = null;
    }
  };
}
