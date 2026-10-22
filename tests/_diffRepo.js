import fs from 'node:fs';
import path from 'node:path';
import { makeRepo } from './_git.js';

// The diff fixture, shared by the diff op tests and the Playwright seed: one repo covering every diff source and file
// state, with a hostile .git/config (set last) so every op runs against config that reshapes diff output.

const pointer = (c, size) => `version https://git-lfs.github.com/spec/v1\noid sha256:${c.repeat(64)}\nsize ${size}\n`;
export const LFS = { old: { oid: 'a'.repeat(64), size: 12345 }, new: { oid: 'b'.repeat(64), size: 67890 } };
export const GITLINK = { old: '1'.repeat(40), new: '2'.repeat(40) };
export const SECRET_MARKER = 'SECRET-MARKER-7f3a9c';
export const XSS_LINE = '<img src=x onerror=alert(1)>';
export const HUGE_LINES = 10_001;

// Two changes 11 lines apart: under the fixture's diff.interHunkContext=10 / diff.context=10 they would be one hunk.
const appLines = (greet, tail) => [
  'export function greet(name: string): string {', `  const greeting = ${greet};`, '', '  return greeting + name;', '}', '',
  ...Array.from({ length: 11 }, (_, i) => `// filler ${i + 1}`),
  `export const tail = ${tail};`, '',
].join('\n');
export const APP_OLD = appLines('foo(bar)', 1);
export const APP_NEW = appLines('foo(baz)', 2);

const HOSTILE_CONFIG = [
  ['diff.suppressBlankEmpty', 'true'], ['diff.noprefix', 'true'], ['diff.interHunkContext', '10'], ['diff.submodule', 'log'],
  ['color.diff', 'always'], ['color.ui', 'always'], ['diff.context', '10'], ['diff.relative', 'true'], ['diff.mnemonicPrefix', 'true'],
  ['format.signature', 'SIG'], ['format.headers', 'X-Hostile: yes'], ['format.to', 'to@example.com'], ['format.cc', 'cc@example.com'],
  ['format.coverLetter', 'true'], ['format.numbered', 'true'], ['format.thread', 'shallow'], ['format.useAutoBase', 'true'],
  ['format.from', 'true'], ['format.attach', 'true'], ['format.notes', 'true'], ['format.signOff', 'true'], ['format.forceInBodyFrom', 'true'],
];

/**
 * History (first parent on main):  root → m1 → merge(m1, topic) → change → tail = HEAD;
 * `topic` = root → t1; `side` = change → s1 → s2; `orphan` = one unrelated root commit.
 * WIP: tail.txt staged, main-only.txt unstaged, untracked notes.txt, symlinks `out` → / and `secret-link` → a file
 * outside the repo holding SECRET_MARKER. `hostileRan` is the path an external diff or textconv driver would create.
 */
export function diffRepo(t, { name = 'diffs' } = {}) {
  const repo = makeRepo(t, { name });
  const { git } = repo;
  const gitlink = (oid) => git('update-index', '--add', '--cacheinfo', `160000,${oid},vendor/lib`);
  fs.mkdirSync(path.join(repo.dir, 'vendor', 'lib'), { recursive: true });
  gitlink(GITLINK.old);
  const root = repo.commit({
    'src/app.ts': APP_OLD, 'old/name.js': 'one\ntwo\nthree\nfour\nfive\nsix\n', 'bin.dat': Buffer.from([0, 1, 2, 0, 3]),
    'big.bin': pointer('a', LFS.old.size), '-rf': 'dash\n', ':(glob)*': 'magic\n', 'w.txt': 'a b\n', 'conv.tc': 'conv 1\n',
    '.gitattributes': '*.tc diff=hostile\n', 'xss.html': '<p>safe</p>\n',
  }, 'root');
  repo.branch('topic');
  const t1 = repo.commit({ 'topic.txt': 'topic\n' }, 'topic work');
  repo.checkout('main');
  const m1 = repo.commit({ 'main-only.txt': 'main\n' }, 'main work');
  git('merge', '-q', '--no-ff', '-m', 'merge topic', 'topic');
  const merge = git('rev-parse', 'HEAD');
  repo.write('huge.txt', Array.from({ length: HUGE_LINES }, (_, i) => `line ${i}`).join('\n') + '\n');
  fs.rmSync(path.join(repo.dir, 'old'), { recursive: true });
  gitlink(GITLINK.new);
  const change = repo.commit({
    'src/app.ts': APP_NEW, 'new/name.js': 'one\ntwo\nthree\nfour\nfive\nSIX\n', 'bin.dat': Buffer.from([0, 9, 9, 0, 3]),
    'big.bin': pointer('b', LFS.new.size), '-rf': 'dash 2\n', ':(glob)*': 'magic 2\n', 'w.txt': 'a  b\n', 'conv.tc': 'conv 2\n',
    'xss.html': `${XSS_LINE}\n`,
  }, 'change');
  repo.branch('side');
  const s1 = repo.commit({ 'side.txt': 'side 1\n' }, 'side 1');
  const s2 = repo.commit({ 'side2.txt': 'side 2\n' }, 'side 2');
  repo.checkout('main');
  const tail = repo.commit({ 'tail.txt': 'tail\n' }, 'tail');
  git('checkout', '-q', '--orphan', 'orphan');
  git('rm', '-rq', '--cached', '.');
  git('commit', '-q', '--allow-empty', '-m', 'orphan');
  const orphan = git('rev-parse', 'HEAD');
  git('checkout', '-q', '-f', 'main');

  repo.write('tail.txt', 'tail staged\n');
  git('add', 'tail.txt');
  repo.write('main-only.txt', 'main unstaged\n');
  repo.write('notes.txt', 'untracked\nnotes\n');
  const secret = path.join(repo.root, 'secret.txt');
  fs.writeFileSync(secret, `${SECRET_MARKER}\n`);
  fs.symlinkSync('/', path.join(repo.dir, 'out'));
  fs.symlinkSync(secret, path.join(repo.dir, 'secret-link'));

  // Hostile config last, so the fixture's own commands above are unaffected.
  const hostileRan = path.join(repo.root, 'hostile-ran');
  const driver = path.join(repo.root, 'hostile.sh');
  fs.writeFileSync(driver, `#!/bin/sh\ntouch '${hostileRan}'\ncat "$1" 2>/dev/null\n`, { mode: 0o755 });
  for (const [k, v] of [...HOSTILE_CONFIG, ['diff.external', driver], ['diff.hostile.textconv', driver], ['diff.hostile.command', driver]]) git('config', k, v);
  return { repo, oids: { root, t1, m1, merge, change, s1, s2, tail, orphan }, hostileRan, secret };
}
