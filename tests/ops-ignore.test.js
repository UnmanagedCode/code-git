import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { escapeGlob, ignorePattern } from '../src/git/ignore/pattern.js';
import { STAGE_LIMITS } from '../src/git/stage/limits.js';
import { hostile, noViolations, opWorld, refused } from './_ops.js';

async function world(t, files = { 'keep.txt': 'k\n' }) {
  const w = await opWorld(t);
  w.repo.commit(files);
  hostile(w.repo);
  return w;
}
const gitignore = (w) => fs.readFileSync(path.join(w.repo.dir, '.gitignore'));
/** Whether git now ignores `p` (check-ignore, untracked view). */
const ignored = (w, p) => {
  try { w.repo.git('check-ignore', '-q', '--no-index', '--', p); return true; } catch { return false; }
};

test('patterns: anchored paths and dirs, *.ext, with \\ * ? [ and trailing spaces escaped', () => {
  assert.equal(ignorePattern('path', 'a/b.txt'), '/a/b.txt');
  assert.equal(ignorePattern('dir', 'build/'), '/build/');
  assert.equal(ignorePattern('dir', 'out'), '/out/');
  assert.equal(ignorePattern('ext', 'log'), '*.log');
  assert.equal(ignorePattern('path', 'a*b?[c]'), '/a\\*b\\?\\[c]');
  assert.equal(ignorePattern('path', 'sp  '), '/sp\\ \\ ');
  assert.equal(escapeGlob('x\\y'), 'x\\\\y');
  assert.equal(ignorePattern('path', '#a'), '/#a');
  assert.equal(ignorePattern('path', '!b'), '/!b');
  for (const [k, v, code] of [['path', 'a\nb', 'BAD_PATH'], ['path', 'a\tb', 'BAD_PATH'], ['ext', '', 'BAD_PARAMS'], ['ext', 'a/b', 'BAD_PARAMS'], ['ext', '.log', 'BAD_PARAMS'], ['other', 'x', 'BAD_PARAMS'], ['path', '../x', 'BAD_PATH'], ['path', 3, 'BAD_PARAMS']]) {
    assert.throws(() => ignorePattern(k, v), refused(code), `${k} ${v}`);
  }
});

test('ignore.add creates the root .gitignore when there is none, unstaged', async (t) => {
  const w = await world(t);
  w.repo.write('debug.log', 'x\n');
  const r = await w.op('ignore.add', { kind: 'path', value: 'debug.log' });
  assert.deepEqual(r, { pattern: '/debug.log', added: true, untracked: [] });
  assert.equal(gitignore(w).toString(), '/debug.log\n');
  assert.ok(ignored(w, 'debug.log'));
  assert.deepEqual(w.status(), { '.gitignore': '??' });
  noViolations(w.cc);
});

test('appending keeps the existing bytes: a missing final newline is added; CRLF files get CRLF', async (t) => {
  const w = await world(t, { '.gitignore': 'node_modules\n# c\ndist' });
  await w.op('ignore.add', { kind: 'ext', value: 'log' });
  assert.equal(gitignore(w).toString(), 'node_modules\n# c\ndist\n*.log\n');
  const c = await world(t, { '.gitignore': 'a\r\nb\r\n' });
  await c.op('ignore.add', { kind: 'dir', value: 'out' });
  assert.equal(gitignore(c).toString(), 'a\r\nb\r\n/out/\r\n');
  const e = await world(t, { '.gitignore': '' });
  await e.op('ignore.add', { kind: 'path', value: 'x' });
  assert.equal(gitignore(e).toString(), '/x\n');
  const l = await world(t, { '.gitignore': Buffer.from('caf\xe9\n', 'latin1') });
  await l.op('ignore.add', { kind: 'path', value: 'x' });
  assert.deepEqual(gitignore(l), Buffer.from('caf\xe9\n/x\n', 'latin1'));
});

test('a pattern already present is not added again', async (t) => {
  const w = await world(t, { '.gitignore': '*.log\r\n' });
  const r = await w.op('ignore.add', { kind: 'ext', value: 'log' });
  assert.equal(r.added, false);
  assert.equal(gitignore(w).toString(), '*.log\r\n');
  assert.ok(!w.execArgv().some((a) => a.includes('apply')));
});

test('escaped patterns ignore exactly the named file: #a, !b, a*b, a trailing space', async (t) => {
  const w = await world(t);
  for (const name of ['#a', '!b', 'a*b', 'sp ']) {
    w.repo.write(name, 'x\n');
    await w.op('ignore.add', { kind: 'path', value: name });
    assert.ok(ignored(w, name), name);
  }
  w.repo.write('aXb', 'x\n');
  w.repo.write('sp', 'x\n');
  assert.equal(ignored(w, 'aXb'), false);
  assert.equal(ignored(w, 'sp'), false);
});

test('ext and dir patterns ignore at any depth / that directory', async (t) => {
  const w = await world(t);
  await w.op('ignore.add', { kind: 'ext', value: 'tmp' });
  await w.op('ignore.add', { kind: 'dir', value: 'build' });
  assert.ok(ignored(w, 'deep/x.tmp'));
  assert.ok(ignored(w, 'build/out.js'));
  assert.equal(ignored(w, 'src/build/out.js'), false);
});

