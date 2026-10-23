import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { activeTab, useTabs } from '@/state/tabs';
import { COMMANDS, filterCommands, filterPicks, titleOf, type Command, type PickItem } from './commands';
import { PALETTE_MOVE_KEY, PALETTE_RUN_KEY } from './keys';
import { closeOverlay, useOverlay } from './overlays';
import { matchCombo, matches, shortcutLabel } from './shortcuts';

// The command palette (Ctrl/⌘+P, the header's Commands button): a combobox over COMMANDS for the active tab, and a
// second stage for a command that picks (a branch, a file, a tab). Mounted once by the Shell; the Dialog root stays
// mounted and `open` follows the overlay store.

type Row = { key: string; label: string; detail?: string; hint?: string; run: () => void };

interface PickStage { command: Command; items: PickItem[] | null; error: string | null }

export function CommandPalette() {
  const open = useOverlay() === 'palette';
  const tab = activeTab(useTabs());
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [stage, setStage] = useState<PickStage | null>(null);
  const listId = useId();
  const pickSeq = useRef(0);
  // A fresh palette each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setStage(null);
  }, [open]);

  const finish = (fn: () => unknown) => { closeOverlay(); void fn(); };
  const startPick = (c: Command) => {
    if (!tab || !c.pick) return;
    const seq = ++pickSeq.current;
    setStage({ command: c, items: null, error: null });
    setQuery('');
    setActive(0);
    Promise.resolve(c.pick.items(tab)).then(
      (items) => { if (seq === pickSeq.current) setStage({ command: c, items, error: null }); },
      (e: unknown) => { if (seq === pickSeq.current) setStage({ command: c, items: [], error: e instanceof Error ? e.message : String(e) }); },
    );
  };

  const rows: Row[] = useMemo(() => {
    if (stage) {
      const pick = stage.command.pick!;
      return filterPicks(stage.items ?? [], query, pick.typed).map((item) => ({
        key: item.id, label: item.label, detail: item.detail, run: () => { if (tab) finish(() => pick.run(tab, item)); },
      }));
    }
    return filterCommands(COMMANDS, tab, query).map((c) => ({
      key: c.id, label: titleOf(c, tab), detail: c.group, hint: c.shortcut ? shortcutLabel(c.shortcut) : undefined,
      run: () => (c.pick ? startPick(c) : finish(() => c.run?.(tab!))),
    }));
  }, [stage, query, tab]);
  const current = Math.min(active, Math.max(0, rows.length - 1));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const move = matchCombo(e, PALETTE_MOVE_KEY);
    if (move) {
      e.preventDefault();
      if (rows.length) setActive((current + (move.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (matches(e, PALETTE_RUN_KEY)) {
      e.preventDefault();
      rows[current]?.run();
    }
  };
  // PALETTE_BACK_KEY: Radix sees Esc first (a document listener); in a pick it goes back to the commands instead of closing.
  const onEscape = (e: Event) => {
    if (!stage) return;
    e.preventDefault();
    setStage(null);
    setQuery('');
    setActive(0);
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const placeholder = stage ? stage.command.pick!.placeholder : 'Type a command';
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeOverlay(); }}>
      <DialogContent className="top-[15%] translate-y-0 gap-2 p-2 sm:max-w-xl" showCloseButton={false} onEscapeKeyDown={onEscape}>
        <DialogTitle className="sr-only">{stage ? titleOf(stage.command, tab) : 'Commands'}</DialogTitle>
        <DialogDescription className="sr-only">Type to filter, arrows to move, Enter to run.</DialogDescription>
        <Input
          autoFocus
          role="combobox"
          aria-label={stage ? titleOf(stage.command, tab) : 'Command'}
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={rows.length ? optionId(current) : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
        />
        {stage?.error && <p role="alert" className="px-2 text-sm text-destructive">{stage.error}</p>}
        <ul id={listId} role="listbox" aria-label={stage ? titleOf(stage.command, tab) : 'Commands'} className="max-h-[60dvh] overflow-y-auto">
          {stage && !stage.items && <li className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</li>}
          {rows.map((r, i) => (
            <li
              key={r.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              className={cn('flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm', i === current && 'bg-accent text-accent-foreground')}
              onMouseMove={() => setActive(i)}
              onClick={r.run}
            >
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {r.detail && <span className="text-xs text-muted-foreground">{r.detail}</span>}
              {r.hint && <kbd className="rounded border px-1 font-mono text-xs text-muted-foreground">{r.hint}</kbd>}
            </li>
          ))}
          {!rows.length && (!stage || stage.items) && <li className="px-2 py-1.5 text-sm text-muted-foreground">No matching {stage ? 'item' : 'command'}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
