import { useState, type MouseEvent } from 'react';
import { EllipsisVerticalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ActionMenuItems } from '@/shell/ActionMenu';
import type { Tab } from '@/state/tabs';
import type { DiffFile, DiffSource, FileStatus } from './api';
import type { DiffFileCtx } from './actions';
import { matchCombo, pointerMods } from '@/shell/shortcuts';
import { DIFF_FILE_MOVE_KEY } from './keys';

export const STATUS_LABEL: Record<FileStatus, string> = {
  A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', U: 'conflicted', '?': 'untracked',
};
const STATUS_CLASS: Partial<Record<FileStatus, string>> = { A: 'text-success', '?': 'text-success', D: 'text-destructive', U: 'text-destructive', R: 'text-info', C: 'text-info' };

export const fileLabel = (f: DiffFile): string => (f.oldPath ? `${f.oldPath} → ${f.path}` : f.path);

interface Props {
  tab: Tab;
  files: DiffFile[];
  selected: string[];
  viewed: string | null;
  patchSource: DiffSource;
  onSelect: (selected: string[], viewed: string) => void;
  className?: string;
}

function Row({ tab, file, files, selected, viewed, patchSource, onClick }: {
  tab: Tab; file: DiffFile; files: DiffFile[]; selected: string[]; viewed: boolean; patchSource: DiffSource; onClick: (e: MouseEvent) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isSel = selected.includes(file.path);
  // The menu acts on the selection when the row is part of it, else on the row alone.
  const ctx: DiffFileCtx = { tab, source: patchSource, files: isSel ? files.filter((f) => selected.includes(f.path)) : [file] };
  return (
    <li
      role="option"
      aria-selected={isSel}
      aria-current={viewed || undefined}
      data-path={file.path}
      className={cn('group flex cursor-default items-center gap-2 px-2 py-0.5 text-xs', isSel ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50', viewed && 'font-medium')}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
    >
      <span className={cn('w-3 shrink-0 text-center font-mono font-semibold', STATUS_CLASS[file.status])} aria-label={STATUS_LABEL[file.status]} title={STATUS_LABEL[file.status]}>
        {file.status}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono" title={fileLabel(file)}>{fileLabel(file)}</span>
      {file.added !== null && file.deleted !== null && (
        <span className="shrink-0 font-mono text-muted-foreground" aria-label={`${file.added} added, ${file.deleted} deleted`}>
          <span className="text-success">+{file.added}</span> <span className="text-destructive">−{file.deleted}</span>
        </span>
      )}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`Actions for ${file.path}`} onClick={(e) => e.stopPropagation()}>
            <EllipsisVerticalIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <ActionMenuItems context="diff-file" ctx={ctx} />
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** The diff's files: click views one, Ctrl/⌘-click toggles it in the selection, Shift-click extends the selection. */
export function FileList({ tab, files, selected, viewed, patchSource, onSelect, className }: Props) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const click = (f: DiffFile) => (e: MouseEvent) => {
    const mods = pointerMods(e);
    if (mods.shift) {
      const from = files.findIndex((x) => x.path === (anchor ?? viewed));
      const to = files.indexOf(f);
      const [a, b] = from === -1 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
      onSelect(files.slice(a, b + 1).map((x) => x.path), f.path);
      return;
    }
    setAnchor(f.path);
    if (mods.mod) {
      const next = selected.includes(f.path) ? selected.filter((p) => p !== f.path) : [...selected, f.path];
      onSelect(next.length ? next : [f.path], f.path);
      return;
    }
    onSelect([f.path], f.path);
  };
  return (
    <ul
      role="listbox"
      aria-label="Changed files"
      aria-multiselectable
      tabIndex={0}
      className={cn('py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      onKeyDown={(e) => {
        const c = matchCombo(e, DIFF_FILE_MOVE_KEY);
        if (!c) return;
        e.preventDefault();
        const i = files.findIndex((f) => f.path === viewed) + (c.key === 'ArrowDown' ? 1 : -1);
        const f = files[Math.max(0, Math.min(files.length - 1, i))];
        if (f) onSelect([f.path], f.path);
      }}
    >
      {files.map((f) => (
        <Row key={f.path} tab={tab} file={f} files={files} selected={selected} viewed={f.path === viewed} patchSource={patchSource} onClick={click(f)} />
      ))}
    </ul>
  );
}
