import { bad } from '../params.js';
import { STASH_LIMITS } from './limits.js';

// Stash messages: the user's text, and the subjects git itself writes ("On <branch>: <msg>", "WIP on …", "index on …").

const hasControl = (s) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
const PREFIX_RE = /^(?:WIP on|On) ([^:]*): /;

/** A user's stash message, trimmed: one line, no control characters, ≤ STASH_LIMITS.messageMax. Absent or blank → null. */
export function checkMessage(v) {
  if (v === undefined) return null;
  if (typeof v !== 'string') throw bad('message must be a string');
  const m = v.trim();
  if (m.length > STASH_LIMITS.messageMax) throw bad(`message must be at most ${STASH_LIMITS.messageMax} characters`);
  if (hasControl(m)) throw bad('message must be one line without control characters');
  return m || null;
}

/** The branch label git stash writes: the short branch name, or `(no branch)` on a detached HEAD. */
export const branchLabel = (own) => (own.branch?.startsWith('refs/heads/') ? own.branch.slice('refs/heads/'.length) : '(no branch)');

/** The subject `git stash push` gives a stash's W commit: `On <branch>: <msg>`, or `WIP on <branch>: <head>` without a message. */
export const wMessage = (branch, msg, head) => (msg ? `On ${branch}: ${msg}` : `WIP on ${branch}: ${head}`);

/** A renamed stash's subject: the old subject's `<branch>` kept, `msg` in place of the rest; a subject git did not write → `msg`. */
export function reMessage(oldSubject, msg) {
  const m = PREFIX_RE.exec(oldSubject);
  return m ? `On ${m[1]}: ${msg}` : msg;
}
