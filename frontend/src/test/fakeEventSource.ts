import { setEventSourceFactory } from '@/lib/sse';

/** A controllable EventSource: tests call `emit`. */
export class FakeEventSource {
  static last: FakeEventSource | null = null;
  closed = false;
  private listeners = new Map<string, Set<(e: Event) => void>>();
  constructor() { FakeEventSource.last = this; }
  addEventListener(type: string, fn: (e: Event) => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn);
  }
  close() { this.closed = true; }
  emit(data: unknown) { this.listeners.get('activity')?.forEach((f) => f(new MessageEvent('activity', { data: JSON.stringify(data) }))); }
}

export function installFakeEventSource(): void {
  FakeEventSource.last = null;
  setEventSourceFactory(() => new FakeEventSource() as unknown as EventSource);
}
