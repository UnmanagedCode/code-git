import { Toaster } from 'sonner';
import { useTheme } from '@/lib/theme';

/** The one toast surface (sonner), mounted beside the app; `lib/opToast.ts` is how features use it. */
export function Toasts() {
  return <Toaster theme={useTheme()} position="bottom-right" />;
}
