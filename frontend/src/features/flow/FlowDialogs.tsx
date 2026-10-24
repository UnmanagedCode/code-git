import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ccHeadBranchOf, confirmCcHeadMove } from '@/features/branches/actions';
import { fieldClass, NameList, RefDialogFrame, useRefOp } from '@/features/branches/dialogs/Frame';
import { ccHead, headOf, shortBranch } from '@/features/branches/refInfo';
import { runRefOp, type RefOpLabels } from '@/features/branches/run';
import type { ApiError } from '@/lib/api';
import { closeFlowDialog, type FlowDialog } from '@/state/flowDialog';
import type { Tab } from '@/state/tabs';
import { flowFinish, flowInit, flowStart, FLOW_TYPES, type FinishResult, type FlowPrefixes, type FlowType } from './api';
import { refreshFlow, useFlow } from './state';

// The git-flow dialogs (docs/gitflow.md): initialize (or edit the settings), start a branch, finish one. Each runs one op
// through the branch dialogs' frame; a code-conductor/* HEAD is confirmed first, as every op that moves HEAD does.

type Of<K extends FlowDialog['kind']> = Extract<FlowDialog, { kind: K }>;

const TYPE_LABEL: Record<FlowType, string> = { feature: 'Feature', release: 'Release', hotfix: 'Hotfix' };
const PREFIX_FIELDS: { key: keyof FlowPrefixes; label: string }[] = [
  { key: 'feature', label: 'Feature branch prefix' },
  { key: 'release', label: 'Release branch prefix' },
  { key: 'hotfix', label: 'Hotfix branch prefix' },
  { key: 'versionTag', label: 'Version tag prefix (optional)' },
];
const textareaClass = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring dark:bg-input/30';

/**
 * Runs a git-flow op that moves HEAD from the dialog. A code-conductor/* HEAD (or a refusal saying the refs were stale)
 * closes the dialog for the shared confirmation, then runs with the acknowledgement and its own toasts.
 */
function useHeadMovingOp<T>(tab: Tab, label: string, labels: RefOpLabels<T>, op: (ccOwned?: true) => Promise<T>) {
  const { busy, error, run } = useRefOp();
  const confirmed = (branch: string) => {
    closeFlowDialog();
    void confirmCcHeadMove(branch, 'checkout', label, (ack) => runRefOp(tab, labels, () => op(ack)).finally(() => refreshFlow(tab)));
  };
  const submit = () => {
    if (ccHead(tab)) { confirmed(shortBranch(headOf(tab).branch!)); return; }
    void run(tab, labels, () => op().finally(() => refreshFlow(tab)), () => closeFlowDialog());
  };
  const cc = error ? ccHeadBranchOf(error) : null;
  // The UI's refs were stale: ask now, as the branch ops' toasts offer to.
  useEffect(() => { if (cc !== null) confirmed(cc); }, [error]);
  return { busy, error: cc !== null ? null : error, submit };
}

