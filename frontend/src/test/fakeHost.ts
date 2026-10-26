import { vi } from 'vitest';

// Frames the page in a fake cc (test-only): `window.top` is a same-origin stub and the bridge's `ccBridge` is defined.
// Undone by vi.restoreAllMocks() plus unframe().

export interface FakeTop { location: { pathname: string; search: string; assign: ReturnType<typeof vi.fn> } }

export function frameInCc({ pathname = '/', search = '', unreadable = false } = {}): FakeTop {
  const top: FakeTop = { location: { pathname, search, assign: vi.fn() } };
  const shown = unreadable
    ? Object.defineProperty({}, 'location', { get() { throw new DOMException('cross-origin', 'SecurityError'); } })
    : top;
  vi.spyOn(window, 'top', 'get').mockReturnValue(shown as unknown as Window);
  (window as unknown as { ccBridge?: object }).ccBridge = {};
  return top;
}

export function unframe(): void {
  vi.restoreAllMocks();
  delete (window as unknown as { ccBridge?: object }).ccBridge;
}
