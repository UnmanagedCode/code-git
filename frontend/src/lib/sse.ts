/**
 * One shared EventSource on `api/activity/events`, opened with the first subscriber and closed with the last. Events are
 * signals, never data: on an `activity` or `run` event, or a (re)connect (which may have missed events), a handler
 * refetches what it shows.
 */
let make: () => EventSource = () => new EventSource('api/activity/events');
/** Test seam: replace the EventSource factory. */
export const setEventSourceFactory = (f: () => EventSource): void => { make = f; };

type Handler = () => void;
const handlers = new Set<Handler>();
let source: EventSource | null = null;

export function subscribeActivity(fn: Handler): () => void {
  handlers.add(fn);
  if (!source) {
    source = make();
    const signal = () => handlers.forEach((h) => h());
    source.addEventListener('activity', signal);
    source.addEventListener('run', signal);
    source.addEventListener('open', signal);
  }
  return () => {
    handlers.delete(fn);
    if (!handlers.size) {
      source?.close();
      source = null;
    }
  };
}
