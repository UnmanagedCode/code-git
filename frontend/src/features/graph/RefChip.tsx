import { CheckIcon, CloudIcon, GitBranchIcon, ArchiveIcon, FolderGit2Icon, TagIcon } from 'lucide-react';
import type { MouseEvent, PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import type { Label } from './labels';
import { useDropActive } from './drag';

const ICON = { head: CheckIcon, local: GitBranchIcon, remote: CloudIcon, tag: TagIcon, stash: ArchiveIcon, worktree: FolderGit2Icon } as const;

export interface ChipHandlers {
  onHover?: (l: Label | null) => void;
  onContextMenu?: (e: MouseEvent, l: Label) => void;
  onPointerDown?: (e: PointerEvent, l: Label) => void;
  onClick?: (l: Label) => void;
}

/** The ref name a chip stands for, as drag/drop data: branches only. */
export const dropRefOf = (l: Label): string | undefined => ((l.kind === 'local' || l.kind === 'remote' || l.kind === 'head') && l.ref ? l.ref.name : undefined);

/** One ref label in its lane's colour. A branch chip is a drag source and a drop target. */
export function RefChip({ label, color, handlers }: { label: Label; color: number; handlers?: ChipHandlers }) {
  const Icon = ICON[label.kind];
  const drop = dropRefOf(label);
  const active = useDropActive(drop ?? '\0');
  const remotes = label.kind === 'local' || label.kind === 'head' ? label.remotes : [];
  const title = remotes.length ? `${label.text} (also ${remotes.map((r) => r.short).join(', ')})` : label.text;
  return (
    <span
      className={cn(
        `lane-${color} inline-flex h-5 max-w-full min-w-0 shrink items-center gap-1 rounded border border-(--lane) bg-(--lane)/15 px-1.5 text-xs`,
        label.kind === 'head' && 'font-semibold',
        label.kind === 'worktree' && 'border-dashed',
        active && 'ring-2 ring-ring',
      )}
      title={title}
      data-label-kind={label.kind}
      data-drop-ref={drop}
      data-drop-active={active ? '' : undefined}
      onMouseEnter={() => handlers?.onHover?.(label)}
      onMouseLeave={() => handlers?.onHover?.(null)}
      onContextMenu={(e) => handlers?.onContextMenu?.(e, label)}
      onPointerDown={(e) => handlers?.onPointerDown?.(e, label)}
      onClick={(e) => { if (handlers?.onClick) { e.stopPropagation(); handlers.onClick(label); } }}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{label.text}</span>
      {remotes.length > 0 && <CloudIcon className="size-3 shrink-0" aria-label="also on a remote" />}
    </span>
  );
}
