import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { clip } from '@/lib/clip';
import { ArchiveIcon, ChevronDownIcon, ChevronRightIcon, CloudIcon, EyeIcon, EyeOffIcon, FolderGit2Icon, FolderIcon, FolderOpenIcon, GitBranchIcon, PinIcon, PlusIcon, TagIcon, TargetIcon } from 'lucide-react';
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
import { refTreeRows, type RefTreeRow } from './refTree';
import { resolveVisibility, sectionOf, SECTION_BASE, type Visibility } from './visibility';
import { pointerMods } from '@/shell/shortcuts';

type RefLeaf = Extract<RefTreeRow, { kind: 'ref' }>;

const HOST = 'refs';
/** Rows a list shows before "Show more", and how many each click adds: the filter finds the rest. */
export const REFS_SHOWN = 200;

/**
 * The refs panel (left slot; a dialog on narrow screens): sections with hide / solo / pin, branches grouped into
 * collapsible folders by `/` (a folder hides and solos by prefix), a filter, jump on click, double-click for the ref's
 * primary action, Ctrl/⌘- and Shift-click to select branches.
 */
export function RefsPanel({ tab, inDialog = false }: { tab: Tab | null; inDialog?: boolean }) {
  const wide = useMediaQuery(WIDE_GRAPH_QUERY);
  if (!tab || (!inDialog && !wide)) return null;
  return <RefsView tab={tab} inDialog={inDialog} />;
}

/** The fade's colour, set on the row so the overlay blends into whatever the row sits on. */
const ROW_BG = '[--refs-row-bg:var(--color-background)]';
const ROW_BG_ACTIVE = '[--refs-row-bg:var(--color-accent)]';
/** Indent per tree depth (the remote's list starts one step in); a static table, since classes cannot be built. */
const INDENT = ['pl-5', 'pl-9', 'pl-13', 'pl-17', 'pl-21', 'pl-25', 'pl-29'];
const indentFor = (level: number) => INDENT[Math.min(level, INDENT.length - 1)];

const SHOWN = 'group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100';
const CLICKABLE = 'group-hover/row:pointer-events-auto group-has-[:focus-visible]/row:pointer-events-auto';

interface Toggle { key: string; label: string; on: boolean; disabled?: boolean; onClick: () => void; icon: ReactNode }

function ToggleButton({ t, overlay }: { t: Toggle; overlay: boolean }) {
  return (
    <button
      type="button"
      aria-label={t.label}
      aria-pressed={t.on}
      disabled={t.disabled}
      className={cn(
        'flex shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40',
        overlay ? cn('size-6', CLICKABLE) : 'size-5 text-warning',
      )}
      onClick={(e) => { e.stopPropagation(); t.onClick(); }}
    >
      {t.icon}
    </button>
  );
}

/**
 * A row's name with its inactive toggles overlaid on the name's tail (shown on hover or keyboard focus), then `after`
 * and the active toggles in flow: each active one is its own compact indicator, and clicking it undoes it.
 */
function RowControls({ name, toggles, after }: { name: ReactNode; toggles: Toggle[]; after?: ReactNode }) {
  const idle = toggles.filter((t) => !t.on);
  return (
    <>
      <div className="relative flex min-w-0 flex-1">
        {name}
        {idle.length > 0 && (
          <div data-row-overlay className={cn('pointer-events-none absolute inset-y-0 right-0 flex items-center pl-6 opacity-0 bg-linear-to-l from-(--refs-row-bg) from-60% to-transparent', SHOWN)}>
            {idle.map((t) => <ToggleButton key={t.key} t={t} overlay />)}
          </div>
        )}
      </div>
      {after}
      {toggles.filter((t) => t.on).map((t) => <ToggleButton key={t.key} t={t} overlay={false} />)}
    </>
  );
}

