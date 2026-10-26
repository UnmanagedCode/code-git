import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clip } from '@/lib/clip';
import type { RepoSummary } from '@/lib/endpoints';
import { pushHead } from '@/features/remotes/pushFlow';
import { updateRemotePrefs, useRemotePrefs } from '@/state/remotePrefs';
import { useRemotes } from '@/state/remotes';
import type { Tab } from '@/state/tabs';
import {
  commitDraft, consumeFocus, sameDraft, setAmend, setDraft, setNoVerify, type CommitMode, type WorkdirState,
} from '@/state/workdir';
import { matches } from '@/shell/shortcuts';
import { COMMIT_KEY, COMMIT_STAGE_ALL_KEY } from './keys';

/** Which commit buttons are enabled, from the draft and the lists: the one rule the box and its keys share. */
export function commitRules(s: WorkdirState) {
  const stagedCount = s.staged?.files.length ?? 0;
  const hasSummary = !!s.draft.summary.trim();
  const loadingHead = s.amend.on && !s.amend.head;
  return {
    stagedCount,
    // git's own "you did not edit the message" rule, for a template draft.
    commit: !s.busy && hasSummary && !sameDraft(s.draft, s.templateDraft) && (stagedCount > 0 || s.merging),
    amend: !s.busy && hasSummary && !loadingHead,
    message: !s.busy && hasSummary && !loadingHead && !sameDraft(s.draft, s.amend.head),
  };
}

/**
 * Summary (one line) + description, Amend previous commit, Skip Git hooks, Push after commit (HEAD on a branch and a
 * remote to push to), and the commit buttons. Ctrl/⌘+Enter commits
 * (amends in amend mode); Ctrl/⌘+Shift+Enter stages everything first. `instance` tells the slot's box from the narrow
 * dialog's, for focus requests.
 */
export function CommitBox({ tab, state, summary, instance }: { tab: Tab; state: WorkdirState; summary: RepoSummary | null; instance: 'slot' | 'dialog' }) {
  const summaryRef = useRef<HTMLInputElement>(null);
  const rules = commitRules(state);
  const detached = !!summary && summary.head.branch === null && !summary.head.unborn;
  useEffect(() => {
    if (state.focus !== instance) return;
    summaryRef.current?.focus();
    consumeFocus(tab);
  }, [state.focus]);

  const pushAfter = useRemotePrefs(tab.project).pushAfterCommit;
  // Every hook unconditionally, before any condition: the summary's HEAD flips (a rebase reports it detached).
  const remoteCount = useRemotes(tab).data?.length ?? 0;
  const canPushAfter = !!summary?.head.branch && remoteCount > 0;
  const run = (mode: CommitMode, stageAll = false) => void commitDraft(tab, mode, { stageAll }).then((ok) => {
    // The push goes through the shared flow: its cc warning and rejected-push handling.
    if (ok && pushAfter && canPushAfter) pushHead(tab);
  });
  const onKeyDown = (e: KeyboardEvent) => {
    const stageAll = matches(e, COMMIT_STAGE_ALL_KEY);
    if (!stageAll && !matches(e, COMMIT_KEY)) return;
    e.preventDefault();
    if (state.amend.on) { if (rules.amend) run('amend', stageAll); return; }
    // Stage-all-then-commit only needs something to stage; the summary rules still apply.
    const stageAllOk = stageAll && !state.busy && !!state.draft.summary.trim() && !sameDraft(state.draft, state.templateDraft)
      && ((state.unstaged?.files.length ?? 0) > 0 || rules.stagedCount > 0 || state.merging);
    if (stageAll ? stageAllOk : rules.commit) run('commit', stageAll);
  };

  return (
    // min-h-25 is the floor: the button row (52px) plus the fields' 12px padding and the 32px Summary, so both always show.
    <section aria-label="Commit message" className="flex min-h-25 shrink flex-col" onKeyDown={onKeyDown}>
      <div data-commit-fields="" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 pb-0">
        <Input
          ref={summaryRef}
          aria-label="Summary"
          placeholder="Summary"
          className="h-8 shrink-0"
          value={state.draft.summary}
          onChange={(e) => setDraft(tab, { summary: e.target.value.replace(/[\r\n]/g, ' ') })}
        />
        <textarea
          aria-label="Description"
          placeholder="Description"
          className="min-h-20 w-full shrink-0 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/30"
          value={state.draft.description}
          onChange={(e) => setDraft(tab, { description: e.target.value })}
        />
        <label className="flex shrink-0 items-center gap-2 text-xs">
          <input type="checkbox" checked={state.amend.on} disabled={state.busy} onChange={(e) => void setAmend(tab, e.target.checked)} />
          Amend previous commit
        </label>
        <label className="flex shrink-0 items-center gap-2 text-xs">
          <input type="checkbox" checked={state.noVerify} onChange={(e) => setNoVerify(tab, e.target.checked)} />
          Skip Git hooks
        </label>
        {canPushAfter && (
          <label className="flex shrink-0 items-center gap-2 text-xs">
            <input type="checkbox" checked={pushAfter} onChange={(e) => updateRemotePrefs(tab.project, { pushAfterCommit: e.target.checked })} />
            Push after commit
          </label>
        )}
        {state.templateDraft && state.templatePath && (
          <p className="shrink-0 truncate text-xs text-muted-foreground" title={clip(state.templatePath)}>Template: <span className="font-mono">{clip(state.templatePath)}</span></p>
        )}
        {state.templateProblem && <p className="shrink-0 text-xs text-muted-foreground">{clip(state.templateProblem)}</p>}
      </div>
      <div className="shrink-0 p-3 pt-2">
        {state.amend.on ? (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" disabled={!rules.amend} onClick={() => run('amend')}>Amend commit</Button>
            <Button size="sm" variant="outline" disabled={!rules.message} onClick={() => run('message')}>Update message only</Button>
          </div>
        ) : (
          <Button size="sm" className="h-auto min-h-8 w-full py-1 whitespace-normal" disabled={!rules.commit} onClick={() => run('commit')}>
            {rules.stagedCount ? `Commit changes to ${rules.stagedCount} ${rules.stagedCount === 1 ? 'file' : 'files'}` : 'Commit'}
            {detached ? ' (detached HEAD)' : ''}
          </Button>
        )}
      </div>
    </section>
  );
}
