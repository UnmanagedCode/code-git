import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { joinMessage, splitMessage, templateDraft } from '../src/git/commit/message.js';
import { STAGE_LIMITS } from '../src/git/stage/limits.js';
import { hermeticEnv } from './_git.js';
import { hostile, noViolations, opWorld, refused } from './_ops.js';

async function world(t, { commit = true } = {}) {
  const w = await opWorld(t);
  if (commit) w.repo.commit({ 'a.txt': 'a\n' }, 'first');
  hostile(w.repo);
  return w;
}
const msg = (w, rev = 'HEAD') => w.raw('cat-file', 'commit', rev).toString().split('\n\n').slice(1).join('\n\n');
const parents = (w, rev = 'HEAD') => w.repo.git('rev-list', '--parents', '-n', '1', rev).split(' ').slice(1);
const tree = (w, rev = 'HEAD') => w.repo.git('rev-parse', `${rev}^{tree}`);

test('message: join and split are inverse; the description is optional and trimmed at the end', () => {
  assert.equal(joinMessage('  Fix it  ', ''), 'Fix it\n');
  assert.equal(joinMessage('Fix it', 'Why:\n\n- a\n  \n'), 'Fix it\n\nWhy:\n\n- a\n');
  assert.deepEqual(splitMessage('Fix it\n\nWhy:\n\n- a\n'), { summary: 'Fix it', description: 'Why:\n\n- a' });
  assert.deepEqual(splitMessage('\n\n  Title\nbody right after\n\n'), { summary: 'Title', description: 'body right after' });
  assert.deepEqual(splitMessage(''), { summary: '', description: '' });
  assert.deepEqual(templateDraft('# hint\nSubject\n# more\n\nBody\n', '#'), { summary: 'Subject', description: 'Body' });
  assert.deepEqual(templateDraft('; hint\n# kept\n', ';'), { summary: '# kept', description: '' });
});

test('commit.create commits the staged changes with exactly the joined message, `#` lines kept; returns the new HEAD', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.git('add', 'a.txt');
  const r = await w.op('commit.create', { summary: 'Change a', description: 'Because.\n\n# not a comment\n' });
  assert.equal(r.oid, w.repo.git('rev-parse', 'HEAD'));
  assert.equal(msg(w), 'Change a\n\nBecause.\n\n# not a comment\n');
  assert.deepEqual(w.status(), {});
  const argv = w.execArgv().find((a) => a.includes('commit'));
  assert.deepEqual(argv.slice(argv.indexOf('commit')), ['commit', '-F', '-']);
  noViolations(w.cc);
});

test('the repo\'s commit.cleanup is honoured (strip drops `#` lines)', async (t) => {
  const w = await world(t);
  w.repo.git('config', 'commit.cleanup', 'strip');
  w.repo.write('a.txt', 'a2\n');
  w.repo.git('add', 'a.txt');
  await w.op('commit.create', { summary: 'S', description: '# gone\nkept' });
  assert.equal(msg(w), 'S\n\nkept\n');
});

test('NOTHING_TO_COMMIT with nothing staged (unstaged changes do not count); a merge with nothing staged commits; commit.state reports the merge', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'unstaged\n');
  const head = w.repo.git('rev-parse', 'HEAD');
  await assert.rejects(w.op('commit.create', { summary: 'x' }), refused('NOTHING_TO_COMMIT'));
  assert.equal(w.repo.git('rev-parse', 'HEAD'), head);
  w.repo.git('checkout', '-q', '--', 'a.txt');
  w.repo.branch('other');
  w.repo.commit({ 'b.txt': 'b\n' }, 'other');
  w.repo.checkout('main');
  assert.deepEqual(await w.op('commit.state'), { merging: false });
  w.repo.git('merge', '-q', '--no-commit', '-s', 'ours', 'other');
  assert.deepEqual(await w.op('commit.state'), { merging: true });
  await w.op('commit.create', { summary: 'Merge other' });
  assert.equal(parents(w).length, 2);
  assert.deepEqual(await w.op('commit.state'), { merging: false });
});

