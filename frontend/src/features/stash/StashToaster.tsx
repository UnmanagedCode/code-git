import { Toaster } from 'sonner';
import { useTheme } from '@/lib/theme';

/**
 * The toast surface for the stash's toasts (sonner), as C5's `shell/Toasts.tsx`. Two Toasters would show every toast
 * twice: whichever of C5 and C8 lands second keeps C5's mount in main.tsx and removes this one from Shell.tsx.
 */
export function StashToaster() {
  return <Toaster theme={useTheme()} position="bottom-right" />;
}
