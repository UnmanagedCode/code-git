import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { setCssPx } from '@/lib/cssVars';
import { clampHeader, DETAILS_HEADER, useDetailsHeader } from '@/state/detailsHeader';
import { FileViewToggle } from '@/features/diff/FileList';
import { HEADER_VAR, HeaderSplitter } from './HeaderSplitter';

/**
 * The details' layout around one file list: a header at the user's height (its own scroller, resizable below it), then
 * `notes`, the "N files" row with the Path / Tree toggle (none while `count` is undefined), and the list filling the rest.
 */
export function DetailsFrame({ label, header, inDialog, available, notes, count, children }: {
  label: string; header: ReactNode; inDialog: boolean; available: number; notes?: ReactNode; count: number | undefined; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const chosen = useDetailsHeader();
  // The narrow dialog is one scroller with no rest of the panel to give the files: the header keeps the default there.
  const height = inDialog ? DETAILS_HEADER.default : clampHeader(chosen, available);
  useLayoutEffect(() => { if (ref.current) setCssPx(ref.current, HEADER_VAR, height); }, [height]);
  return (
    <>
      {/* The user's height, never the content's, scrolling on its own: a long message never pushes the files out of the panel. */}
      <section ref={ref} aria-label={label} className="flex h-(--details-header) shrink-0 flex-col gap-3 overflow-y-auto border-b p-3">
        {header}
      </section>
      {!inDialog && <HeaderSplitter header={ref} height={height} available={available} />}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-col gap-3 px-3 pt-2">
          {notes}
          {count !== undefined && (
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase">{count} {count === 1 ? 'file' : 'files'}</h3>
              <div className="ml-auto"><FileViewToggle /></div>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}

/** A bound list whose diff failed to list: the diff shows the error. */
export const LIST_FAILED = 'The changed files could not be listed; the diff says why.';

/** The changed files could not be listed: too many, or the reason. */
export function FilesError({ code, message }: { code?: string | null; message?: string }) {
  return (
    <p className="px-3 py-2 text-sm text-destructive" role="alert">
      {code === 'OUTPUT_TOO_LARGE' ? 'Too many changes to list.' : `The changed files could not be listed: ${message ?? 'unknown error'}`}
    </p>
  );
}