test('stop tracking removes only what this pattern matches from the index; the files stay on disk', async (t) => {
  const w = await world(t, { '.gitignore': '*.old\n', 'a.log': 'a\n', 'sub/b.log': 'b\n', 'keep.txt': 'k\n', 'dist/x.js': 'x\n' });
  w.repo.write('was.old', 'tracked but ignored\n');
  w.repo.git('add', '-f', 'was.old');
  w.repo.git('commit', '-q', '-m', 'tracked-ignored');
  const r = await w.op('ignore.add', { kind: 'ext', value: 'log', stopTracking: true });
  assert.deepEqual(r.untracked.sort(), ['a.log', 'sub/b.log']);
  const tracked = w.repo.git('ls-files').split('\n');
  assert.ok(!tracked.includes('a.log') && !tracked.includes('sub/b.log'));
  assert.ok(tracked.includes('was.old') && tracked.includes('keep.txt'));
  assert.ok(fs.existsSync(path.join(w.repo.dir, 'a.log')));
  assert.deepEqual(w.status(), { '.gitignore': ' M', 'a.log': 'D ', 'sub/b.log': 'D ' });
  const d = await w.op('ignore.add', { kind: 'dir', value: 'dist', stopTracking: true });
  assert.deepEqual(d.untracked, ['dist/x.js']);
  const f = await w.op('ignore.add', { kind: 'path', value: 'keep.txt', stopTracking: true });
  assert.deepEqual(f.untracked, ['keep.txt']);
  assert.ok(fs.existsSync(path.join(w.repo.dir, 'keep.txt')));
});

test('GITIGNORE_UNSUPPORTED: a symlinked, binary or oversized .gitignore, or a directory; nothing written', async (t) => {
  const w = await world(t);
  fs.writeFileSync(path.join(w.repo.root, 'target'), 'outside\n');
  fs.symlinkSync(path.join(w.repo.root, 'target'), path.join(w.repo.dir, '.gitignore'));
  await assert.rejects(w.op('ignore.add', { kind: 'path', value: 'x' }), refused('GITIGNORE_UNSUPPORTED'));
  assert.equal(fs.readFileSync(path.join(w.repo.root, 'target'), 'utf8'), 'outside\n');
  fs.rmSync(path.join(w.repo.dir, '.gitignore'));
  for (const content of [Buffer.from([0, 1, 2]), 'x'.repeat(STAGE_LIMITS.gitignoreMaxBytes + 1)]) {
    fs.writeFileSync(path.join(w.repo.dir, '.gitignore'), content);
    await assert.rejects(w.op('ignore.add', { kind: 'path', value: 'x' }), refused('GITIGNORE_UNSUPPORTED'));
    assert.deepEqual(gitignore(w), Buffer.from(content));
  }
  fs.rmSync(path.join(w.repo.dir, '.gitignore'));
  fs.mkdirSync(path.join(w.repo.dir, '.gitignore'));
  await assert.rejects(w.op('ignore.add', { kind: 'path', value: 'x' }), refused('GITIGNORE_UNSUPPORTED'));
});

test('a .gitignore edited between the read and the apply makes the apply fail; the edit is kept, nothing overwritten', async (t) => {
  const w = await world(t, { '.gitignore': 'a\n' });
  w.cc.state.execHook = (body) => (body.argv.includes('apply') ? 'hold' : undefined);
  const running = w.op('ignore.add', { kind: 'path', value: 'x' });
  const held = await w.cc.nextHeld();
  w.repo.write('.gitignore', 'a\nedited meanwhile\n');
  held.release();
  await assert.rejects(running, refused('GIT_FAILED'));
  assert.equal(gitignore(w).toString(), 'a\nedited meanwhile\n');
});

test('the line ending of a .gitignore append follows its last line, not its first ("\\na\\r\\n" gets CRLF)', async (t) => {
  const w = await world(t, { '.gitignore': '\na\r\n' });
  await w.op('ignore.add', { kind: 'path', value: 'x' });
  assert.equal(gitignore(w).toString(), '\na\r\n/x\r\n');
  const l = await world(t, { '.gitignore': 'a\r\nb\n' });
  await l.op('ignore.add', { kind: 'path', value: 'x' });
  assert.equal(gitignore(l).toString(), 'a\r\nb\n/x\n');
});

test('ignore and stop tracking refuses `.` or empty as a path or folder, and a folder given as a path, writing nothing', async (t) => {
  const w = await world(t, { 'keep.txt': 'k\n', 'src/a.ts': 'a\n', 'src/b.ts': 'b\n' });
  for (const [kind, value] of [['path', '.'], ['path', ''], ['dir', '.'], ['dir', './'], ['path', 'src/./a.ts']]) {
    await assert.rejects(w.op('ignore.add', { kind, value, stopTracking: true }), (e) => ['BAD_PATH', 'BAD_PARAMS'].includes(e.code), `${kind} ${value}`);
  }
  await assert.rejects(w.op('ignore.add', { kind: 'path', value: 'src', stopTracking: true }), refused('BAD_PATH'));
  assert.equal(fs.existsSync(path.join(w.repo.dir, '.gitignore')), false);
  assert.deepEqual(w.repo.git('ls-files').split('\n').sort(), ['keep.txt', 'src/a.ts', 'src/b.ts']);
  // The folder kind covers it.
  const r = await w.op('ignore.add', { kind: 'dir', value: 'src', stopTracking: true });
  assert.deepEqual(r.untracked.sort(), ['src/a.ts', 'src/b.ts']);
});

test('ignore.add params', async (t) => {
  const w = await world(t);
  for (const p of [{}, { kind: 'path' }, { kind: 'path', value: 'x', stopTracking: 'yes' }, { kind: 'path', value: 'x', extra: 1 }, { kind: 'glob', value: 'x' }]) {
    await assert.rejects(w.op('ignore.add', p), refused('BAD_PARAMS'), JSON.stringify(p));
  }
  assert.equal(w.cc.state.execCalls.length, 0);
});
