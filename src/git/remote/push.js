import { Refusal } from '../../refusals.js';
import { parseRemotes } from '../parse/graph.js';
import { classifyRemoteFailure, parsePushPorcelain, splitRequested } from '../parse/push.js';
import { NETWORK_LIMITS } from './limits.js';

// The commands that talk to a remote. Credentials come only from the System's helper or agent: BASE_ENV turns every
// prompt off, so an op that would prompt fails (REMOTE_AUTH_FAILED). Hooks (pre-push) always run.

const decoder = new TextDecoder('utf-8', { fatal: false });
const hasControlOrSpace = (s) => [...s].some((c) => c.charCodeAt(0) < 0x21 || c.charCodeAt(0) === 0x7f);

/** A remote name's shape, checked before any exec: non-empty, no leading `-`, no whitespace or control character. */
export function remoteName(s) {
  if (typeof s !== 'string' || s === '' || s.length > 200 || s.startsWith('-') || hasControlOrSpace(s)) {
    throw new Refusal('REMOTE_UNKNOWN', 'invalid remote name');
  }
  return s;
}

/** `name` is one of `git remote`'s remotes, else REMOTE_UNKNOWN. */
export async function knownRemote(git, name) {
  const remotes = parseRemotes(decoder.decode((await git(['remote'])).stdout));
  if (!remotes.includes(name)) throw new Refusal('REMOTE_UNKNOWN', `no remote ${name}`);
  return name;
}

/**
 * `git push --porcelain --no-follow-tags` of `refspecs` (`src:dst`) to `remote` → {updated, rejected, upToDate,
 * unrequested} (splitRequested over parsePushPorcelain): the first three hold only the refspecs' destinations.
 * `--no-follow-tags` keeps a configured `push.followTags` from publishing tags nobody selected. A push that reports no
 * ref at all failed as a whole: REMOTE_AUTH_FAILED / REMOTE_UNREACHABLE, or GIT_FAILED with git's stderr (a pre-push
 * hook that refused lands here). Rejected refs are the caller's to judge.
 */
export async function push(git, remote, refspecs) {
  const r = await git(['push', '--porcelain', '--no-follow-tags', '--end-of-options', remote, ...refspecs], {
    timeoutMs: NETWORK_LIMITS.timeoutMs, maxOutputBytes: NETWORK_LIMITS.maxOutputBytes, okExit: [0, 1, 128],
  });
  const parsed = parsePushPorcelain(decoder.decode(r.stdout));
  const reported = parsed.updated.length + parsed.rejected.length + parsed.upToDate.length;
  if (r.exitCode !== 0 && !reported) {
    const stderr = decoder.decode(r.stderr);
    const code = classifyRemoteFailure(stderr);
    if (code) throw new Refusal(code, code === 'REMOTE_AUTH_FAILED' ? `${remote} refused the credentials (or would have prompted)` : `${remote} could not be reached`, { stderr });
    throw new Refusal('GIT_FAILED', `git push exited with ${r.exitCode}`, { exitCode: r.exitCode, stderr });
  }
  return splitRequested(parsed, refspecs.map((s) => s.slice(s.indexOf(':') + 1)));
}

/** PUSH_REJECTED with the rejected refs when a push changed nothing and refused something. */
export function assertSomethingPushed(result, remote) {
  if (!result.updated.length && !result.upToDate.length && result.rejected.length) {
    throw new Refusal('PUSH_REJECTED', `${remote} rejected the push`, { rejected: result.rejected });
  }
}
