import { Refusal } from '../../refusals.js';
import { classifyRemoteFailure } from '../parse/push.js';
import { NETWORK_LIMITS } from './limits.js';

// The one way a command that talks to a remote runs (fetch, push, ls-remote). Credentials come only from the System's
// helper or agent: BASE_ENV turns every prompt off, so a command that would prompt fails (REMOTE_AUTH_FAILED).

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Before every network subcommand. The `ext::` transport runs an arbitrary command and `fd::` talks over inherited
 * descriptors; a repo's config can reach them (`protocol.allow`, `protocol.ext.allow`, an `insteadOf` rewriting a url to
 * `ext::…`). `protocol.<name>.allow` beats `protocol.allow`, and `-c` beats every config file, so these two win.
 */
export const NET_CONFIG = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.fd.allow=never'];

/** Runs `args` (a network subcommand and its arguments) under NET_CONFIG and NETWORK_LIMITS; `opts.okExit` as runGit's. */
export function netRun(git, args, opts = {}) {
  return git([...NET_CONFIG, ...args], { timeoutMs: NETWORK_LIMITS.timeoutMs, maxOutputBytes: NETWORK_LIMITS.maxOutputBytes, ...opts });
}

/** What each failure reason asks of the user: they set it up on the System, code-git never prompts. */
const MESSAGES = {
  credentials: (r) => `${r} refused the credentials: update what the credential helper stores on the project's System`,
  prompt: (r) => `${r} needs credentials and code-git cannot prompt: configure a credential helper or an ssh key/agent on the project's System`,
  'ssh-key': (r) => `${r} refused the ssh key: add a key the server accepts (or an ssh agent holding one) on the project's System`,
  'ssh-host-key': (r) => `${r}'s ssh host key is not trusted: add it to known_hosts on the project's System`,
  dns: (r) => `${r}'s host name could not be resolved`,
  refused: (r) => `${r} refused the connection`,
  timeout: (r) => `${r} did not answer: the connection timed out`,
  'not-found': (r) => `${r} has no repository at its url`,
  unavailable: (r) => `${r} could not be reached`,
};

/**
 * The refusal for a network command `r` (a runGit result) to `remote` that failed as a whole: REMOTE_AUTH_FAILED or
 * REMOTE_UNREACHABLE with `reason` (classifyRemoteFailure), a message saying what to fix, and git's `stderr`; anything
 * else GIT_FAILED with `exitCode` and `stderr` (a hook that refused, a git error).
 */
export function remoteFailure(remote, r, command) {
  const stderr = decoder.decode(r.stderr);
  const c = classifyRemoteFailure(stderr);
  if (c) return new Refusal(c.code, MESSAGES[c.reason](remote), { reason: c.reason, stderr });
  return new Refusal('GIT_FAILED', `git ${command} exited with ${r.exitCode}`, { exitCode: r.exitCode, stderr });
}
