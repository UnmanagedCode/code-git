import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { prefsStore, whitespaceFor } from '@/state/diff';
import { tabKey, type Tab } from '@/state/tabs';
import { useRepoSummary } from '@/state/useRepoSummary';
import { listDiffFiles, type DiffSource } from './api';
import { openDiff } from './openDiff';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-1.5 border-b px-3 py-2" aria-label={title}>
    <h3 className="text-xs font-semibold text-muted-foreground uppercase">{title}</h3>
    {children}
  </section>
);

/**
 * Picks what to diff by name, beside the commit graph's own entry points: work in progress, one commit, or two refs.
 * Typed refs are checked by listing the diff first; a refusal stays here as text and the diff is not opened.
 */
function Compare({ tab }: { tab: Tab }) {
  const { summary } = useRepoSummary(tab);
  const [rev, setRev] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<'..' | '...'>('..');
  const [error, setError] = useState<{ where: 'commit' | 'refs'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (where: 'commit' | 'refs', source: DiffSource) => {
    setBusy(true);
    setError(null);
    try {
      const preloaded = await listDiffFiles(tab, source, whitespaceFor(prefsStore.get()));
      openDiff(tab, source, { preloaded });
    } catch (e) {
      setError({ where, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const submit = (f: () => void) => (e: FormEvent) => { e.preventDefault(); f(); };
  const c = summary?.counts;
  const alert = (where: 'commit' | 'refs') => error?.where === where && <p role="alert" className="text-xs break-words text-destructive">{error.message}</p>;

  return (
    <div className="text-sm">
      <Section title="Working directory">
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => openDiff(tab, { kind: 'unstaged' })}>
          Unstaged changes{c ? ` (${c.unstaged + c.untracked})` : ''}
        </Button>
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => openDiff(tab, { kind: 'staged' })}>
          Staged changes{c ? ` (${c.staged})` : ''}
        </Button>
      </Section>
      <Section title="Commit">
        <form className="flex flex-col gap-1.5" onSubmit={submit(() => rev.trim() && void open('commit', { kind: 'commit', rev: rev.trim() }))}>
          <Input aria-label="Commit (sha or ref)" placeholder="Commit (sha or ref)" className="h-8 font-mono" value={rev} onChange={(e) => setRev(e.target.value)} />
          <div className="flex flex-wrap gap-1">
            <Button type="submit" size="sm" disabled={busy || !rev.trim()}>Show commit</Button>
            <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 w-full py-1 whitespace-normal" disabled={busy || !rev.trim()} onClick={() => void open('commit', { kind: 'worktree', rev: rev.trim() })}>
              Compare with working directory
            </Button>
          </div>
          {alert('commit')}
        </form>
      </Section>
      <Section title="Two refs">
        <form className="flex flex-col gap-1.5" onSubmit={submit(() => from.trim() && to.trim() && void open('refs', { kind: 'compare', from: from.trim(), to: to.trim(), mode }))}>
          <Input aria-label="From" placeholder="From" className="h-8 font-mono" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input aria-label="To" placeholder="To" className="h-8 font-mono" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="flex items-center gap-1">
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Range">
              {(['..', '...'] as const).map((m) => (
                <Button key={m} type="button" variant={mode === m ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 font-mono text-xs" aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</Button>
              ))}
            </div>
            <Button type="submit" size="sm" className="ml-auto" disabled={busy || !from.trim() || !to.trim()}>Compare</Button>
          </div>
          {alert('refs')}
        </form>
      </Section>
    </div>
  );
}

export function ComparePanel({ tab }: { tab: Tab | null }) {
  return tab ? <Compare key={tabKey(tab)} tab={tab} /> : null;
}
