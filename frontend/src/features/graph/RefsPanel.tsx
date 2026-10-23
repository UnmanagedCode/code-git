import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { clip } from '@/lib/clip';
import { ArchiveIcon, ChevronDownIcon, ChevronRightIcon, CloudIcon, EyeIcon, EyeOffIcon, FolderGit2Icon, GitBranchIcon, PinIcon, PlusIcon, TagIcon, TargetIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { TrackingBadge } from '@/features/branches/TrackingBadge';
import { ContextMenuHost, openContextMenu } from '@/shell/ContextMenuHost';
import { runPrimary } from '@/shell/menus';
import { useGraphData } from '@/state/graph';
import { openRemoteDialog } from '@/state/remoteDialog';
import { useRemotes } from '@/state/remotes';
import { toggled, updatePrefs, useGraphPrefs, type GraphPrefs, type Section } from '@/state/graphPrefs';
import { dispatchRefSelection, selectedRefs, useRefSelection } from '@/state/refSelection';
import { prefsKey, type Tab } from '@/state/tabs';
import { CONTEXT, type BranchesCtx, type RefCtx, type RemoteCtx, type StashCtx, type WorktreeCtx } from './contexts';
import { startBranchDrag, toDragRef, useDropActive } from './drag';
import { requestJump } from './jump';
import { WIDE_GRAPH_QUERY } from './media';
import { ownWorktree, worktreeName } from './labels';
import type { Checkout, GitWorktree, Ref, Stash } from './types';
import { resolveVisibility, sectionOf, type Visibility } from './visibility';

const HOST = 'refs';
/** Rows a list shows before "Show more", and how many each click adds: the filter finds the rest. */
export const REFS_SHOWN = 200;

/**
 * The refs panel (left slot; a dialog on narrow screens): sections with hide / solo / pin, a filter, jump on click,
 * double-click for the ref's primary action, Ctrl/⌘- and Shift-click to select branches.
 */
export function RefsPanel({ tab, inDialog = false }: { tab: Tab | null; inDialog?: boolean }) {
  const wide = useMediaQuery(WIDE_GRAPH_QUERY);
  if (!tab || (!inDialog && !wide)) return null;
  return <RefsView tab={tab} inDialog={inDialog} />;
}

function IconToggle({ label, on, disabled, onClick, children }: { label: string; on: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:pointer-events-none',
        on ? 'text-warning opacity-100' : disabled ? 'opacity-0 group-hover:opacity-30' : 'opacity-0 group-hover:opacity-100',
      )}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {children}
    </button>
  );
}

