import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Ref } from '@/features/graph/types';
import { clip } from '@/lib/clip';
import { useTracking } from '@/state/branchTracking';
import { useGraphData } from '@/state/graph';
import { closeRefDialog, type Point, type RefDialog } from '@/state/refDialog';
import type { ApiError } from '@/lib/api';
import type { Tab } from '@/state/tabs';
import { rejectedLines, rejectedOf } from '../run';
import { createBranch, deleteBranches, deleteRemoteBranches, moveBranch, renameBranch, setUpstream } from '../api';
import { abbrev, ccHead, headOf, isCcOwned, remoteBranch, shortBranch } from '../refInfo';
import { CcWarning, fieldClass, NameList, RefDialogFrame, useRefOp } from './Frame';

type Of<K extends RefDialog['kind']> = Extract<RefDialog, { kind: K }>;

/** The ccHeadMove text, shared with the dialogs that show it inline. */
export function ccHeadText(branch: string, what: string) {
  return <>This checkout is code-conductor's worktree on <strong className="font-mono">{clip(branch)}</strong>. {what} leaves cc's worktree record, and its sync and merge, on a branch or commit the agent did not make.</>;
}

export function CreateBranchDialog({ d }: { d: Of<'createBranch'> }) {
  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(true);
  const { busy, error, run } = useRefOp();
  const cc = checkout && ccHead(d.tab);
  const from: Point | null = d.from;
  return (
    <RefDialogFrame
      title={from ? `Create branch at ${from.label}` : 'Create branch from HEAD'}
      submit="Create branch" busyLabel="Creating…" busy={busy} error={error} canSubmit={name.trim() !== ''}
      onSubmit={() => {
        const n = name.trim();
        void run(d.tab, { running: `Creating ${n}…`, done: () => (checkout ? `Created and checked out ${n}` : `Created ${n}`) },
          () => createBranch(d.tab, { name: n, from: from?.oid, checkout, ccOwned: cc || undefined }));
      }}
    >
      <label className={fieldClass}>
        Branch name
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/name" spellCheck={false} autoComplete="off" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
        Check out after creating
      </label>
      {cc && <CcWarning>{ccHeadText(shortBranch(headOf(d.tab).branch!), 'Switching to the new branch')}</CcWarning>}
    </RefDialogFrame>
  );
}

