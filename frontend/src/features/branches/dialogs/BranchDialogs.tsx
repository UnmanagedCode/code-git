import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Ref } from '@/features/graph/types';
import { clip } from '@/lib/clip';
import { useTracking } from '@/state/branchTracking';
import { useGraphData } from '@/state/graph';
import { closeRefDialog, type Point, type RefDialog } from '@/state/refDialog';
import { createBranch, deleteBranches, deleteRemoteBranches, moveBranch, renameBranch, setUpstream } from '../api';
import { abbrev, ccHead, headOf, isCcOwned, remoteBranch, shortBranch } from '../refInfo';
import { CcWarning, fieldClass, RefDialogFrame, useRefOp } from './Frame';

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

/** Locals and remotes of a delete, remotes grouped by remote. */
function groups(refs: Ref[]) {
  const locals = refs.filter((r) => r.kind === 'local').map((r) => r.short);
  const remotes = new Map<string, string[]>();
  for (const r of refs) if (r.kind === 'remote' && r.remote) remotes.set(r.remote, [...(remotes.get(r.remote) ?? []), remoteBranch(r)]);
  return { locals, remotes };
}

export function DeleteBranchesDialog({ d }: { d: Of<'deleteBranches'> }) {
  const { locals, remotes } = groups(d.refs);
  const [notMerged, setNotMerged] = useState<string[] | null>(null);
  const { busy, error, run } = useRefOp();
  const count = locals.length + [...remotes.values()].reduce((n, l) => n + l.length, 0);
  const ccNames = [...locals, ...[...remotes.values()].flat()].filter(isCcOwned);
  const ack = ccNames.length > 0 || undefined;
  const label = count === 1 ? (locals[0] ?? [...remotes.values()][0][0]) : `${count} branches`;
  if (notMerged) {
    return (
      <RefDialogFrame
        title="Delete unmerged branches?" submit="Delete anyway" busyLabel="Deleting…" destructive busy={busy} error={error}
        description="These branches are not fully merged: their commits may be reachable from nothing else."
        onSubmit={() => void run(d.tab, { running: 'Deleting…', done: (r) => `Deleted ${r.deleted.join(', ')}` }, () => deleteBranches(d.tab, notMerged, true, ack))}
      >
        <ul aria-label="Not fully merged" className="grid gap-0.5 font-mono text-sm">{notMerged.map((n) => <li key={n} className="break-all">{clip(n)}</li>)}</ul>
      </RefDialogFrame>
    );
  }
  return (
    <RefDialogFrame
      title={`Delete ${label}?`} submit={count === 1 ? 'Delete branch' : `Delete ${count} branches`} busyLabel="Deleting…" destructive busy={busy} error={error}
      onSubmit={() => void run(d.tab, {
        running: 'Deleting…',
        done: (r) => (r.deleted.length ? `Deleted ${r.deleted.join(', ')}` : null),
      }, async () => {
        const deleted: string[] = [];
        let unmerged: string[] = [];
        if (locals.length) {
          const r = await deleteBranches(d.tab, locals, false, ack);
          deleted.push(...r.deleted);
          unmerged = r.notMerged;
        }
        for (const [remote, branches] of remotes) {
          const r = await deleteRemoteBranches(d.tab, remote, branches, ack);
          deleted.push(...r.deleted.map((b) => `${remote}/${b}`));
        }
        return { deleted, notMerged: unmerged };
      }, (r) => { if (r.notMerged.length) setNotMerged(r.notMerged); else closeRefDialog(); })}
    >
      {locals.length > 0 && (
        <section className="grid gap-1">
          <h3 className="text-sm font-medium">Local</h3>
          <ul aria-label="Local branches to delete" className="grid gap-0.5 font-mono text-sm">{locals.map((n) => <li key={n} className="break-all">{clip(n)}</li>)}</ul>
        </section>
      )}
      {[...remotes].map(([remote, branches]) => (
        <section key={remote} className="grid gap-1">
          <h3 className="text-sm font-medium">On {clip(remote)}</h3>
          <ul aria-label={`Branches to delete on ${clip(remote)}`} className="grid gap-0.5 font-mono text-sm">{branches.map((n) => <li key={n} className="break-all">{clip(n)}</li>)}</ul>
        </section>
      ))}
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