const eye = (hidden: boolean) => (hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />);

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
  const f = filter.trim().toLowerCase();
  const lists = useMemo(() => {
    if (!data.refs) return null;
    const keep = (r: Ref) => !f || r.short.toLowerCase().includes(f);
    // A filter shows every folder that still has a match expanded.
    const stored = new Set(prefs.collapsedFolders);
    const rowsOf = (list: Ref[]) => refTreeRows(list, { pinned: prefs.pinned, collapsed: (p) => !f && stored.has(p) });
    const all = data.refs.refs;
    const locals = all.filter((r) => r.kind === 'local' && keep(r));
    const remotes = all.filter((r) => r.kind === 'remote' && keep(r));
    const tags = all.filter((r) => r.kind === 'tag' && keep(r));
    // Every listed remote shows, one with no fetched branch too.
    const remoteNames = [...new Set([...all.filter((r) => r.kind === 'remote').map((r) => r.remote ?? ''), ...(listed.data ?? []).map((r) => r.name)])].sort();
    return {
      locals, remotes, tags,
      localRows: rowsOf(locals),
      remoteGroups: remoteNames.map((name) => { const list = remotes.filter((r) => r.remote === name); return { name, count: list.length, rows: rowsOf(list) }; }),
      tagRows: rowsOf(tags),
    };
  }, [data.refs, prefs, f, listed.data]);
  // A graph that never opened (the checkout is not a repo) has no refs to wait for.
  if (data.status === 'idle') return null;
  if (!data.refs || !vis || !lists) return <p className="p-3 text-sm text-muted-foreground">{data.status === 'error' ? 'Refs could not be loaded.' : 'Loading refs…'}</p>;
  const refs = data.refs;
  const { locals, remotes, tags, localRows, remoteGroups, tagRows } = lists;
  const match = (s: string) => !f || s.toLowerCase().includes(f);
  const set = (fn: (p: GraphPrefs) => GraphPrefs) => updatePrefs(prefsKey(tab), fn);
  const toggleCollapsed = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const menu = (e: MouseEvent, context: string, ctx: unknown) => {
    e.preventDefault();
    openContextMenu({ host: HOST, context, ctx, at: { x: e.clientX, y: e.clientY } });
  };

  const stashes = refs.stashes.filter((s) => match(s.selector) || match(s.subject));
  const own = refs.worktrees ? ownWorktree(refs.head, refs.worktrees) : null;
  const worktrees = (refs.worktrees ?? []).filter((w) => !w.bare && match(worktreeName(w, data.checkouts).name));
  /** The branch rows as rendered, top to bottom: what a Shift-click range spans. A collapsed section, remote or folder leaves its rows out. */
  const branchNames = (rows: RefTreeRow[]) => rows.flatMap((r) => (r.kind === 'ref' ? [r.ref.name] : []));
  const order = [
    ...(collapsed.has('local') ? [] : branchNames(localRows)),
    ...(collapsed.has('remote') ? [] : remoteGroups.filter((g) => !collapsed.has(`remote:${g.name}`)).flatMap((g) => branchNames(g.rows))),
  ];
  /** A row of a multi-selection opens the selection's menu; any other row its own. */
  const branchMenu = (e: MouseEvent, r: Ref) => {
    const picked = selectedRefs(tab, refs.refs);
    if (picked.length >= 2 && picked.some((x) => x.name === r.name)) return menu(e, CONTEXT.branches, { tab, refs: picked } satisfies BranchesCtx);
    menu(e, CONTEXT.branch, { tab, ref: r } satisfies RefCtx);
  };
  /** One list's row: a folder, or a ref at `base` + its depth. */
  const treeRow = (row: RefTreeRow, base: number, ref: (row: RefLeaf) => ReactNode) => {
    if (row.kind === 'ref') return ref(row);
    const hidden = prefs.hiddenFolders.includes(row.prefix);
    const soloed = prefs.soloedFolders.includes(row.prefix);
    const toggleFolder = (key: 'hiddenFolders' | 'soloedFolders' | 'collapsedFolders', on: boolean) => set((p) => ({ ...p, [key]: toggled(p[key], row.prefix, !on) }));
    return (
      <li key={row.prefix} data-folder={row.prefix} className={cn('group/row flex items-center gap-1 py-0.5 pr-2', ROW_BG, indentFor(base + row.depth), !row.refs.some((r) => vis.visible.has(r.name)) && 'opacity-50')}>
        <RowControls
          name={(
            <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" aria-expanded={row.expanded} disabled={!!f}
              onClick={() => toggleFolder('collapsedFolders', !row.expanded)}>
              {row.expanded ? <ChevronDownIcon className="size-3.5 shrink-0" /> : <ChevronRightIcon className="size-3.5 shrink-0" />}
              {row.expanded ? <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className={cn('truncate', !row.expanded && row.refs.some((r) => r.isHead) && 'font-semibold')}>{clip(row.name)}</span>
            </button>
          )}
          toggles={[
            { key: 'hide', label: `${hidden ? 'Show' : 'Hide'} folder ${clip(row.label)}`, on: hidden, onClick: () => toggleFolder('hiddenFolders', hidden), icon: eye(hidden) },
            { key: 'solo', label: `${soloed ? 'Unsolo' : 'Solo'} folder ${clip(row.label)}`, on: soloed, onClick: () => toggleFolder('soloedFolders', soloed), icon: <TargetIcon className="size-3.5" /> },
          ]}
        />
      </li>
    );
  };
  const branchRow = (row: RefTreeRow, base: number) => treeRow(row, base, (leaf) => (
    <RefRow key={leaf.ref.name} tab={tab} r={leaf.ref} vis={vis} prefs={prefs} all={refs.refs} depth={base + leaf.depth} name={leaf.name}
      selected={selection.names.includes(leaf.ref.name)} order={order} onMenu={(e) => branchMenu(e, leaf.ref)} />
  ));

  const sectionHidden = (s: Section, list: Ref[]) => prefs.hiddenSections.includes(s) || list.some((r) => prefs.hidden.includes(r.name))
    || (s === 'remote' && prefs.hiddenRemotes.length > 0) || (s !== 'stashes' && prefs.hiddenFolders.some((p) => p.startsWith(SECTION_BASE[s])));
  const showAll = (s: Section) => set((p) => ({
    ...p, hiddenSections: p.hiddenSections.filter((x) => x !== s),
    hidden: s === 'stashes' ? p.hidden : p.hidden.filter((n) => !refs.refs.some((r) => r.name === n && sectionOf(r) === s)),
    hiddenRemotes: s === 'remote' ? [] : p.hiddenRemotes,
    hiddenFolders: s === 'stashes' ? p.hiddenFolders : p.hiddenFolders.filter((x) => !x.startsWith(SECTION_BASE[s])),
  }));

  const head = (s: Section | 'worktrees', title: string, count: number, list: Ref[] = [], extra?: ReactNode) => {
    const toggles: Toggle[] = [];
    if (s !== 'worktrees') {
      const hid = prefs.hiddenSections.includes(s);
      toggles.push({ key: 'hide', label: `${hid ? 'Show' : 'Hide'} ${title}`, on: hid, icon: eye(hid),
        onClick: () => set((p) => ({ ...p, hiddenSections: toggled(p.hiddenSections, s, !hid) })) });
    }
    if (s !== 'worktrees' && s !== 'stashes') {
      const solo = prefs.soloedSections.includes(s);
      toggles.push({ key: 'solo', label: `${solo ? 'Unsolo' : 'Solo'} ${title}`, on: solo, icon: <TargetIcon className="size-3.5" />,
        onClick: () => set((p) => ({ ...p, soloedSections: toggled(p.soloedSections, s, !solo) })) });
    }
    return (
      <div className={cn('group/row flex items-center gap-1 px-2 pt-2 pb-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase', ROW_BG)}>
        <RowControls
          name={(
            <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" aria-expanded={!collapsed.has(s)} onClick={() => toggleCollapsed(s)}>
              {collapsed.has(s) ? <ChevronRightIcon className="size-3.5 shrink-0" /> : <ChevronDownIcon className="size-3.5 shrink-0" />}
              <span className="truncate">{title}</span>
              <span className="font-normal">{count}</span>
            </button>
          )}
          toggles={toggles}
          after={(
            <>
              {s !== 'worktrees' && sectionHidden(s, list) && (
                <button type="button" className="rounded px-1 font-normal normal-case hover:bg-accent hover:text-foreground" onClick={() => showAll(s)}>Show all</button>
              )}
              {extra}
            </>
          )}
        />
      </div>
    );
  };

  return (
    // In the left slot the refs scroll on their own, so the Compare panel below them stays in reach.
    <nav className={cn('flex flex-col pb-3 text-sm', !inDialog && 'max-h-[60dvh] overflow-y-auto border-b')} aria-label="Refs">
      <div className="p-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter refs" aria-label="Filter refs" className="h-8" />
      </div>

      {head('local', 'Local', locals.length, locals)}
      {!collapsed.has('local') && (
        <ul aria-label="Local branches">
          {capped('local', localRows, (row) => branchRow(row, 0))}
        </ul>
      )}

      {head('remote', 'Remotes', remotes.length, remotes, (
        <button type="button" aria-label="Add remote" title="Add remote"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => openRemoteDialog({ kind: 'add', tab })}>
          <PlusIcon className="size-3.5" />
        </button>
      ))}
      {!collapsed.has('remote') && remoteGroups.map(({ name, count, rows }) => {
        if (f && !count) return null;
        const id = `remote:${name}`;
        const hidden = prefs.hiddenRemotes.includes(name);
        const soloed = prefs.soloedRemotes.includes(name);
        return (
          <div key={name}>
            <div className={cn('group/row flex items-center gap-1 py-0.5 pr-2 pl-4', ROW_BG)} onContextMenu={(e) => menu(e, CONTEXT.remote, { tab, remote: name } satisfies RemoteCtx)}>
              <RowControls
                name={(
                  <button type="button" className={cn('flex min-w-0 flex-1 items-center gap-1 text-left', hidden && 'opacity-50')} aria-expanded={!collapsed.has(id)} onClick={() => toggleCollapsed(id)}>
                    {collapsed.has(id) ? <ChevronRightIcon className="size-3.5 shrink-0" /> : <ChevronDownIcon className="size-3.5 shrink-0" />}
                    <CloudIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{clip(name)}</span>
                  </button>
                )}
                toggles={[
                  { key: 'hide', label: `${hidden ? 'Show' : 'Hide'} remote ${clip(name)}`, on: hidden, icon: eye(hidden), onClick: () => set((p) => ({ ...p, hiddenRemotes: toggled(p.hiddenRemotes, name, !hidden) })) },
                  { key: 'solo', label: `${soloed ? 'Unsolo' : 'Solo'} remote ${clip(name)}`, on: soloed, icon: <TargetIcon className="size-3.5" />, onClick: () => set((p) => ({ ...p, soloedRemotes: toggled(p.soloedRemotes, name, !soloed) })) },
                ]}
              />
            </div>
            {!collapsed.has(id) && (
              <ul aria-label={`Branches on ${clip(name)}`}>
                {capped(id, rows, (row) => branchRow(row, 1))}
              </ul>
            )}
          </div>
        );
      })}

      {head('tags', 'Tags', tags.length, tags)}
      {!collapsed.has('tags') && (
        <ul aria-label="Tags">
          {capped('tags', tagRows, (row) => treeRow(row, 0, (leaf) => (
            <RefRow key={leaf.ref.name} tab={tab} r={leaf.ref} vis={vis} prefs={prefs} all={refs.refs} depth={leaf.depth} name={leaf.name}
              onMenu={(e) => menu(e, CONTEXT.tag, { tab, ref: leaf.ref } satisfies RefCtx)} />
          )))}
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

function RefRow({ tab, r, vis, prefs, all, depth, name, selected = false, order = [], onMenu }: {
  tab: Tab; r: Ref; vis: Visibility; prefs: GraphPrefs; all: Ref[]; depth: number; name: string; selected?: boolean; order?: string[]; onMenu: (e: MouseEvent) => void;
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
    const mods = pointerMods(e);
    if (isBranch && mods.mod) return dispatchRefSelection(tab, { type: 'toggle', name: r.name });
    if (isBranch && mods.shift) return dispatchRefSelection(tab, { type: 'range', name: r.name, order });
    dispatchRefSelection(tab, { type: 'clear' });
    jump();
  };
  const source = toDragRef(r);
  const dropActive = useDropActive(source ? r.name : '\0');
  const toggles: Toggle[] = [];
  if (isBranch) {
    toggles.push({ key: 'pin', label: pinned ? `Unpin ${clip(r.short)}` : `Pin ${clip(r.short)} to left`, on: pinned, icon: <PinIcon className="size-3.5" />,
      onClick: () => set((p) => ({ ...p, pinned: toggled(p.pinned, r.name, !pinned) })) });
  }
  // A branch hidden before it was checked out can still be shown again.
  toggles.push({ key: 'hide', label: `${hidden ? 'Show' : 'Hide'} ${clip(r.short)}`, on: hidden, disabled: r.isHead && !hidden, icon: eye(hidden),
    onClick: () => set((p) => ({ ...p, hidden: toggled(p.hidden, r.name, !hidden) })) });
  toggles.push({ key: 'solo', label: `${soloed ? 'Unsolo' : 'Solo'} ${clip(r.short)}`, on: soloed, icon: <TargetIcon className="size-3.5" />,
    onClick: () => set((p) => ({ ...p, soloed: toggled(p.soloed, r.name, !soloed) })) });
  return (
    <li
      className={cn('group/row flex items-center gap-1 py-0.5 pr-2', indentFor(depth), selected || dropActive ? ROW_BG_ACTIVE : ROW_BG, !shown && 'opacity-50', (dropActive || selected) && 'bg-accent', dropActive && 'ring-2 ring-ring ring-inset')}
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
      <RowControls
        name={(
          <button type="button" className={cn('min-w-0 flex-1 truncate text-left hover:underline', r.isHead && 'font-semibold')} title={clip(r.name)} disabled={!r.oid}
            onClick={onNameClick} onDoubleClick={() => runPrimary(isBranch ? CONTEXT.branch : CONTEXT.tag, { tab, ref: r } satisfies RefCtx)}>
            {clip(name)}
            {selected && <span className="sr-only"> (selected)</span>}
          </button>
        )}
        toggles={toggles}
        after={r.kind === 'local' ? <TrackingBadge tab={tab} ref={r.name} /> : undefined}
      />
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
