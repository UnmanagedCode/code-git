import path from 'node:path';
import { Refusal } from '../../refusals.js';
import { joinMessage, splitMessage, templateDraft } from '../commit/message.js';
import { readNoIndex } from '../diff/noIndex.js';
import { commitOid } from '../diff/source.js';
import { bad, optBool, paramsObject } from '../params.js';
import { STAGE_LIMITS } from '../stage/limits.js';

// Commit, amend, and the two reads the commit box needs: HEAD's message (for amend) and the commit.template draft.

const decoder = new TextDecoder('utf-8', { fatal: false });
const noParams = (op) => (raw) => {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) throw bad(`${op} takes no params`);
  return {};
};

async function mustHead(git) {
  const head = await commitOid(git, 'HEAD');
  if (!head) throw new Refusal('NO_HEAD', 'HEAD has no commit yet');
  return head;
}

/** `git config --get <key>`'s value, or null when unset. */
async function configValue(git, args) {
  const r = await git(['config', ...args], { okExit: [0, 1] });
  return r.exitCode === 0 ? decoder.decode(r.stdout).replace(/\n$/, '') : null;
}

/** git's comment prefix: core.commentString, else core.commentChar; `auto` or unset → `#`. */
async function commentPrefix(git) {
  const v = (await configValue(git, ['--get', 'core.commentString'])) ?? (await configValue(git, ['--get', 'core.commentChar']));
  return !v || v === 'auto' ? '#' : v;
}

/**
 * The template's bytes, following symlinks by hand (each target relative to its link's directory) for up to
 * STAGE_LIMITS.templateMaxLinks hops: a dotfile manager's symlink works with git commands only. `{bytes}` or `{problem}`.
 */
async function readTemplate(git, file) {
  let cur = file;
  for (let hop = 0; hop <= STAGE_LIMITS.templateMaxLinks; hop++) {
    const r = await readNoIndex(git, cur, { maxBytes: STAGE_LIMITS.templateMaxBytes });
    if (r.kind === 'file') return { bytes: r.bytes };
    if (r.kind === 'symlink') { cur = path.posix.resolve(path.posix.dirname(cur), r.linkTarget); continue; }
    const why = {
      absent: 'does not exist', other: 'is not a file', binary: 'is a binary file',
      large: `is larger than ${STAGE_LIMITS.templateMaxBytes} bytes`,
    }[r.kind];
    return { problem: `commit.template ${cur} ${why}` };
  }
  return { problem: `commit.template ${file}: more than ${STAGE_LIMITS.templateMaxLinks} symbolic links` };
}

export const ops = [
  {
    name: 'commit.create',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['summary', 'description', 'amend', 'messageOnly', 'noVerify'], 'commit.create');
      if (typeof p.summary !== 'string' || !p.summary.trim()) throw bad('summary must be a non-empty string');
      if (/[\r\n]/.test(p.summary)) throw bad('summary must be one line');
      if (p.description !== undefined && typeof p.description !== 'string') throw bad('description must be a string');
      const description = p.description ?? '';
      if (p.summary.includes('\0') || description.includes('\0')) throw bad('a commit message cannot contain NUL');
      const amend = optBool(p.amend, 'amend');
      const messageOnly = optBool(p.messageOnly, 'messageOnly');
      if (messageOnly && !amend) throw bad('messageOnly needs amend');
      return { summary: p.summary, description, amend, messageOnly, noVerify: optBool(p.noVerify, 'noVerify') };
    },
    async run(git, p) {
      if (p.amend) await mustHead(git);
      else {
        // Nothing staged and no merge to conclude: git would refuse too, with less to go on.
        const staged = await git(['diff', '--cached', '--quiet', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none'], { okExit: [0, 1] });
        if (staged.exitCode === 0) {
          const merging = await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { okExit: [0, 1] });
          if (merging.exitCode === 1) throw new Refusal('NOTHING_TO_COMMIT', 'nothing is staged');
        }
      }
      // No --cleanup: the repo's commit.cleanup applies (git's default for -F is `whitespace`, which keeps `#` lines).
      // `--amend --only` without paths amends the message alone: what is staged stays staged.
      const args = ['commit', ...(p.amend ? ['--amend'] : []), ...(p.messageOnly ? ['--only'] : []), ...(p.noVerify ? ['--no-verify'] : []), '-F', '-'];
      await git(args, { stdin: joinMessage(p.summary, p.description) });
      return { oid: await mustHead(git) };
    },
  },
  {
    name: 'commit.headMessage',
    kind: 'read',
    params: noParams('commit.headMessage'),
    async run(git) {
      const oid = await mustHead(git);
      const r = await git(['log', '-1', '--no-show-signature', '--format=%B', '--end-of-options', oid]);
      return { oid, ...splitMessage(decoder.decode(r.stdout)) };
    },
  },
  {
    name: 'commit.template',
    kind: 'read',
    params: noParams('commit.template'),
    async run(git) {
      const file = await configValue(git, ['--path', '--get', 'commit.template']);
      if (file === null || file === '') return { path: null, draft: null, problem: null };
      const t = await readTemplate(git, file);
      if (t.problem) return { path: file, draft: null, problem: t.problem };
      return { path: file, draft: templateDraft(decoder.decode(t.bytes), await commentPrefix(git)), problem: null };
    },
  },
];
