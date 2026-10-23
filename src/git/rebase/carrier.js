import { Refusal } from '../../refusals.js';
import { OID_RE } from '../validate.js';

// Carrier commits (docs/merge.md → The scripted editor): commit X's tree on X's parent with X's author and a new message,
// so `pick <carrier>` applies exactly X's change under that message. Dangling until the rebase reaches them, or gc.

const decoder = new TextDecoder('utf-8', { fatal: false });

/** Whether commit.gpgSign is true: `commit-tree` ignores it, so a carrier passes `-S` itself. */
export async function signsCommits(git) {
  const r = await git(['config', '--type=bool', '--get', 'commit.gpgSign'], { okExit: [0, 1] });
  return r.exitCode === 0 && decoder.decode(r.stdout).trim() === 'true';
}

/** The carrier of commit `oid` with `message` (text); its author name, email and date are `oid`'s. → the new commit's oid. */
export async function makeCarrier(git, oid, message, { sign }) {
  const r = await git(['log', '-1', '--no-show-signature', '--format=%an%x00%ae%x00%ad%x00%P', '--date=raw', '--end-of-options', oid]);
  const [name, email, date, parents = ''] = decoder.decode(r.stdout).replace(/\n$/, '').split('\0');
  const parent = parents.split(' ').filter(Boolean)[0];
  const made = await git(
    ['commit-tree', ...(sign ? ['-S'] : []), ...(parent ? ['-p', parent] : []), '-F', '-', '--end-of-options', `${oid}^{tree}`],
    { stdin: message, env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date } },
  );
  const carrier = decoder.decode(made.stdout).trim();
  if (!OID_RE.test(carrier)) throw new Refusal('GIT_FAILED', `git commit-tree printed no commit for ${oid.slice(0, 7)}`, { stderr: decoder.decode(made.stderr) });
  return carrier;
}
