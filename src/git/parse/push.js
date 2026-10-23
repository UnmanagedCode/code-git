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

// Patterns of git's (and ssh's, curl's) stderr, LC_ALL=C, checked in this order: the first matching rule wins. A helper's
// rejected credentials also print git's "could not read Username" line, and a 403 is also "unable to access", so the
// credential rules come before the prompt and unreachable ones.
const RULES = [
  { code: 'REMOTE_AUTH_FAILED', reason: 'credentials', patterns: ['Authentication failed', 'HTTP Basic: Access denied', 'The requested URL returned error: 401', 'The requested URL returned error: 403'] },
  { code: 'REMOTE_AUTH_FAILED', reason: 'prompt', patterns: ['terminal prompts disabled', 'could not read Username', 'could not read Password'] },
  { code: 'REMOTE_AUTH_FAILED', reason: 'ssh-key', patterns: ['Permission denied (publickey'] },
  { code: 'REMOTE_AUTH_FAILED', reason: 'ssh-host-key', patterns: ['Host key verification failed'] },
  { code: 'REMOTE_UNREACHABLE', reason: 'dns', patterns: ['Could not resolve host'] },
  { code: 'REMOTE_UNREACHABLE', reason: 'refused', patterns: ['Connection refused', 'Failed to connect to'] },
  { code: 'REMOTE_UNREACHABLE', reason: 'timeout', patterns: ['Connection timed out', 'Operation timed out'] },
  { code: 'REMOTE_UNREACHABLE', reason: 'not-found', patterns: ['does not appear to be a git repository', "' not found"] },
  { code: 'REMOTE_UNREACHABLE', reason: 'unavailable', patterns: ['unable to access'] },
];

/**
 * git's stderr of a remote command that failed as a whole → {code: 'REMOTE_AUTH_FAILED' | 'REMOTE_UNREACHABLE', reason}
 * | null (anything else: a hook, a git error). Auth reasons: `credentials` (the remote refused what the helper gave, or
 * a 401/403), `prompt` (git needed to ask), `ssh-key`, `ssh-host-key`; unreachable: `dns`, `refused`, `timeout`,
 * `not-found`, `unavailable`.
 */
export function classifyRemoteFailure(stderr) {
  const rule = RULES.find((r) => r.patterns.some((p) => stderr.includes(p)));
  return rule ? { code: rule.code, reason: rule.reason } : null;
}
