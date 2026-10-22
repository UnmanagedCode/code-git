import { Badge } from '@/components/ui/badge';
import { clip } from '@/lib/clip';

type Variant = 'success' | 'warning' | 'destructive' | 'secondary';
/** git's %G? letters (git-log PRETTY FORMATS) as GitKraken words them; N (unsigned) has no badge. */
export const SIGNATURE: Record<string, { label: string; variant: Variant; hover: string }> = {
  G: { label: 'Signed', variant: 'success', hover: 'Good signature' },
  U: { label: 'Signed', variant: 'warning', hover: 'Good signature with unknown validity' },
  X: { label: 'Expired signature', variant: 'warning', hover: 'Good signature that has expired' },
  Y: { label: 'Expired key', variant: 'warning', hover: 'Good signature made by an expired key' },
  R: { label: 'Revoked key', variant: 'destructive', hover: 'Good signature made by a revoked key' },
  B: { label: 'Bad signature', variant: 'destructive', hover: 'Bad signature' },
  E: { label: 'Unverified', variant: 'secondary', hover: 'The signature cannot be checked (e.g. a missing key)' },
};

export function SignatureBadge({ status, signer, keyId }: { status: string; signer: string | null; keyId: string | null }) {
  const s = SIGNATURE[status];
  if (!s) return null;
  const who = clip([signer, keyId && `key ${keyId}`].filter(Boolean).join(', '));
  return <Badge variant={s.variant} title={who ? `${s.hover}: ${who}` : s.hover} data-signature={status}>{s.label}</Badge>;
}