export function InitFlowDialog({ d }: { d: Of<'init'> }) {
  const config = useFlow(d.tab);
  const defaults = config?.defaults;
  const [main, setMain] = useState(config?.main ?? defaults?.main ?? '');
  const [develop, setDevelop] = useState(config?.develop ?? defaults?.develop ?? 'develop');
  const [prefixes, setPrefixes] = useState<FlowPrefixes>(() => ({
    feature: config?.prefixes.feature ?? defaults?.prefixes.feature ?? 'feature/',
    release: config?.prefixes.release ?? defaults?.prefixes.release ?? 'release/',
    hotfix: config?.prefixes.hotfix ?? defaults?.prefixes.hotfix ?? 'hotfix/',
    versionTag: config?.prefixes.versionTag ?? defaults?.prefixes.versionTag ?? '',
  }));
  const { busy, error, run } = useRefOp();
  const editing = !!config?.initialized;
  const ready = main.trim() !== '' && develop.trim() !== '' && prefixes.feature !== '' && prefixes.release !== '' && prefixes.hotfix !== '';
  return (
    <RefDialogFrame
      title={editing ? 'Git-flow settings' : 'Initialize git-flow'} submit={editing ? 'Save' : 'Initialize'} busyLabel="Saving…" busy={busy} error={error}
      canSubmit={ready} onClose={closeFlowDialog}
      description="Stored as gitflow.* in this repository's config, as the git-flow extension stores them. A develop branch that does not exist is created at main."
      onSubmit={() => void run(d.tab, {
        running: 'Initializing git-flow…', done: (r) => (r.createdDevelop ? `Git-flow initialized; created ${develop.trim()}` : 'Git-flow settings saved'),
      }, () => flowInit(d.tab, { main: main.trim(), develop: develop.trim(), prefixes }).finally(() => refreshFlow(d.tab)), () => closeFlowDialog())}
    >
      <label className={fieldClass}>
        Production branch
        <Input autoFocus value={main} onChange={(e) => setMain(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      <label className={fieldClass}>
        Development branch
        <Input value={develop} onChange={(e) => setDevelop(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      {PREFIX_FIELDS.map((f) => (
        <label key={f.key} className={fieldClass}>
          {f.label}
          <Input value={prefixes[f.key]} onChange={(e) => setPrefixes((p) => ({ ...p, [f.key]: e.target.value }))} spellCheck={false} autoComplete="off" />
        </label>
      ))}
    </RefDialogFrame>
  );
}

export function StartFlowDialog({ d }: { d: Of<'start'> }) {
  const config = useFlow(d.tab);
  const [type, setType] = useState<FlowType>(d.type);
  const [name, setName] = useState('');
  const n = name.trim();
  const prefix = config?.prefixes[type] ?? '';
  const branch = `${prefix}${n}`;
  const base = type === 'hotfix' ? config?.main : config?.develop;
  const { busy, error, submit } = useHeadMovingOp(d.tab, `Switching to ${branch}`, {
    running: `Starting ${branch}…`, done: (r: { branch: string }) => `Started ${r.branch}`,
  }, (ccOwned) => flowStart(d.tab, type, n, ccOwned));
  return (
    <RefDialogFrame
      title={`Start ${type}`} submit="Start" busyLabel="Starting…" busy={busy} error={error} canSubmit={n !== ''} onClose={closeFlowDialog}
      description={base ? `A new branch from ${base}, checked out.` : undefined} onSubmit={submit}
    >
      <label className={fieldClass}>
        Type
        <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={type} onChange={(e) => setType(e.target.value as FlowType)}>
          {FLOW_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </label>
      <label className={fieldClass}>
        {n ? `Name (branch ${branch})` : 'Name'}
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
    </RefDialogFrame>
  );
}

const finishDone = (r: FinishResult): string => {
  const kept = r.deleted ? '' : `; ${r.branch} was not deleted`;
  return `Finished ${r.branch}${r.tag ? `, tagged ${r.tag.name}` : ''}${kept}`;
};

/** The files a FLOW_CONFLICT refusal names. */
const conflictFiles = (e: ApiError | null): string[] => {
  if (e?.code !== 'FLOW_CONFLICT') return [];
  const files = (e.body as { files?: unknown } | undefined)?.files;
  return Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : [];
};

export function FinishFlowDialog({ d }: { d: Of<'finish'> }) {
  const config = useFlow(d.tab);
  const tagged = d.type !== 'feature';
  const [message, setMessage] = useState(tagged ? `${TYPE_LABEL[d.type]} ${d.name}` : '');
  const main = config?.main ?? 'main';
  const develop = config?.develop ?? 'develop';
  const tag = `${config?.prefixes.versionTag ?? ''}${d.name}`;
  const into = tagged ? [main, develop] : [develop];
  const { busy, error, submit } = useHeadMovingOp(d.tab, `Finishing ${d.branch}`, {
    running: `Finishing ${d.branch}…`, done: finishDone,
  }, (ccOwned) => flowFinish(d.tab, { type: d.type, name: d.name, expect: d.expect, ...(tagged ? { tagMessage: message } : {}) }, ccOwned));
  const files = conflictFiles(error);
  return (
    <RefDialogFrame
      title={`Finish ${d.branch}?`} submit="Finish" busyLabel="Finishing…" destructive busy={busy} error={error}
      canSubmit={!tagged || message.trim() !== ''} onClose={closeFlowDialog} onSubmit={submit}
      description="Every merge is checked first: if one would conflict, nothing is changed."
    >
      <ol aria-label="Steps" className="grid list-decimal gap-1 pl-5 text-sm">
        {into.map((b) => (
          <li key={b} className="break-words">
            Merge <code>{d.branch}</code> into <code>{b}</code> (no fast-forward)
            {tagged && b === main && <>, then tag <code>{tag}</code> on <code>{main}</code></>}
          </li>
        ))}
        <li className="break-words">Delete <code>{d.branch}</code>; HEAD ends on <code>{develop}</code></li>
      </ol>
      {tagged && (
        <label className={fieldClass}>
          Tag message
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={textareaClass} />
        </label>
      )}
      {files.length > 0 && <NameList label="Conflicting files" names={files} />}
    </RefDialogFrame>
  );
}
