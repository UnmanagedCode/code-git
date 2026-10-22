import { useState, type MouseEvent, type ReactNode } from 'react';
import { FolderIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getItem, setItem } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { openContextMenu } from '@/shell/ContextMenuHost';
import { fileIntentStore, requestFileOpen } from '@/state/graphSelection';
import { useStore } from '@/state/store';
import { tabKey, type Tab } from '@/state/tabs';
import { CONTEXT, type FileCtx } from '../contexts';
import type { CommitFile } from '../types';
import { buildFileTree, statusClass, type TreeNode } from './fileTree';

/** Files rendered before "Show all N". */
export const FILE_RENDER_CAP = 1000;
const VIEW_KEY = 'graph:fileView';
type View = 'path' | 'tree';
const loadView = (): View => (getItem(VIEW_KEY) === 'tree' ? 'tree' : 'path');

/** A commit's changed files, as paths or a tree; a click asks the diff viewer to open one (requestFileOpen). */
export function FileList({ tab, commit, parent, files, host }: { tab: Tab; commit: string; parent: string | null; files: CommitFile[]; host: string }) {
  const [view, setView] = useState<View>(loadView);
  const [all, setAll] = useState(false);
  const intent = useStore(fileIntentStore);
  const shown = all ? files : files.slice(0, FILE_RENDER_CAP);
  const choose = (v: View) => { setView(v); setItem(VIEW_KEY, v); };
  const isActive = (f: CommitFile) => !!intent && tabKey(intent.tab) === tabKey(tab) && intent.commit === commit && intent.path === f.path;
  const open = (f: CommitFile) => requestFileOpen({ tab, commit, parent, path: f.path, oldPath: f.oldPath });
  const menu = (e: MouseEvent, f: CommitFile) => {
    e.preventDefault();
    openContextMenu({ host, context: CONTEXT.file, ctx: { tab, commit, parent, file: f } satisfies FileCtx, at: { x: e.clientX, y: e.clientY } });
  };
  const row = (f: CommitFile, name: string, depth: number) => (
    <li key={f.path}>
      <button
        type="button"
        className={cn('flex w-full items-center gap-2 rounded py-0.5 pr-2 text-left hover:bg-muted', isActive(f) && 'bg-accent text-accent-foreground')}
        aria-current={isActive(f) ? 'true' : undefined}
        data-file={f.path}
        title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        onClick={() => open(f)}
        onContextMenu={(e) => menu(e, f)}
      >
        <span className={cn('w-3 shrink-0 text-center font-mono text-xs font-semibold', statusClass(f.status), depth === 0 ? 'ml-1' : depth === 1 ? 'ml-5' : depth === 2 ? 'ml-9' : 'ml-13')}>{f.status}</span>
        <span className="truncate">{f.oldPath && view === 'path' ? `${f.oldPath} → ${name}` : name}</span>
      </button>
    </li>
  );
  const tree = (nodes: TreeNode[], depth: number): ReactNode => nodes.map((n) => (n.kind === 'file' ? row(n.file, n.name, depth) : (
    <li key={`d:${n.path}`}>
      <span className={cn('flex items-center gap-1 py-0.5 text-muted-foreground', depth === 0 ? 'ml-1' : depth === 1 ? 'ml-5' : depth === 2 ? 'ml-9' : 'ml-13')}>
        <FolderIcon className="size-3.5" />{n.name}
      </span>
      <ul>{tree(n.children, depth + 1)}</ul>
    </li>
  )));
  return (
    <section aria-label="Changed files" className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">{files.length} {files.length === 1 ? 'file' : 'files'}</h3>
        <div className="ml-auto flex" role="group" aria-label="File view">
          {(['path', 'tree'] as const).map((v) => (
            <Button key={v} variant={view === v ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={view === v} onClick={() => choose(v)}>
              {v === 'path' ? 'Path' : 'Tree'}
            </Button>
          ))}
        </div>
      </div>
      <ul className="text-sm">{view === 'path' ? shown.map((f) => row(f, f.path, 0)) : tree(buildFileTree(shown), 0)}</ul>
      {!all && files.length > FILE_RENDER_CAP && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setAll(true)}>Show all {files.length}</Button>
      )}
    </section>
  );
}
