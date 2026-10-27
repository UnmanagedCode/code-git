// The cc page around this frame. code-git runs in a same-origin, unsandboxed frame, so cc's top document is readable and
// navigable; nothing here works standalone.

/** Framed by cc: its bridge script (`/pluginBridge.js`) defines `ccBridge` only inside a frame. */
export const embedded = (): boolean => window.self !== window.top && 'ccBridge' in window;

/** cc's current URL with its hash replaced by `hash`; null when not embedded or cc's location is unreadable. */
export function topHref(hash: string): string | null {
  if (!embedded()) return null;
  try {
    const { pathname, search } = window.top!.location;
    return pathname + search + hash;
  } catch {
    return null;
  }
}

/** Navigates cc's top document: the one sanctioned top navigation (a user-activated menu action). */
export function navigateTop(href: string): void {
  window.top!.location.assign(href);
}
