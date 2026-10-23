// Parsers for `git push --porcelain` and for git's remote failures. Pure; LC_ALL=C keeps git's wording stable.

const LINE_RE = /^([ +\-*!=])\t([^\t]*)\t(.*)$/;
const UPDATED = new Set([' ', '+', '-', '*']);

/**
 * `push --porcelain` stdout → {updated: [{ref, flag, summary}], rejected: [{ref, reason}], upToDate: [ref]}, `ref` being
 * the destination on the remote. Flags: ' ' fast-forward, '+' forced, '-' deleted, '*' new, '!' rejected, '=' up to date.
 */
export function parsePushPorcelain(stdout) {
  const out = { updated: [], rejected: [], upToDate: [] };
  for (const line of stdout.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, flag, spec, summary] = m;
    const ref = spec.slice(spec.indexOf(':') + 1);
    if (flag === '!') out.rejected.push({ ref, reason: /\(([^)]*)\)\s*$/.exec(summary)?.[1] ?? summary });
    else if (flag === '=') out.upToDate.push(ref);
    else if (UPDATED.has(flag)) out.updated.push({ ref, flag, summary });
  }
  return out;
}

/**
 * A parsed push split by what was asked for: `requested` are the destination refnames of the push's refspecs. Lines
 * for other refs (a tag a config made git add) go to `unrequested: [{ref, flag}]` — reported, never dropped, never in
 * the requested lists.
 */
export function splitRequested(result, requested) {
  const want = new Set(requested);
  const refOf = (x) => (typeof x === 'string' ? x : x.ref);
  const mine = (list) => list.filter((x) => want.has(refOf(x)));
  const unrequested = [
    ...result.updated.filter((u) => !want.has(u.ref)).map((u) => ({ ref: u.ref, flag: u.flag })),
    ...result.rejected.filter((r) => !want.has(r.ref)).map((r) => ({ ref: r.ref, flag: '!' })),
    ...result.upToDate.filter((r) => !want.has(r)).map((ref) => ({ ref, flag: '=' })),
  ];
  return { updated: mine(result.updated), rejected: mine(result.rejected), upToDate: mine(result.upToDate), unrequested };
}

const AUTH = [
  'could not read Username', 'could not read Password', 'terminal prompts disabled', 'Authentication failed',
  'Permission denied (publickey', 'Host key verification failed', 'HTTP Basic: Access denied',
];
const UNREACHABLE = [
  'Could not resolve host', 'Connection refused', 'Connection timed out', 'does not appear to be a git repository', 'unable to access',
];

/** git's stderr of a failed remote command → 'REMOTE_AUTH_FAILED' | 'REMOTE_UNREACHABLE' | null (anything else). */
export function classifyRemoteFailure(stderr) {
  if (AUTH.some((p) => stderr.includes(p))) return 'REMOTE_AUTH_FAILED';
  if (UNREACHABLE.some((p) => stderr.includes(p))) return 'REMOTE_UNREACHABLE';
  return null;
}