test('amend takes in the staged changes and replaces HEAD (same parent)', async (t) => {
  const w = await world(t);
  const first = w.repo.git('rev-parse', 'HEAD');
  w.repo.commit({ 'b.txt': 'b\n' }, 'second');
  w.repo.write('c.txt', 'c\n');
  w.repo.git('add', 'c.txt');
  await w.op('commit.create', { summary: 'second, amended', amend: true });
  assert.deepEqual(parents(w), [first]);
  assert.equal(msg(w), 'second, amended\n');
  assert.ok(w.repo.git('ls-tree', '--name-only', 'HEAD').split('\n').includes('c.txt'));
});

test('a message-only amend keeps the tree and leaves the staged changes staged', async (t) => {
  const w = await world(t);
  w.repo.commit({ 'b.txt': 'b\n' }, 'second');
  const before = tree(w);
  w.repo.write('a.txt', 'staged\n');
  w.repo.git('add', 'a.txt');
  await w.op('commit.create', { summary: 'Reworded', description: 'body', amend: true, messageOnly: true });
  assert.equal(tree(w), before);
  assert.equal(msg(w), 'Reworded\n\nbody\n');
  assert.deepEqual(w.status(), { 'a.txt': 'M ' });
});

test('amending a root commit keeps it parentless; amend on an unborn HEAD is NO_HEAD', async (t) => {
  const w = await world(t);
  await w.op('commit.create', { summary: 'root again', amend: true, messageOnly: true });
  assert.deepEqual(parents(w), []);
  const u = await opWorld(t, { name: 'unborn' });
  u.repo.write('x', 'x\n');
  u.repo.git('add', 'x');
  await assert.rejects(u.op('commit.create', { summary: 's', amend: true }), refused('NO_HEAD'));
  // A first commit on the unborn branch works.
  await u.op('commit.create', { summary: 'first' });
  assert.equal(u.repo.git('rev-list', '--count', 'HEAD'), '1');
});

test('a commit on a detached HEAD moves HEAD only, no branch', async (t) => {
  const w = await world(t);
  const main = w.repo.git('rev-parse', 'main');
  w.repo.git('checkout', '-q', '--detach');
  w.repo.write('a.txt', 'detached\n');
  w.repo.git('add', 'a.txt');
  const r = await w.op('commit.create', { summary: 'on no branch' });
  assert.equal(w.repo.git('rev-parse', 'main'), main);
  assert.deepEqual(parents(w), [main]);
  assert.equal(r.oid, w.repo.git('rev-parse', 'HEAD'));
});

test('a failing pre-commit or commit-msg hook → GIT_FAILED with its output; noVerify commits past both', async (t) => {
  const w = await world(t);
  w.repo.write('a.txt', 'a2\n');
  w.repo.git('add', 'a.txt');
  const head = w.repo.git('rev-parse', 'HEAD');
  w.repo.hook('pre-commit', '#!/bin/sh\necho "lint: 3 problems" >&2\nexit 1\n');
  await assert.rejects(w.op('commit.create', { summary: 's' }), (e) => e.code === 'GIT_FAILED' && e.extra.stderr.includes('lint: 3 problems'));
  fs.rmSync(path.join(w.repo.dir, '.git', 'hooks', 'pre-commit'));
  w.repo.hook('commit-msg', '#!/bin/sh\necho "msg: needs a ticket" >&2\nexit 1\n');
  await assert.rejects(w.op('commit.create', { summary: 's' }), (e) => e.code === 'GIT_FAILED' && e.extra.stderr.includes('msg: needs a ticket'));
  assert.equal(w.repo.git('rev-parse', 'HEAD'), head);
  w.repo.hook('pre-commit', '#!/bin/sh\nexit 1\n');
  await w.op('commit.create', { summary: 'skipped hooks', noVerify: true });
  assert.equal(msg(w), 'skipped hooks\n');
  const argv = w.execArgv().at(-2);
  assert.ok(argv.includes('--no-verify'));
});

