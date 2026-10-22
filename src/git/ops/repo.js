import { Refusal } from '../../refusals.js';
import { parseStatus } from '../parse/status.js';
import { bareRefusal, isBare } from '../worktree.js';

const decoder = new TextDecoder('utf-8', { fatal: false });

export const ops = [
  {
    name: 'repo.summary',
    kind: 'read',
    params(raw) {
      if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) {
        throw new Refusal('BAD_PARAMS', 'repo.summary takes no params');
      }
      return {};
    },
    async run(git) {
      let r;
      try {
        r = await git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']);
      } catch (e) {
        // LC_ALL=C keeps git's wording stable.
        if (e.code === 'GIT_FAILED' && e.extra.exitCode === 128 && e.extra.stderr.includes('not a git repository')) {
          throw new Refusal('NOT_A_REPO', 'not a git repository', { detail: e.extra.stderr });
        }
        throw e;
      }
      // Under --work-tree=. a bare repository's status succeeds, listing its own files: core.bare says what it is.
      if (await isBare(git)) throw bareRefusal();
      return parseStatus(decoder.decode(r.stdout));
    },
  },
];
