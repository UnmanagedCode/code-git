import { Refusal } from '../../refusals.js';
import { DIFF_LIMITS } from '../diff/limits.js';
import { assertNoIndexReadsItself, noIndexDiff } from '../diff/noIndex.js';
import {
  contextArg, DIFF_CONFIG, DIFF_FLAGS, emptyTree, FORMAT_PATCH_FLAGS, pairArgs, parseContext, parseSource, resolveSource, WHITESPACE_FLAGS,
} from '../diff/source.js';
import { bad, paramsObject } from '../params.js';
import { detectLfs, parseFilePatch, parseRawNumstat } from '../parse/diff.js';
import { assertPath } from '../validate.js';

const decoder = new TextDecoder('utf-8', { fatal: false });

function whitespace(v) {
  if (v === undefined) return 'none';
  if (!Object.hasOwn(WHITESPACE_FLAGS, v)) throw bad('whitespace must be none, eol, change or all');
  return v;
}

const isWip = (pair) => pair.old.type === 'index' && pair.new.type === 'worktree';

/** Untracked files, as `?` entries of the file list. */
async function untracked(git) {
  const r = await git(['ls-files', '--others', '--exclude-standard', '-z']);
  return decoder.decode(r.stdout).split('\0').filter(Boolean).map((path) => ({
    path, oldPath: null, status: '?', similarity: null, added: null, deleted: null, binary: false, submodule: false,
    oldMode: null, newMode: null, oldOid: null, newOid: null,
  }));
}

/** The download name, built here only: `[A-Za-z0-9._-]`, the project name capped at 80 characters. */
export function patchFilename(project, resolved) {
  const { pair, commit } = resolved;
  const short = (oid) => oid.slice(0, 7);
  if (commit) return `${short(commit.oid)}.patch`;
  if (pair.old.type === 'tree' && pair.new.type === 'tree') return `${short(pair.old.oid)}..${short(pair.new.oid)}.patch`;
  const name = project.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const kind = isWip(pair) ? 'unstaged' : pair.new.type === 'index' ? 'staged' : 'worktree';
  return `${name}-${kind}.patch`;
}

export const ops = [
  {
    name: 'diff.files',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['source', 'whitespace'], 'diff.files');
      return { source: parseSource(p.source), whitespace: whitespace(p.whitespace) };
    },
    async run(git, p) {
      const resolved = await resolveSource(git, p.source);
      const { opts, revs } = pairArgs(resolved.pair);
      const r = await git(
        [...DIFF_CONFIG, 'diff', ...DIFF_FLAGS, ...WHITESPACE_FLAGS[p.whitespace], '--raw', '--numstat', '-z', '--no-abbrev', ...opts, ...revs, '--'],
        { maxOutputBytes: DIFF_LIMITS.listMaxOutputBytes },
      );
      const files = parseRawNumstat(decoder.decode(r.stdout));
      if (isWip(resolved.pair)) files.push(...await untracked(git));
      return {
        ...resolved,
        files: files.map((f) => ({ ...f, oversized: (f.added ?? 0) + (f.deleted ?? 0) > DIFF_LIMITS.oversizeLines })),
      };
    },
  },
  {
    name: 'diff.file',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['source', 'path', 'oldPath', 'untracked', 'context', 'whitespace'], 'diff.file');
      const context = parseContext(p.context);
      if (p.untracked !== undefined && typeof p.untracked !== 'boolean') throw bad('untracked must be a boolean');
      const oldPath = p.oldPath === undefined || p.oldPath === null ? null : assertPath(p.oldPath);
      if (p.untracked && oldPath) throw bad('an untracked file has no oldPath');
      return {
        source: parseSource(p.source), path: assertPath(p.path), oldPath, untracked: p.untracked ?? false,
        context, whitespace: whitespace(p.whitespace),
      };
    },
    async run(git, p) {
      const { pair } = await resolveSource(git, p.source);
      const flags = [...DIFF_FLAGS, ...WHITESPACE_FLAGS[p.whitespace], contextArg(p.context)];
      let r;
      if (p.untracked) {
        if (!isWip(pair)) throw bad('untracked is allowed only for an index → worktree diff');
        // Only a path git itself lists as untracked: no path through a symlinked directory.
        const listed = await git(['ls-files', '--others', '--exclude-standard', '-z', '--', p.path]);
        if (decoder.decode(listed.stdout) !== `${p.path}\0`) throw new Refusal('BAD_PATH', `${p.path} is not an untracked file`);
        await assertNoIndexReadsItself(git, p.path);
        r = await noIndexDiff(git, flags, p.path, { maxOutputBytes: DIFF_LIMITS.fileMaxOutputBytes });
      } else {
        const { opts, revs } = pairArgs(pair);
        const paths = p.oldPath ? [p.oldPath, p.path] : [p.path];
        r = await git([...DIFF_CONFIG, 'diff', ...flags, ...opts, ...revs, '--', ...paths], { maxOutputBytes: DIFF_LIMITS.fileMaxOutputBytes });
      }
      const parsed = parseFilePatch(decoder.decode(r.stdout));
      return { path: p.path, oldPath: p.oldPath, ...parsed, lfs: parsed.submodule || parsed.binary ? null : detectLfs(parsed.hunks) };
    },
  },
  {
    name: 'diff.patch',
    kind: 'read',
    params(raw) {
      const p = paramsObject(raw, ['source', 'paths'], 'diff.patch');
      if (p.paths !== undefined && (!Array.isArray(p.paths) || !p.paths.length || p.paths.length > DIFF_LIMITS.maxPaths)) {
        throw bad(`paths must list 1…${DIFF_LIMITS.maxPaths} paths`);
      }
      return { source: parseSource(p.source), paths: p.paths?.map(assertPath) ?? [] };
    },
    async run(git, p, { target }) {
      const resolved = await resolveSource(git, p.source);
      const { pair, commit, series } = resolved;
      // Mailbox form (git am) for one non-merge commit or a merge-free run of commits; a plain diff (git apply) otherwise.
      const mailbox = commit ? commit.parents.length <= 1 : series ? !series.direct && !series.wip && !series.merges : false;
      let args;
      if (mailbox) {
        const tip = pair.new.oid;
        const root = commit ? commit.parents.length === 0 : pair.old.oid === await emptyTree(git);
        const range = root ? ['--root', '--end-of-options', tip] : ['--end-of-options', `${pair.old.oid}..${tip}`];
        args = [...DIFF_CONFIG, 'format-patch', '--stdout', ...FORMAT_PATCH_FLAGS, ...DIFF_FLAGS, ...range, '--', ...p.paths];
      } else {
        const { opts, revs } = pairArgs(pair);
        args = [...DIFF_CONFIG, 'diff', '--binary', ...DIFF_FLAGS, ...opts, ...revs, '--', ...p.paths];
      }
      const r = await git(args, { maxOutputBytes: DIFF_LIMITS.patchMaxOutputBytes });
      return { filename: patchFilename(target.project, resolved), base64: r.stdout.toString('base64'), bytes: r.stdout.length };
    },
  },
];