test('commit.gpgSign with a signer that cannot sign fails promptly as GIT_FAILED with its output, committing nothing', { timeout: 30_000 }, async (t) => {
  const w = await world(t);
  // gpg with no usable key or pinentry exits non-zero at once ("Inappropriate ioctl for device"); this stand-in does the same.
  const fake = path.join(w.repo.root, 'fake-gpg.sh');
  fs.writeFileSync(fake, '#!/bin/sh\ncat >/dev/null\necho "gpg: signing failed: Inappropriate ioctl for device" >&2\nexit 2\n', { mode: 0o755 });
  w.repo.git('config', 'commit.gpgSign', 'true');
  w.repo.git('config', 'gpg.program', fake);
  w.repo.write('a.txt', 'a2\n');
  w.repo.git('add', 'a.txt');
  const head = w.repo.git('rev-parse', 'HEAD');
  await assert.rejects(w.op('commit.create', { summary: 's' }), (e) => e.code === 'GIT_FAILED' && e.extra.stderr.includes('Inappropriate ioctl'));
  assert.equal(w.repo.git('rev-parse', 'HEAD'), head);
});

test('real gpg (RUN_REAL_GPG=1): a passphrase key with no pinentry tty fails promptly, it does not hang', { skip: process.env.RUN_REAL_GPG !== '1', timeout: 60_000 }, async (t) => {
  const w = await world(t);
  const env = { ...hermeticEnv(w.repo.home), GNUPGHOME: path.join(w.repo.home, '.gnupg') };
  fs.mkdirSync(env.GNUPGHOME, { mode: 0o700 });
  t.after(() => { try { execFileSync('gpgconf', ['--kill', 'gpg-agent'], { env }); } catch { /* no agent */ } });
  execFileSync('gpg', ['--batch', '--pinentry-mode', 'loopback', '--passphrase', 'secret', '--quick-gen-key', 'T <t@example.com>', 'ed25519', 'sign', 'never'], { env, stdio: 'ignore' });
  w.repo.git('config', 'commit.gpgSign', 'true');
  w.repo.write('a.txt', 'a2\n');
  w.repo.git('add', 'a.txt');
  await assert.rejects(w.op('commit.create', { summary: 's' }), (e) => e.code === 'GIT_FAILED' && e.extra.stderr.includes('signing failed'));
});

test('commit.create params: one-line non-empty summary, no NUL, messageOnly needs amend, booleans only', async (t) => {
  const w = await world(t);
  for (const p of [
    {}, { summary: '' }, { summary: '   ' }, { summary: 'a\nb' }, { summary: 'a\rb' }, { summary: 'a\0' }, { summary: 's', description: 'x\0' },
    { summary: 's', description: 3 }, { summary: 's', messageOnly: true }, { summary: 's', amend: 'yes' }, { summary: 's', noVerify: 1 },
    { summary: 's', cleanup: 'verbatim' },
  ]) await assert.rejects(w.op('commit.create', p), refused('BAD_PARAMS'), JSON.stringify(p));
  assert.equal(w.cc.state.execCalls.length, 0);
});

test('commit.headMessage splits HEAD\'s message; NO_HEAD when unborn', async (t) => {
  const w = await world(t);
  w.repo.git('commit', '-q', '--allow-empty', '-m', 'Title line', '-m', 'Para one.\n\nPara two.');
  assert.deepEqual(await w.op('commit.headMessage'), {
    oid: w.repo.git('rev-parse', 'HEAD'), summary: 'Title line', description: 'Para one.\n\nPara two.',
  });
  const u = await opWorld(t, { name: 'unborn' });
  await assert.rejects(u.op('commit.headMessage'), refused('NO_HEAD'));
  await assert.rejects(w.op('commit.headMessage', { x: 1 }), refused('BAD_PARAMS'));
});

test('commit.template: unset → nulls; set → the draft without comment lines', async (t) => {
  const w = await world(t);
  assert.deepEqual(await w.op('commit.template'), { path: null, draft: null, problem: null });
  const file = path.join(w.repo.root, 'tmpl.txt');
  fs.writeFileSync(file, '# Write a summary\nfeat: \n\n# Why?\nBecause\n');
  w.repo.git('config', 'commit.template', file);
  assert.deepEqual(await w.op('commit.template'), { path: file, draft: { summary: 'feat:', description: 'Because' }, problem: null });
});

