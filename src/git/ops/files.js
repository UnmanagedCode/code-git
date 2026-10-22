import { Refusal } from '../../refusals.js';
import { bad, paramsObject } from '../params.js';
import { assertPath, OID_RE } from '../validate.js';

const decoder = new TextDecoder('utf-8', { fatal: false });

/** `git cat-file -t <spec>`'s type, or null when the object does not exist. */
async function objectType(git, spec) {
  const r = await git(['cat-file', '-t', spec], { okExit: [0, 128] });
  return r.exitCode === 0 ? decoder.decode(r.stdout).trim() : null;
}

export const ops = [
  {
    // "Reset file to this commit": the path's index entry and worktree file become the commit's version.
    name: 'files.restore',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['oid', 'path'], 'files.restore');
      if (typeof p.oid !== 'string' || !OID_RE.test(p.oid)) throw bad('oid must be a full commit id');
      return { oid: p.oid, path: assertPath(p.path) };
    },
    async run(git, p) {
      if (await objectType(git, p.oid) !== 'commit') throw new Refusal('REV_UNKNOWN', `${p.oid} is not a commit in this repository`);
      if (await objectType(git, `${p.oid}:${p.path}`) !== 'blob') throw new Refusal('PATH_NOT_IN_COMMIT', `${p.path} is not a file in ${p.oid.slice(0, 10)}`);
      await git(['restore', `--source=${p.oid}`, '--staged', '--worktree', '--', p.path]);
      return { oid: p.oid, path: p.path };
    },
  },
];
