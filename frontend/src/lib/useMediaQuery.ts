import * as React from 'react';

// A second spelling of Tailwind's `md` breakpoint, where App.tsx turns the
// drawer into a sidebar column; it must change with any `--breakpoint-md` override.
export const WIDE_QUERY = '(min-width: 48rem)';
/** Tailwind's `lg`: at and above it the left and right slots are shown; below it their panels open as dialogs. */
export const LG_QUERY = '(min-width: 64rem)';

/** Whether the media query matches; re-renders when it starts or stops matching. */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
