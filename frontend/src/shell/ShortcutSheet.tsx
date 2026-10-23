import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { closeOverlay, useOverlay } from './overlays';
import { SHORTCUT_GROUPS, shortcutLabel } from './shortcuts';

/** Every shortcut of the catalog, by scope (Ctrl/⌘+/, the palette). Nothing here is hand-listed. Mounted once by the Shell. */
export function ShortcutSheet() {
  const open = useOverlay() === 'sheet';
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeOverlay(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Ctrl/⌘ is Ctrl, or ⌘ on macOS. Keys of a panel act while focus is in it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.scope} aria-label={g.scope}>
              <h3 className="mb-1 text-sm font-semibold">{g.scope}</h3>
              <dl className="grid grid-cols-[minmax(9rem,1fr)_auto] gap-x-3 gap-y-0.5 text-sm">
                {g.shortcuts.map((s) => (
                  <div key={s.id} className="contents" data-shortcut={s.id}>
                    <dt className="text-muted-foreground">{s.label}</dt>
                    <dd className="text-right"><kbd className="font-mono text-xs">{shortcutLabel(s)}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