export function RenameBranchDialog({ d }: { d: Of<'renameBranch'> }) {
  const [newName, setNewName] = useState(d.name);
  const { busy, error, run } = useRefOp();
  const n = newName.trim();
  const cc = isCcOwned(d.name) || isCcOwned(n);
  return (
    <RefDialogFrame
      title={`Rename ${d.name}`} submit="Rename" busyLabel="Renaming…" busy={busy} error={error} canSubmit={n !== '' && n !== d.name}
      onSubmit={() => void run(d.tab, { running: `Renaming ${d.name}…`, done: () => `Renamed ${d.name} to ${n}` }, () => renameBranch(d.tab, d.name, n, cc || undefined))}
    >
      <label className={fieldClass}>
        New name
        <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      {cc && <CcWarning>code-conductor/* branches belong to code-conductor's worktrees; renaming one can break the worktree that records it.</CcWarning>}
    </RefDialogFrame>
  );
}

/** One request of a delete: the local branches, or one remote's. */
interface Step { id: string; title: string; remote: string | null; names: string[] }
/** A step's outcome after a run: what it deleted, and what is left with why. */
interface Outcome { deleted: string[]; failed: string[]; reasons: string[] }

/** The requests a delete makes: locals first, then one per remote (branch names on that remote). */
function stepsOf(refs: Ref[]): Step[] {
  const steps: Step[] = [];
  const locals = refs.filter((r) => r.kind === 'local').map((r) => r.short);
  if (locals.length) steps.push({ id: 'local', title: 'Local', remote: null, names: locals });
  const remotes = new Map<string, string[]>();
  for (const r of refs) if (r.kind === 'remote' && r.remote) remotes.set(r.remote, [...(remotes.get(r.remote) ?? []), remoteBranch(r)]);
  for (const [remote, names] of remotes) steps.push({ id: `remote:${remote}`, title: `On ${remote}`, remote, names });
  return steps;
}

/** Runs one step on `names`; a refusal is its outcome, not a throw. Local branches git keeps as unmerged go to `notMerged`. */
async function runStep(tab: Tab, step: Step, names: string[], ack: true | undefined): Promise<Outcome & { notMerged: string[] }> {
  try {
    if (step.remote === null) {
      const r = await deleteBranches(tab, names, false, ack);
      return { deleted: r.deleted, failed: [], reasons: [], notMerged: r.notMerged };
    }
    const r = await deleteRemoteBranches(tab, step.remote, names, ack);
    const failed = r.rejected.map((x) => shortBranch(x.ref));
    return { deleted: r.deleted.map((b) => `${step.remote}/${b}`), failed, reasons: rejectedLines(r.rejected), notMerged: [] };
  } catch (e) {
    const err = e as ApiError;
    const rejected = rejectedOf(err);
    return { deleted: [], failed: names, reasons: rejected.length ? rejectedLines(rejected) : [err.message], notMerged: [] };
  }
}

export function DeleteBranchesDialog({ d }: { d: Of<'deleteBranches'> }) {
  const steps = stepsOf(d.refs);
  /** Per step, the names still to delete: a retry re-runs only those. */
  const [left, setLeft] = useState<Record<string, string[]>>(() => Object.fromEntries(steps.map((s) => [s.id, s.names])));
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [notMerged, setNotMerged] = useState<string[]>([]);
  const [forcing, setForcing] = useState(false);
  const { busy, error, run } = useRefOp();
  const all = steps.flatMap((s) => s.names);
  const ccNames = all.filter(isCcOwned);
  const ack = ccNames.length > 0 || undefined;
  const failedSteps = steps.filter((s) => (outcomes[s.id]?.failed.length ?? 0) > 0);
  const retrying = failedSteps.length > 0;
  if (forcing) {
    return (
      <RefDialogFrame
        title="Delete unmerged branches?" submit="Delete anyway" busyLabel="Deleting…" destructive busy={busy} error={error}
        description="These branches are not fully merged: their commits may be reachable from nothing else."
        onSubmit={() => void run(d.tab, { running: 'Deleting…', done: (r) => `Deleted ${r.deleted.join(', ')}` }, () => deleteBranches(d.tab, notMerged, true, ack))}
      >
        <NameList label="Not fully merged" names={notMerged} />
      </RefDialogFrame>
    );
  }
  const count = all.length;
  const label = count === 1 ? all[0] : `${count} branches`;
  return (
    <RefDialogFrame
      title={`Delete ${label}?`} busyLabel="Deleting…" destructive busy={busy} error={error}
      submit={retrying ? 'Retry' : count === 1 ? 'Delete branch' : `Delete ${count} branches`}
      onSubmit={() => void run(d.tab, {
        running: 'Deleting…',
        done: (r) => (r.deleted.length ? `Deleted ${r.deleted.join(', ')}` : null),
      }, async () => {
        const result: Record<string, Outcome> = {};
        const unmerged: string[] = [];
        for (const step of steps) {
          const names = left[step.id];
          if (!names.length) continue;
          const o = await runStep(d.tab, step, names, ack);
          result[step.id] = o;
          unmerged.push(...o.notMerged);
        }
        return { outcomes: result, notMerged: unmerged, deleted: Object.values(result).flatMap((o) => o.deleted) };
      }, (r) => {
        const nextLeft = Object.fromEntries(steps.map((s) => [s.id, r.outcomes[s.id] ? r.outcomes[s.id].failed : left[s.id]]));
        const nextNotMerged = [...notMerged, ...r.notMerged];
        setLeft(nextLeft);
        setOutcomes((o) => ({ ...o, ...r.outcomes }));
        setNotMerged(nextNotMerged);
        if (Object.values(nextLeft).some((n) => n.length)) return;
        if (nextNotMerged.length) setForcing(true);
        else closeRefDialog();
      })}
    >
      {steps.map((s) => {
        const o = outcomes[s.id];
        return (
          <section key={s.id} className="grid gap-1">
            <h3 className="text-sm font-medium">{clip(s.title)}</h3>
            <NameList label={s.remote === null ? 'Local branches to delete' : `Branches to delete on ${clip(s.remote)}`} names={s.names} />
            {o && (
              <div className="grid gap-0.5 text-sm" data-outcome={s.id}>
                {o.deleted.length > 0 && <p className="break-words text-muted-foreground">Deleted: {o.deleted.map((n) => clip(n)).join(', ')}</p>}
                {o.failed.length > 0 && (
                  <div role="alert" className="grid gap-0.5 text-destructive">
                    <p className="break-words">Not deleted: {o.failed.map((n) => clip(n)).join(', ')}</p>
                    <NameList label={`Why, ${clip(s.title)}`} names={o.reasons} />
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
      {ccNames.length > 0 && <CcWarning>{ccNames.map((n) => clip(n)).join(', ')} {ccNames.length > 1 ? 'belong' : 'belongs'} to code-conductor: its worktree records name {ccNames.length > 1 ? 'them' : 'it'}.</CcWarning>}
    </RefDialogFrame>
  );
}

export function SetUpstreamDialog({ d }: { d: Of<'setUpstream'> }) {
  const refs = useGraphData(d.tab).refs;
  const tracking = useTracking(d.tab).data?.branches[`refs/heads/${d.branch}`];
  const remotes = (refs?.refs ?? []).filter((r) => r.kind === 'remote');
  const [upstream, setUp] = useState(tracking?.upstream ?? remotes.find((r) => remoteBranch(r) === d.branch)?.name ?? remotes[0]?.name ?? '');
  const { busy, error, run } = useRefOp();
  const save = (u: string | null) => run(d.tab, {
    running: 'Setting upstream…', done: (r) => (r.upstream ? `${d.branch} now tracks ${r.upstream.replace(/^refs\/remotes\//, '')}` : `${d.branch} tracks nothing`),
  }, () => setUpstream(d.tab, d.branch, u));
  return (
    <RefDialogFrame
      title={`Set the upstream of ${d.branch}`} submit="Set upstream" busyLabel="Saving…" busy={busy} error={error} canSubmit={upstream !== ''}
      onSubmit={() => void save(upstream)}
      extraButton={tracking?.upstream ? <Button type="button" variant="outline" disabled={busy} onClick={() => void save(null)}>Unset</Button> : undefined}
    >
      <label className={fieldClass}>
        Remote branch
        <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={upstream} onChange={(e) => setUp(e.target.value)}>
          {remotes.length === 0 && <option value="">No remote branches</option>}
          {remotes.map((r) => <option key={r.name} value={r.name}>{clip(r.short)}</option>)}
        </select>
      </label>
    </RefDialogFrame>
  );
}

export function MoveBranchDialog({ d }: { d: Of<'moveBranch'> }) {
  const { busy, error, run } = useRefOp();
  const cc = isCcOwned(d.name);
  return (
    <RefDialogFrame
      title={`Reset ${d.name} to ${d.to.label}?`} submit="Move branch" busyLabel="Moving…" destructive busy={busy} error={error}
      description={<><span className="font-mono">{clip(d.name)}</span> moves from <span className="font-mono">{abbrev(d.from)}</span> to <span className="font-mono">{abbrev(d.to.oid)}</span>; commits only on {clip(d.name)} are no longer reachable from it.</>}
      onSubmit={() => void run(d.tab, { running: `Moving ${d.name}…`, done: () => `Moved ${d.name} to ${d.to.label}` }, () => moveBranch(d.tab, d.name, d.to.oid, d.from, cc || undefined))}
    >
      {cc && <CcWarning>{clip(d.name)} belongs to code-conductor: its worktree record names it.</CcWarning>}
    </RefDialogFrame>
  );
}