test('commit.template: core.commentChar decides which lines are comments', async (t) => {
  const w = await world(t);
  const file = path.join(w.repo.root, 'tmpl.txt');
  fs.writeFileSync(file, '; hint\n# kept as text\n');
  w.repo.git('config', 'commit.template', file);
  w.repo.git('config', 'core.commentChar', ';');
  assert.deepEqual((await w.op('commit.template')).draft, { summary: '# kept as text', description: '' });
  w.repo.git('config', 'core.commentChar', 'auto');
  assert.deepEqual((await w.op('commit.template')).draft, { summary: '; hint', description: '' });
});

test('commit.template: a `~/` path expands to HOME; a symlinked template is followed by hand', async (t) => {
  const w = await world(t);
  fs.mkdirSync(path.join(w.repo.home, 'dotfiles'));
  fs.writeFileSync(path.join(w.repo.home, 'dotfiles', 'gitmessage'), 'Subject from dotfiles\n');
  // ~/.gitmessage → dotfiles/gitmessage (relative), via a second, absolute link.
  fs.symlinkSync(path.join(w.repo.home, 'dotfiles', 'gitmessage'), path.join(w.repo.home, 'abs-link'));
  fs.symlinkSync('abs-link', path.join(w.repo.home, '.gitmessage'));
  w.repo.git('config', 'commit.template', '~/.gitmessage');
  const r = await w.op('commit.template');
  assert.equal(r.path, path.join(w.repo.home, '.gitmessage'));
  assert.deepEqual(r.draft, { summary: 'Subject from dotfiles', description: '' });
});

test('commit.template: a relative template path resolves against the repo toplevel, and each relative link against its link\'s directory', async (t) => {
  const w = await world(t);
  fs.mkdirSync(path.join(w.repo.dir, 'tmpl', 'real'), { recursive: true });
  fs.writeFileSync(path.join(w.repo.dir, 'tmpl', 'real', 'msg'), 'Subject from a relative link\n');
  fs.symlinkSync('real/msg', path.join(w.repo.dir, 'tmpl', 'link'));
  w.repo.git('config', 'commit.template', 'tmpl/link');
  const r = await w.op('commit.template');
  assert.equal(r.problem, null);
  assert.deepEqual(r.draft, { summary: 'Subject from a relative link', description: '' });
});

test('commit.template: core.commentString is preferred, and core.commentChar is the fallback', async (t) => {
  const w = await world(t);
  const file = path.join(w.repo.root, 'tmpl.txt');
  fs.writeFileSync(file, '; semicolon line\n# hash line\n');
  w.repo.git('config', 'commit.template', file);
  w.repo.git('config', 'core.commentString', ';');
  assert.deepEqual((await w.op('commit.template')).draft, { summary: '# hash line', description: '' });
  w.repo.git('config', '--unset', 'core.commentString');
  w.repo.git('config', 'core.commentChar', ';');
  assert.deepEqual((await w.op('commit.template')).draft, { summary: '# hash line', description: '' });
  // Both set: commentString wins.
  w.repo.git('config', 'core.commentString', '#');
  assert.deepEqual((await w.op('commit.template')).draft, { summary: '; semicolon line', description: '' });
});

test('commit.template problems are reported, never thrown: missing, binary, directory, too large, a link loop', async (t) => {
  const w = await world(t);
  const at = (name) => path.join(w.repo.root, name);
  fs.writeFileSync(at('bin'), Buffer.from([0, 1, 2]));
  fs.mkdirSync(at('dir'));
  fs.writeFileSync(at('big'), 'x'.repeat(STAGE_LIMITS.templateMaxBytes + 1));
  fs.symlinkSync('loop-b', at('loop-a'));
  fs.symlinkSync('loop-a', at('loop-b'));
  for (const [name, re] of [['missing', /does not exist/], ['bin', /binary/], ['dir', /not a file/], ['big', /larger than/], ['loop-a', /symbolic links/]]) {
    w.repo.git('config', 'commit.template', at(name));
    const r = await w.op('commit.template');
    assert.equal(r.draft, null, name);
    assert.match(r.problem, re, name);
  }
});
