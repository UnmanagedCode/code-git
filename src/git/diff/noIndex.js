import { Refusal } from '../../refusals.js';
import { parseFilePatch } from '../parse/diff.js';
import { contextArg, DIFF_CONFIG, DIFF_FLAGS } from './source.js';

// Reading one file through `git diff --no-index /dev/null <path>`: the only way code-git reads a file's bytes, since
// git runs only through cc's exec (wiki: gotchas/diff-parsing → untracked files).

const decoder = new TextDecoder('utf-8', { fatal: false });
const SYMLINK = '120000';

/** The raw probe: `--no-index --raw -z`, zero oids, no content. Its fields and stderr. */
async function probe(git, path) {
  const r = await git([...DIFF_CONFIG, 'diff', '--no-index', ...DIFF_FLAGS, '--raw', '-z', '--no-abbrev', '--', '/dev/null', path], { okExit: [0, 1] });
  return { fields: decoder.decode(r.stdout).split('\0'), stderr: decoder.decode(r.stderr) };
}

const readsItself = (fields, path) => fields.length === 3 && fields[0].startsWith(':') && fields[1] === path && fields[2] === '';

/**
 * `git diff --no-index /dev/null <path>` reads `<path>` itself only when it is not a directory to git's stat: a symlink to
 * a directory (listed by ls-files as the link) becomes `<path>/null`, a file outside the repo. This raw probe returns no
 * content (zero oids) and is stat-only for regular files; a special file at `<path>/null` (a FIFO) is opened and can block
 * until the read timeout. Unless it names exactly one entry, `path` itself, the read is refused.
 */
export async function assertNoIndexReadsItself(git, path) {
  if (!readsItself((await probe(git, path)).fields, path)) {
    throw new Refusal('BAD_PATH', `${path} is a link to a directory: its content is not shown`);
  }
}

/**
 * Reads one file's exact bytes: `{kind, mode, bytes, linkTarget}`. `kind`: `absent` (git cannot access it), `other`
 * (a directory, or a link to one), `symlink` (`linkTarget` = its target, never followed), `binary`, `large` (over
 * `maxBytes`), or `file` (`bytes` = the content). The diff is decoded as latin1, one character per byte, so CR and
 * non-UTF-8 bytes survive. `path` may be absolute (a commit template outside the repo).
 */
/**
 * What stands at `path` on disk, by the raw probe alone (no content read): `{kind, mode}`, `kind` = `absent` (git cannot
 * access it), `other` (a directory, or a link to one), `symlink` (mode 120000, never followed) or `file`.
 */
export async function worktreeEntry(git, path) {
  const p = await probe(git, path);
  if (!readsItself(p.fields, path)) {
    // A missing path: exit 1, no entry, git naming exactly the path (a directory's message names `<path>/null`).
    return { kind: p.fields.join('') === '' && p.stderr.includes(`Could not access '${path}'`) ? 'absent' : 'other', mode: null };
  }
  const mode = p.fields[0].split(' ')[1];
  return { kind: mode === SYMLINK ? 'symlink' : 'file', mode };
}

export async function readNoIndex(git, path, { maxBytes }) {
  const none = { mode: null, bytes: null, linkTarget: null };
  const entry = await worktreeEntry(git, path);
  if (entry.kind === 'absent' || entry.kind === 'other') return { ...none, kind: entry.kind };
  const { mode } = entry;
  let r;
  try {
    // Each content byte costs at most two output bytes ('+' and '\n' for an empty line); the header is bounded by the path.
    r = await git([...DIFF_CONFIG, 'diff', '--no-index', ...DIFF_FLAGS, contextArg('full'), '--', '/dev/null', path], {
      okExit: [0, 1], maxOutputBytes: 2 * maxBytes + 64 * 1024,
    });
  } catch (e) {
    if (e.code === 'OUTPUT_TOO_LARGE') return { ...none, mode, kind: 'large' };
    throw e;
  }
  const fd = parseFilePatch(r.stdout.toString('latin1'));
  if (fd.binary) return { ...none, mode, kind: 'binary' };
  const text = fd.hunks.flatMap((h) => h.lines).map((l) => (l.noNewline ? l.text : `${l.text}\n`)).join('');
  const bytes = Buffer.from(text, 'latin1');
  if (mode === SYMLINK) return { ...none, mode, kind: 'symlink', linkTarget: bytes.toString('utf8') };
  if (bytes.length > maxBytes) return { ...none, mode, kind: 'large' };
  return { kind: 'file', mode, bytes, linkTarget: null };
}
