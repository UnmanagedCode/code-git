import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { diffStore, setSelection } from '@/state/diff';
import { useStore } from '@/state/store';
import { tabKey, type Tab } from '@/state/tabs';
import type { DiffFileCtx } from './actions';
import { FileList, FileViewToggle, type ListFile } from './FileList';
import { patchSource } from './patch';

/**
 * The file list bound to the tab's open diff: a click, ↑/↓ or Enter picks the file it shows (no refetch), Ctrl/⌘- and
 * Shift-click select files for the `'diff-file'` menu and the selection patch. Until the list loads it shows `fallback`
 * (the same files from elsewhere, e.g. the commit details') or "Loading files…"; on a list error nothing (the diff
 * shows it). `onPicked` follows a plain pick (the narrow dialog closes on it).
 */
export function DiffFileList({ tab, fallback, onPicked }: { tab: Tab; fallback?: readonly ListFile[]; onPicked?: () => void }) {
  const state = useStore(diffStore).get(tabKey(tab));
  if (!state) return null;
  const { result, error } = state.list;
  const pick = (sel: string[], path: string, plain: boolean) => { setSelection(tab, sel, path); if (plain) onPicked?.(); };
  if (!result) {
    if (error) return null;
    return fallback
      ? <FileList label="Changed files" files={fallback} viewed={state.viewed} onSelect={(sel, f, plain) => pick(sel, f.path, plain)} />
      : <p className="px-3 py-2 text-xs text-muted-foreground">Loading files…</p>;
  }
  const source = patchSource(state.source, result);
  return (
    <FileList
      label="Changed files"
      files={result.files}
      viewed={state.viewed}
      selected={state.selected}
      multi
      followFocus
      onSelect={(sel, f, plain) => pick(sel, f.path, plain)}
      menu={(_f, targets) => ({ context: 'diff-file', ctx: { tab, files: targets, source } satisfies DiffFileCtx })}
    />
  );
}

/** Below `lg` (no right slot): the diff header's Files (n), the bound list as a dialog. */
export function DiffFilesButton({ tab, count }: { tab: Tab; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs lg:hidden" onClick={() => setOpen(true)}>Files ({count})</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Portalled, but its keys would still bubble to the diff's own (Esc would close the diff). */}
        <DialogContent className="max-h-[85dvh] gap-2 p-0" onKeyDown={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 px-4 pt-4 pr-12">
            <DialogTitle className="flex-1">Changed files</DialogTitle>
            <FileViewToggle />
          </div>
          <DialogDescription className="sr-only">Pick the file the diff shows</DialogDescription>
          <div className="max-h-[70dvh] overflow-y-auto pb-2"><DiffFileList tab={tab} onPicked={() => setOpen(false)} /></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