function RefsView({ tab, inDialog }: { tab: Tab; inDialog: boolean }) {
  const data = useGraphData(tab);
  const listed = useRemotes(tab);
  const prefs = useGraphPrefs(prefsKey(tab));
  const selection = useRefSelection(tab);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [limits, setLimits] = useState<Readonly<Record<string, number>>>({});
  /** The first rows of list `id`, and a "Show more" item when it has more. */
  const capped = <T,>(id: string, list: T[], render: (x: T) => ReactNode) => {
    const n = limits[id] ?? REFS_SHOWN;
    return (
      <>
        {list.slice(0, n).map(render)}
        {list.length > n && (
          <li className="py-0.5 pl-5">
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setLimits((l) => ({ ...l, [id]: n + REFS_SHOWN }))}>
              Show {Math.min(REFS_SHOWN, list.length - n)} more of {list.length - n}
            </button>
          </li>
        )}
      </>
    );
  };
  const vis = useMemo(() => (data.refs ? resolveVisibility(data.refs, prefs) : null), [data.refs, prefs]);
  // A graph that never opened (the checkout is not a repo) has no refs to wait for.
  if (data.status === 'idle') return null;
  if (!data.refs || !vis) return <p className="p-3 text-sm text-muted-foreground">{data.status === 'error' ? 'Refs could not be loaded.' : 'Loading refs…'}</p>;
  const refs = data.refs;
  const f = filter.trim().toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);
  const set = (fn: (p: GraphPrefs) => GraphPrefs) => updatePrefs(prefsKey(tab), fn);
  const toggleCollapsed = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const menu = (e: MouseEvent, context: string, ctx: unknown) => {
    e.preventDefault();
    openContextMenu({ host: HOST, context, ctx, at: { x: e.clientX, y: e.clientY } });
  };

  const byKind = (k: Ref['kind']) => refs.refs.filter((r) => r.kind === k && match(r.short));
  const pinnedFirst = (list: Ref[]) => [...list.filter((r) => prefs.pinned.includes(r.name)), ...list.filter((r) => !prefs.pinned.includes(r.name))];
  const locals = pinnedFirst(byKind('local'));
  const remotes = pinnedFirst(byKind('remote'));
  // Every listed remote shows, one with no fetched branch too.
  const remoteNames = [...new Set([...refs.refs.filter((r) => r.kind === 'remote').map((r) => r.remote ?? ''), ...(listed.data ?? []).map((r) => r.name)])].sort();
  const tags = byKind('tag');
  const stashes = refs.stashes.filter((s) => match(s.selector) || match(s.subject));
  const own = refs.worktrees ? ownWorktree(refs.head, refs.worktrees) : null;
  const worktrees = (refs.worktrees ?? []).filter((w) => !w.bare && match(worktreeName(w, data.checkouts).name));
  /** The branch rows as displayed, top to bottom: what a Shift-click range spans. */
  const order = [...locals, ...remoteNames.flatMap((n) => remotes.filter((r) => r.remote === n))].map((r) => r.name);
  /** A row of a multi-selection opens the selection's menu; any other row its own. */
  const branchMenu = (e: MouseEvent, r: Ref) => {
    const picked = selectedRefs(tab, refs.refs);
    if (picked.length >= 2 && picked.some((x) => x.name === r.name)) return menu(e, CONTEXT.branches, { tab, refs: picked } satisfies BranchesCtx);
    menu(e, CONTEXT.branch, { tab, ref: r } satisfies RefCtx);
  };
  const branchRow = (r: Ref, indent = false) => (
    <RefRow key={r.name} tab={tab} r={r} vis={vis} prefs={prefs} all={refs.refs} indent={indent} selected={selection.names.includes(r.name)} order={order}
      onMenu={(e) => branchMenu(e, r)} />
  );

  const sectionHidden = (s: Section, list: Ref[]) => prefs.hiddenSections.includes(s) || list.some((r) => prefs.hidden.includes(r.name))
    || (s === 'remote' && prefs.hiddenRemotes.length > 0);
  const showAll = (s: Section) => set((p) => ({
    ...p, hiddenSections: p.hiddenSections.filter((x) => x !== s),
    hidden: s === 'stashes' ? p.hidden : p.hidden.filter((n) => !refs.refs.some((r) => r.name === n && sectionOf(r) === s)),
    hiddenRemotes: s === 'remote' ? [] : p.hiddenRemotes,
  }));

  const head = (s: Section | 'worktrees', title: string, count: number, list: Ref[] = [], extra?: ReactNode) => (
    <div className="group flex items-center gap-1 px-2 pt-2 pb-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" aria-expanded={!collapsed.has(s)} onClick={() => toggleCollapsed(s)}>
        {collapsed.has(s) ? <ChevronRightIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
        <span className="truncate">{title}</span>
        <span className="font-normal">{count}</span>
      </button>
      {s !== 'worktrees' && sectionHidden(s, list) && (
        <button type="button" className="rounded px-1 font-normal normal-case hover:bg-accent hover:text-foreground" onClick={() => showAll(s)}>Show all</button>
      )}
      {s !== 'worktrees' && (
        <IconToggle label={`${prefs.hiddenSections.includes(s) ? 'Show' : 'Hide'} ${title}`} on={prefs.hiddenSections.includes(s)}
          onClick={() => set((p) => ({ ...p, hiddenSections: toggled(p.hiddenSections, s, !p.hiddenSections.includes(s)) }))}>
          {prefs.hiddenSections.includes(s) ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        </IconToggle>
      )}
      {s !== 'worktrees' && s !== 'stashes' && (
        <IconToggle label={`${prefs.soloedSections.includes(s) ? 'Unsolo' : 'Solo'} ${title}`} on={prefs.soloedSections.includes(s)}
          onClick={() => set((p) => ({ ...p, soloedSections: toggled(p.soloedSections, s, !p.soloedSections.includes(s)) }))}>
          <TargetIcon className="size-3.5" />
        </IconToggle>
      )}
      {extra}
    </div>
  );

  return (
    // In the left slot the refs scroll on their own, so the Compare panel below them stays in reach.
    <nav className={cn('flex flex-col pb-3 text-sm', !inDialog && 'max-h-[60dvh] overflow-y-auto border-b')} aria-label="Refs">
      <div className="p-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter refs" aria-label="Filter refs" className="h-8" />
      </div>

      {head('local', 'Local', locals.length, locals)}
      {!collapsed.has('local') && (
        <ul aria-label="Local branches">
          {capped('local', locals, (r) => branchRow(r))}
        </ul>
      )}

      {head('remote', 'Remotes', remotes.length, remotes, (
        <button type="button" aria-label="Add remote" title="Add remote"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => openRemoteDialog({ kind: 'add', tab })}>
          <PlusIcon className="size-3.5" />
        </button>
      ))}
      {!collapsed.has('remote') && remoteNames.map((name) => {
        const list = remotes.filter((r) => r.remote === name);
        if (f && !list.length) return null;
        const id = `remote:${name}`;
        const hidden = prefs.hiddenRemotes.includes(name);
        const soloed = prefs.soloedRemotes.includes(name);
        return (
          <div key={name}>
            <div className="group flex items-center gap-1 py-0.5 pr-2 pl-4" onContextMenu={(e) => menu(e, CONTEXT.remote, { tab, remote: name } satisfies RemoteCtx)}>
              <button type="button" className={cn('flex min-w-0 flex-1 items-center gap-1 text-left', hidden && 'opacity-50')} aria-expanded={!collapsed.has(id)} onClick={() => toggleCollapsed(id)}>
                {collapsed.has(id) ? <ChevronRightIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
                <CloudIcon className="size-3.5 text-muted-foreground" />
                <span className="truncate">{clip(name)}</span>
              </button>
              <IconToggle label={`${hidden ? 'Show' : 'Hide'} remote ${clip(name)}`} on={hidden} onClick={() => set((p) => ({ ...p, hiddenRemotes: toggled(p.hiddenRemotes, name, !hidden) }))}>
                {hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
              </IconToggle>
              <IconToggle label={`${soloed ? 'Unsolo' : 'Solo'} remote ${clip(name)}`} on={soloed} onClick={() => set((p) => ({ ...p, soloedRemotes: toggled(p.soloedRemotes, name, !soloed) }))}>
                <TargetIcon className="size-3.5" />
              </IconToggle>
            </div>
            {!collapsed.has(id) && (
              <ul aria-label={`Branches on ${clip(name)}`}>
                {capped(id, list, (r) => branchRow(r, true))}
              </ul>
            )}
          </div>
        );
      })}

      {head('tags', 'Tags', tags.length, tags)}
      {!collapsed.has('tags') && (
        <ul aria-label="Tags">
          {capped('tags', tags, (r) => <RefRow key={r.name} tab={tab} r={r} vis={vis} prefs={prefs} all={refs.refs} onMenu={(e) => menu(e, CONTEXT.tag, { tab, ref: r } satisfies RefCtx)} />)}
        </ul>
      )}

      {head('stashes', 'Stashes', stashes.length)}
      {!collapsed.has('stashes') && (
        <ul aria-label="Stashes">
          {capped('stashes', stashes, (s) => <StashRow key={s.oid} tab={tab} s={s} hidden={!vis.stashesVisible} onMenu={(e) => menu(e, CONTEXT.stash, { tab, stash: s } satisfies StashCtx)} />)}
        </ul>
      )}

      {head('worktrees', 'Worktrees', worktrees.length)}
      {!collapsed.has('worktrees') && (
        <>
          {refs.worktreesError !== null && (
            <p className="px-4 py-1 text-xs text-warning" role="note">Worktree labels need git 2.36 or later: {clip(refs.worktreesError)}</p>
          )}
          <ul aria-label="Worktrees">
            {capped('worktrees', worktrees, (w) => (
              <WorktreeRow key={w.path} tab={tab} w={w} isOwn={w === own} checkouts={data.checkouts}
                onMenu={(e, cc) => menu(e, CONTEXT.worktree, { tab, worktree: w, ccCheckout: cc } satisfies WorktreeCtx)} />
            ))}
          </ul>
        </>
      )}
      <ContextMenuHost host={HOST} />
    </nav>
  );
}

const KIND_ICON = { local: GitBranchIcon, remote: CloudIcon, tag: TagIcon } as const;

function RefRow({ tab, r, vis, prefs, all, indent = false, selected = false, order = [], onMenu }: {
  tab: Tab; r: Ref; vis: Visibility; prefs: GraphPrefs; all: Ref[]; indent?: boolean; selected?: boolean; order?: string[]; onMenu: (e: MouseEvent) => void;
}) {
  const Icon = KIND_ICON[r.kind];
  const shown = vis.visible.has(r.name);
  const hidden = prefs.hidden.includes(r.name);
  const soloed = prefs.soloed.includes(r.name);
  const pinned = prefs.pinned.includes(r.name);
  const set = (fn: (p: GraphPrefs) => GraphPrefs) => updatePrefs(prefsKey(tab), fn);
  const jump = () => { if (r.oid) requestJump(tab, r.oid); };
  const isBranch = r.kind !== 'tag';
  /** Ctrl/⌘ toggles the row into the selection, Shift selects the range; a plain click clears it and jumps. */
  const onNameClick = (e: MouseEvent) => {
    if (isBranch && (e.ctrlKey || e.metaKey)) return dispatchRefSelection(tab, { type: 'toggle', name: r.name });
    if (isBranch && e.shiftKey) return dispatchRefSelection(tab, { type: 'range', name: r.name, order });
    dispatchRefSelection(tab, { type: 'clear' });
    jump();
  };
  const source = toDragRef(r);
  const dropActive = useDropActive(source ? r.name : '\0');
  return (
    <li
      className={cn('group flex items-center gap-1 py-0.5 pr-2', indent ? 'pl-9' : 'pl-5', !shown && 'opacity-50', (dropActive || selected) && 'bg-accent', dropActive && 'ring-2 ring-ring ring-inset')}
      data-ref={r.name}
      data-selected={selected ? '' : undefined}
      data-drop-ref={source ? r.name : undefined}
      data-drop-active={dropActive ? '' : undefined}
      onContextMenu={onMenu}
      onPointerDown={(e) => {
        if (source) startBranchDrag(e, { tab, source, host: HOST, resolve: (n) => { const x = all.find((y) => y.name === n); return x ? toDragRef(x) : null; } });
      }}
    >
      {pinned ? (
        <button type="button" aria-label={`Jump to pinned ${clip(r.short)}`} className="shrink-0 text-primary" onClick={jump}><PinIcon className="size-3.5" /></button>
      ) : <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
      <button type="button" className={cn('min-w-0 flex-1 truncate text-left hover:underline', r.isHead && 'font-semibold')} title={clip(r.name)} disabled={!r.oid}
        onClick={onNameClick} onDoubleClick={() => runPrimary(isBranch ? CONTEXT.branch : CONTEXT.tag, { tab, ref: r } satisfies RefCtx)}>
        {clip(r.kind === 'remote' && r.remote ? r.short.slice(r.remote.length + 1) : r.short)}
        {selected && <span className="sr-only"> (selected)</span>}
      </button>
      {r.kind === 'local' && <TrackingBadge tab={tab} ref={r.name} />}
      {r.kind !== 'tag' && (
        <IconToggle label={pinned ? `Unpin ${clip(r.short)}` : `Pin ${clip(r.short)} to left`} on={pinned} onClick={() => set((p) => ({ ...p, pinned: toggled(p.pinned, r.name, !pinned) }))}>
          <PinIcon className="size-3.5" />
        </IconToggle>
      )}
      <IconToggle label={`${hidden ? 'Show' : 'Hide'} ${clip(r.short)}`} on={hidden} disabled={r.isHead} onClick={() => set((p) => ({ ...p, hidden: toggled(p.hidden, r.name, !hidden) }))}>
        {hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
      </IconToggle>
      <IconToggle label={`${soloed ? 'Unsolo' : 'Solo'} ${clip(r.short)}`} on={soloed} onClick={() => set((p) => ({ ...p, soloed: toggled(p.soloed, r.name, !soloed) }))}>
        <TargetIcon className="size-3.5" />
      </IconToggle>
    </li>
  );
}

function StashRow({ tab, s, hidden, onMenu }: { tab: Tab; s: Stash; hidden: boolean; onMenu: (e: MouseEvent) => void }) {
  return (
    <li className={cn('flex items-center gap-1 py-0.5 pr-2 pl-5', hidden && 'opacity-50')} onContextMenu={onMenu}>
      <ArchiveIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" title={clip(s.subject)}
        onClick={() => { if (s.parents[0]) requestJump(tab, s.parents[0], `stash:${s.oid}`); }}>
        <span className="font-mono text-xs text-muted-foreground">{s.selector}</span> {clip(s.subject)}
      </button>
    </li>
  );
}

function WorktreeRow({ tab, w, isOwn, checkouts, onMenu }: {
  tab: Tab; w: GitWorktree; isOwn: boolean; checkouts: Checkout[]; onMenu: (e: MouseEvent, cc: Checkout['target'] | null) => void;
}) {
  const { name, checkout } = worktreeName(w, checkouts);
  const n = checkout?.counts;
  const dirty = !!n && n.staged + n.unstaged + n.untracked + n.conflicted > 0;
  return (
    <li className="flex items-center gap-1.5 py-0.5 pr-2 pl-5" onContextMenu={(e) => onMenu(e, checkout?.target ?? null)} data-worktree={name}>
      <FolderGit2Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <button type="button" className={cn('min-w-0 flex-1 truncate text-left hover:underline', isOwn && 'font-semibold')} title={clip(w.path)}
        disabled={!w.head} onClick={() => { if (w.head) requestJump(tab, w.head); }}>
        {clip(name)}
        <span className="ml-1.5 font-mono text-xs text-muted-foreground">{clip(w.branch ? w.branch.replace(/^refs\/heads\//, '') : w.head?.slice(0, 7) ?? '')}</span>
      </button>
      {dirty && <Badge variant="info">dirty</Badge>}
      {w.locked && <Badge variant="outline">locked</Badge>}
    </li>
  );
}
