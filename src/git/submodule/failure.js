import { Refusal } from '../../refusals.js';
import { maskUrls } from '../../mask.js';
import { remoteFailure } from '../remote/net.js';

// The refusal for a failed clone, update or sync (a runGit result outside exit 0). LC_ALL=C keeps git's wording stable.

const decoder = new TextDecoder('utf-8', { fatal: false });
const TRANSPORT_RE = /transport '([^']*)' not allowed/;
const DIRTY = ['would be overwritten by checkout', 'Your local changes'];

/**
 * SUBMODULE_TRANSPORT_BLOCKED `{transport}` (git's protocol policy refused the url's transport: for `file`, the System's
 * `protocol.file.allow`), SUBMODULE_DIRTY (a checkout over local changes), else the remote ops' remoteFailure:
 * REMOTE_AUTH_FAILED / REMOTE_UNREACHABLE with `reason`, or GIT_FAILED `{exitCode}`; each with git's `stderr`, url
 * passwords masked (maskUrls).
 */
export function submoduleFailure(r, command) {
  // git names the url it failed to clone: a password in it is masked in everything the refusal carries.
  const stderr = maskUrls(decoder.decode(r.stderr));
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
  return remoteFailure("a submodule's remote", { ...r, stderr: Buffer.from(stderr) }, command);
}
