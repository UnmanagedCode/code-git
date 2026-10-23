import { Refusal } from '../../refusals.js';
import { classifyRemoteFailure } from '../parse/push.js';

// The refusal for a failed clone, update or sync (a runGit result outside exit 0). LC_ALL=C keeps git's wording stable.
// On rebase onto C6 Remotes: the remote branch becomes C6's remoteFailure.

const decoder = new TextDecoder('utf-8', { fatal: false });
const TRANSPORT_RE = /transport '([^']*)' not allowed/;
const DIRTY = ['would be overwritten by checkout', 'Your local changes'];
const REMOTE_MESSAGES = {
  REMOTE_AUTH_FAILED: "a submodule's remote needs credentials code-git cannot give: configure a credential helper or an ssh key/agent on the project's System",
  REMOTE_UNREACHABLE: "a submodule's remote could not be reached",
};

/**
 * SUBMODULE_TRANSPORT_BLOCKED `{transport}` (git's protocol policy refused the url's transport: for `file`, the System's
 * `protocol.file.allow`), SUBMODULE_DIRTY (a checkout over local changes), REMOTE_AUTH_FAILED / REMOTE_UNREACHABLE, else
 * GIT_FAILED `{exitCode}`; each with git's `stderr`.
 */
export function submoduleFailure(r, command) {
  const stderr = decoder.decode(r.stderr);
  const transport = TRANSPORT_RE.exec(stderr)?.[1];
  if (transport !== undefined) {
    const why = transport === 'file'
      ? "git allows a local-path clone into a submodule only when the System's git config sets protocol.file.allow (code-git never sets it)"
      : `git's protocol policy refuses the '${transport}' transport`;
    return new Refusal('SUBMODULE_TRANSPORT_BLOCKED', why, { transport, stderr });
  }
  if (DIRTY.some((p) => stderr.includes(p))) {
    return new Refusal('SUBMODULE_DIRTY', 'a submodule has local changes the checkout would overwrite: commit, stash or discard them first', { stderr });
  }
  const remote = classifyRemoteFailure(stderr);
  if (remote) return new Refusal(remote, REMOTE_MESSAGES[remote], { stderr });
  return new Refusal('GIT_FAILED', `git ${command} exited with ${r.exitCode}`, { exitCode: r.exitCode, stderr });
}
