import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon, EllipsisVerticalIcon, FolderIcon, FolderOpenIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { clip, FILE_RENDER_CAP } from '@/lib/clip';
import { isTextEntry } from '@/lib/textEntry';
import { cn } from '@/lib/utils';
import { ActionMenuItems } from '@/shell/ActionMenu';
import { matchCombo, matches, pointerMods } from '@/shell/shortcuts';
import { revealPath, setDirCollapsed, useCollapsedDirs } from '@/state/collapsedDirs';
import { setFileView, useFileView } from '@/state/fileView';
import type { Tab } from '@/state/tabs';
import { buildFileTree, orderedFiles, statusClass, type TreeDir, type TreeNode } from './fileTree';
import { FILE_FOLDER_KEY, FILE_MOVE_KEY, FILE_OPEN_KEY } from './keys';

// The one file list: a commit's details, the Changes panel's sections and every open diff's files render it.

export const STATUS_LABEL: Record<string, string> = {
  A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed', U: 'conflicted', '?': 'untracked',
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

/** What a row needs: DiffFile (diff.files) and CommitFile (graph.commit) both are one. */
export interface ListFile {
  path: string;
  oldPath: string | null;
  status: string;
  added: number | null;
  deleted: number | null;
  binary: boolean;
  submodule: boolean;
}

export const fileLabel = (f: { path: string; oldPath: string | null }): string => (f.oldPath ? `${f.oldPath} → ${f.path}` : f.path);

/**
 * A file's line counts: `+a −d`; "binary" or "submodule" instead of numbers (a gitlink's numstat counts its
 * `Subproject commit` line); nothing for an untracked or conflicted file (no numstat to show).
 */
export function FileCounts({ file }: { file: Pick<ListFile, 'status' | 'added' | 'deleted' | 'binary' | 'submodule'> }) {
  const muted = 'shrink-0 font-mono text-xs text-muted-foreground';
  if (file.status === '?' || file.status === 'U') return null;
  if (file.submodule) return <span className={muted}>submodule</span>;
  if (file.binary) return <span className={muted}>binary</span>;
  if (file.added === null || file.deleted === null) return null;
  return (
    <span className={muted} aria-label={`${file.added} added, ${file.deleted} deleted`}>
      <span className="text-success">+{file.added}</span> <span className="text-destructive">−{file.deleted}</span>
    </span>
  );
}

/** Path / Tree: the one persisted choice every file list follows. */
export function FileViewToggle() {
  const view = useFileView();
  return (
    <div className="flex" role="group" aria-label="File view">
      {(['path', 'tree'] as const).map((v) => (
        <Button key={v} variant={view === v ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={view === v} onClick={() => setFileView(v)}>
          {v === 'path' ? 'Path' : 'Tree'}
        </Button>
      ))}
    </div>
  );
}

interface Props<F extends ListFile> {
  /** Whose collapsed Tree folders the list shows (one set per tab, shared by its lists). */
  tab: Tab;
  /** The listbox's accessible name. */
  label: string;
  files: readonly F[];
  /** The file the diff shows (aria-current). */
  viewed?: string | null;
  /** Selected paths (aria-selected). */
  selected?: readonly string[];
  /** Ctrl/⌘-click toggles a row, Shift-click extends over the displayed order; without it every click is plain. */
  multi?: boolean;
  /** ↑/↓ also select the row they move to. */
  followFocus?: boolean;
  /** `plain`: a plain click or Enter (not a toggle, an extend or a move that follows the focus). */
  onSelect: (selected: string[], viewed: F, plain: boolean) => void;
  /** Row buttons, revealed on hover and focus; their clicks must stop propagating. */
  actions?: (f: F) => ReactNode;
  /** A Tree directory's buttons, given every file beneath it (those past the render cap too). */
  dirActions?: (files: F[], dirPath: string) => ReactNode;
  /** The row menu (⋮ and right-click): `targets` is the selection when the row is in it, else the row alone. */
  menu?: (f: F, targets: F[]) => { context: string; ctx: unknown };
  /** Keys a host adds on a focused row (after ↑/↓ and Enter). */
  onRowKeyDown?: (e: KeyboardEvent, f: F) => void;
}

const INDENT = ['ml-0', 'ml-4', 'ml-8', 'ml-12'];
const indent = (depth: number) => INDENT[Math.min(depth, INDENT.length - 1)];

function Row<F extends ListFile>({ file, name, depth, viewed, selected, actions, menu, onClick }: {
  file: F; name: string; depth: number; viewed: boolean; selected: boolean;
  actions?: ReactNode; menu?: { context: string; ctx: unknown }; onClick: (e: MouseEvent) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li
      role="option"
      tabIndex={0}
      aria-selected={selected}
      aria-current={viewed ? 'true' : undefined}
      data-path={file.path}
      title={clip(fileLabel(file))}
      className={cn(
        'group flex cursor-default items-center gap-2 px-2 py-0.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50', viewed && 'font-medium',
      )}
      onClick={onClick}
      onContextMenu={menu && ((e) => { e.preventDefault(); setMenuOpen(true); })}
    >
      <span className={cn('w-3 shrink-0 text-center font-mono font-semibold', statusClass(file.status), indent(depth))} aria-label={statusLabel(file.status)} title={statusLabel(file.status)}>
        {file.status}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono">{clip(name)}</span>
      <FileCounts file={file} />
      {(actions || menu) && (
        <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100">
          {actions}
          {menu && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-5" aria-label={`Actions for ${file.path}`} onClick={(e) => e.stopPropagation()}>
                  <EllipsisVerticalIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              {/* Portalled, but React still bubbles its clicks to the row. */}
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <ActionMenuItems context={menu.context} ctx={menu.ctx} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      )}
    </li>
  );
}

/**
 * Files as full paths or a directory tree (the shared File view choice), each with its status, line counts, row buttons
 * and menu. ↑/↓ move the focus from file row to file row in the displayed order (directory rows and collapsed folders'
 * files are skipped), Enter selects the focused row; a Tree folder collapses and expands by click, Enter / Space or ←/→.
 * The first FILE_RENDER_CAP files render until "Show all N".
 */
export function FileList<F extends ListFile>({
  tab, label, files, viewed = null, selected, multi = false, followFocus = false, onSelect, actions, dirActions, menu, onRowKeyDown,
}: Props<F>) {
  const view = useFileView();
  const collapsed = useCollapsedDirs(tab);
  const [all, setAll] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const viewedIndex = viewed === null ? -1 : files.findIndex((f) => f.path === viewed);
  useEffect(() => { if (viewedIndex >= FILE_RENDER_CAP) setAll(true); }, [viewedIndex]);
  // The viewed file's folders open when it (or the view) changes, never when the user collapses one.
  useEffect(() => { if (view === 'tree' && viewed) revealPath(tab, viewed); }, [viewed, view]);
  const shown = useMemo(() => (all ? files : files.slice(0, FILE_RENDER_CAP)), [files, all]);
  const tree = useMemo(() => (view === 'tree' ? buildFileTree(shown) : null), [shown, view]);
  const ordered = useMemo(() => orderedFiles(shown, view, collapsed), [shown, view, collapsed]);
  const byPath = useMemo(() => new Map(shown.map((f) => [f.path, f])), [shown]);
  // A directory's actions act on every file beneath it, rendered under the cap or not.
  const underDir = useMemo(() => {
    const m = new Map<string, F[]>();
    if (view !== 'tree' || !dirActions) return m;
    const walk = (nodes: TreeNode<F>[]): F[] => nodes.flatMap((n) => {
      if (n.kind === 'file') return [n.file];
      const under = walk(n.children);
      m.set(n.path, under);
      return under;
    });
    walk(buildFileTree(files));
    return m;
  }, [files, view, !!dirActions]);
  const sel = selected ?? [];

  const click = (f: F) => (e: MouseEvent) => {
    const mods = multi ? pointerMods(e) : { shift: false, mod: false };
    if (mods.shift) {
      const from = ordered.findIndex((x) => x.path === (anchor ?? viewed));
      const to = ordered.indexOf(f);
      const [a, b] = from === -1 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
      onSelect(ordered.slice(a, b + 1).map((x) => x.path), f, false);
      return;
    }
    setAnchor(f.path);
    if (mods.mod) {
      const next = sel.includes(f.path) ? sel.filter((p) => p !== f.path) : [...sel, f.path];
      onSelect(next.length ? next : [f.path], f, false);
      return;
    }
    onSelect([f.path], f, true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as Element;
    // Keys from a row's portalled menu bubble here through React, never through the DOM.
    if (!e.currentTarget.contains(target) || isTextEntry(target)) return;
    const row = target.closest<HTMLElement>('li[role="option"]');
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('li[role="option"]')];
    const move = matchCombo(e, FILE_MOVE_KEY);
    if (move) {
      e.preventDefault();
      const down = move.key === 'ArrowDown';
      // From a row (or a button in it): the row beside it. From a folder's toggle or buttons: the nearest row that way.
      const next = row
        ? rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + (down ? 1 : -1)))]
        : down
          ? rows.find((r) => target.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING)
          : rows.findLast((r) => target.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_PRECEDING);
      next?.focus();
      const f = next && byPath.get(next.dataset.path ?? '');
      if (followFocus && f && next !== row) onSelect([f.path], f, false);
      return;
    }
    const fold = matchCombo(e, FILE_FOLDER_KEY);
    const dir = target instanceof HTMLElement && target.matches('button[data-dir]') ? target.dataset.dir : undefined;
    if (fold && dir !== undefined) {
      e.preventDefault();
      setDirCollapsed(tab, dir, fold.key === 'ArrowLeft');
      return;
    }
    // The rest act on the row itself, not on a button inside it.
    const f = row && row === target ? byPath.get(row.dataset.path ?? '') : undefined;
    if (!f) return;
    if (matches(e, FILE_OPEN_KEY)) { e.preventDefault(); onSelect([f.path], f, true); return; }
    onRowKeyDown?.(e, f);
  };

  const row = (f: F, name: string, depth: number) => {
    const inSel = sel.includes(f.path);
    return (
      <Row
        key={`${f.oldPath ?? ''}\0${f.path}`}
        file={f}
        name={name}
        depth={depth}
        viewed={f.path === viewed}
        selected={inSel}
        actions={actions?.(f)}
        menu={menu?.(f, inSel ? files.filter((x) => sel.includes(x.path)) : [f])}
        onClick={click(f)}
      />
    );
  };
  const dirRow = (n: TreeDir<F>, depth: number) => {
    const open = !collapsed.has(n.path);
    // Like a collapsed refs folder holding HEAD: a collapsed folder holding the viewed file stands out.
    const holdsViewed = !open && viewed !== null && viewed.startsWith(`${n.path}/`);
    return (
      <li key={`d:${n.path}`} role="presentation">
        <div className="group flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground">
          <button
            type="button"
            data-dir={n.path}
            aria-label={clip(n.path)}
            aria-expanded={open}
            title={clip(n.path)}
            className={cn('flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring', holdsViewed && 'font-medium text-foreground')}
            onClick={() => setDirCollapsed(tab, n.path, open)}
          >
            {open ? <ChevronDownIcon className={cn('size-3.5 shrink-0', indent(depth))} /> : <ChevronRightIcon className={cn('size-3.5 shrink-0', indent(depth))} />}
            {open ? <FolderOpenIcon className="size-3.5 shrink-0" /> : <FolderIcon className="size-3.5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{clip(n.name)}</span>
          </button>
          {dirActions && (
            <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
              {dirActions(underDir.get(n.path) ?? [], n.path)}
            </span>
          )}
        </div>
        {open && <ul role="group" aria-label={clip(n.path)}>{renderTree(n.children, depth + 1)}</ul>}
      </li>
    );
  };
  const renderTree = (nodes: TreeNode<F>[], depth: number): ReactNode => nodes.map((n) => (n.kind === 'file'
    ? row(n.file, n.file.oldPath ? `${n.file.oldPath} → ${n.name}` : n.name, depth)
    : dirRow(n, depth)));

  return (
    <>
      <ul role="listbox" aria-label={label} aria-multiselectable={multi || undefined} className="py-1" onKeyDown={onKeyDown}>
        {tree ? renderTree(tree, 0) : shown.map((f) => row(f, fileLabel(f), 0))}
      </ul>
      {shown.length < files.length && (
        <Button variant="ghost" size="sm" className="mb-1 ml-2 h-6 px-2 text-xs" onClick={() => setAll(true)}>Show all {files.length}</Button>
      )}
    </>
  );
}
