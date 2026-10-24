import { Button } from '@/components/ui/button';
import { setPrefs, type DiffLayout, type DiffPrefs, type DiffScope } from '@/state/diff';

const SCOPES: { value: DiffScope; label: string }[] = [{ value: 'hunk', label: 'Hunk' }, { value: 'full', label: 'Full' }];
const LAYOUTS: { value: DiffLayout; label: string }[] = [{ value: 'inline', label: 'Inline' }, { value: 'split', label: 'Split' }];

/** A segmented control: one pressed button per group. */
export function Seg<V extends string>({ label, value, options, onPick, disabled }: { label: string; value: V; options: { value: V; label: string }[]; onPick: (v: V) => void; disabled?: boolean }) {
  return (
    <div className="flex rounded-md border p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <Button key={o.value} variant={value === o.value ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={value === o.value} disabled={disabled} onClick={() => onPick(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/** The shared diff prefs every diff viewer offers: scope, layout (both `disabled` in File view) and Ignore whitespace. */
export function DiffToggles({ prefs, disabled }: { prefs: DiffPrefs; disabled?: boolean }) {
  return (
    <>
      <Seg label="Diff scope" value={prefs.scope} options={SCOPES} onPick={(scope) => setPrefs({ scope })} disabled={disabled} />
      <Seg label="Diff layout" value={prefs.layout} options={LAYOUTS} onPick={(layout) => setPrefs({ layout })} disabled={disabled} />
      <div className="flex rounded-md border p-0.5">
        <Button
          variant={prefs.ignoreWhitespace ? 'secondary' : 'ghost'} size="sm" className="h-6 px-2 text-xs" aria-pressed={prefs.ignoreWhitespace}
          onClick={() => setPrefs({ ignoreWhitespace: !prefs.ignoreWhitespace })}
        >
          Ignore whitespace
        </Button>
      </div>
    </>
  );
}
