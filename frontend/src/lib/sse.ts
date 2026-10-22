/** One shared EventSource on `api/activity/events`, opened with the first subscriber and closed with the last. Events only signal; data is refetched. */
let make: () => EventSource = () => new EventSource('api/activity/events');
/** Test seam: replace the EventSource factory. */
export const setEventSourceFactory = (f: () => EventSource): void => { make = f; };

const handlers = new Set<() => void>();
let source: EventSource | null = null;

export function subscribeActivity(fn: () => void): () => void {
  handlers.add(fn);
  if (!source) {
    source = make();
    const fire = () => handlers.forEach((h) => h());
    source.addEventListener('activity', fire);
    // A reconnect may have missed events: refetch.
    source.addEventListener('open', fire);
  }
  return () => {
    handlers.delete(fn);
    if (!handlers.size) {
      source?.close();
      source = null;
    }
  };
}
