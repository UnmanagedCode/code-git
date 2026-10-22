import { Refusal } from '../../refusals.js';
import { readNoIndex } from '../diff/noIndex.js';
import { ignorePattern } from '../ignore/pattern.js';
import { nulPaths, optBool, paramsObject } from '../params.js';
import { STAGE_LIMITS } from '../stage/limits.js';
import { assertWorktree } from '../worktree.js';

// Ignore a file, an extension or a directory in the root .gitignore, optionally removing what it matches from the index.
// `.git/info/exclude` is not a target: `git apply` refuses `.git/` paths and code-git runs nothing but git.

const decoder = new TextDecoder('utf-8', { fatal: false });
const NO_NEWLINE = '\\ No newline at end of file';
const FILE = '.gitignore';
const HEADER = [`diff --git a/${FILE} b/${FILE}`];

/**
 * A patch appending `line` to the .gitignore whose content is `text` (latin1; null = absent), with the whole file as
 * context, so a concurrent edit makes `git apply` fail instead of being overwritten. `{patch, unidiffZero}`.
 */
function appendPatch(text, line) {
  if (text === null) return { patch: [...HEADER, 'new file mode 100644', '--- /dev/null', `+++ b/${FILE}`, '@@ -0,0 +1,1 @@', `+${line}`], unidiffZero: false };
  const head = [...HEADER, `--- a/${FILE}`, `+++ b/${FILE}`];
  if (text === '') return { patch: [...head, '@@ -0,0 +1,1 @@', `+${line}`], unidiffZero: true };
  const lines = text.split('\n');
  const endsWithNewline = lines.at(-1) === '';
  if (endsWithNewline) lines.pop();
  const crlf = lines[0].endsWith('\r');
  const eol = crlf ? '\r' : '';
  const body = lines.map((l) => ` ${l}`);
  if (!endsWithNewline) {
    // The last line gains a newline: removed without one, added back with one.
    const last = lines.at(-1);
    body.splice(-1, 1, `-${last}`, NO_NEWLINE, `+${crlf && !last.endsWith('\r') ? `${last}\r` : last}`);
  }
  const n = lines.length;
  return { patch: [...head, `@@ -1,${n} +1,${n + 1} @@`, ...body, `+${line}${eol}`], unidiffZero: false };
}

export const ops = [
  {
    name: 'ignore.add',
    kind: 'write',
    params(raw) {
      const p = paramsObject(raw, ['kind', 'value', 'stopTracking'], 'ignore.add');
      return { kind: p.kind, pattern: ignorePattern(p.kind, p.value), value: p.value, stopTracking: optBool(p.stopTracking, 'stopTracking') };
    },
    async run(git, p) {
      await assertWorktree(git);
      const cur = await readNoIndex(git, FILE, { maxBytes: STAGE_LIMITS.gitignoreMaxBytes });
      if (cur.kind !== 'file' && cur.kind !== 'absent') {
        throw new Refusal('GITIGNORE_UNSUPPORTED', `the root ${FILE} is ${cur.kind === 'large' ? `larger than ${STAGE_LIMITS.gitignoreMaxBytes} bytes` : `a ${cur.kind === 'other' ? 'directory' : cur.kind}`}: edit it by hand`);
      }
      // What stop-tracking removes is listed first, so a refused request writes nothing. Only what this one pattern
      // matches (never --exclude-standard): an already-ignored tracked file stays tracked.
      let untracked = [];
      if (p.stopTracking) {
        const match = p.kind === 'ext' ? ['-i', `--exclude=${p.pattern}`] : ['--', p.value];
        const r = await git(['ls-files', '-z', '-c', ...match]);
        untracked = decoder.decode(r.stdout).split('\0').filter(Boolean);
        // A file pattern stops tracking that file only: a path that is a folder in the index is refused.
        if (p.kind === 'path' && untracked.some((f) => f !== p.value)) throw new Refusal('BAD_PATH', `${p.value} is a folder: ignore it as a folder`);
      }
      const text = cur.kind === 'file' ? cur.bytes.toString('latin1') : null;
      const present = text !== null && text.split('\n').some((l) => l.replace(/\r$/, '') === p.pattern);
      if (!present) {
        const { patch, unidiffZero } = appendPatch(text, p.pattern);
        await git(['apply', '--whitespace=nowarn', '--no-ignore-whitespace', ...(unidiffZero ? ['--unidiff-zero'] : []), '-'], {
          stdin: Buffer.from(`${patch.join('\n')}\n`, 'latin1'),
        });
      }
      if (untracked.length) {
        try {
          await git(['rm', '--cached', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: nulPaths(untracked) });
        } catch (e) {
          if (e.code !== 'GIT_FAILED') throw e;
          throw new Refusal('GIT_FAILED', `${FILE} ${present ? 'already had' : 'now has'} ${p.pattern}, but removing the matching files from the index failed`, { ...e.extra, step: 'stopTracking' });
        }
      }
      return { pattern: p.pattern, added: !present, untracked };
    },
  },
];
