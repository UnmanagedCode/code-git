import { Toaster } from 'sonner';
import { useTheme } from '@/lib/theme';

/**
 * The toast surface for the stash's toasts (sonner), as C5's `shell/Toasts.tsx`, mounted where C5 mounts it: beside
 * `<App/>` in main.tsx (inside the Shell, it re-renders with every Shell render and delays a tab switch's panels). Two
 * Toasters would show every toast twice: whichever of C5 and C8 lands second keeps C5's mount and deletes this file.
 */
export function StashToaster() {
  return <Toaster theme={useTheme()} position="bottom-right" />;
}
