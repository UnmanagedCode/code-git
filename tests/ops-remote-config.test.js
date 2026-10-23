import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { endOfOptionsBefore, refsWorld, refused } from './_refsWorld.js';

// remote.list / add / edit / rename / remove against a real repo: what git's config and refs hold afterwards.

const config = (w, key) => { try { return w.repo.git('config', '--get-all', key).split('\n'); } catch { return []; } };
const remoteWrites = (w) => w.argvs().filter((a) => (a[0] === 'remote' && a.length > 1) || (a[0] === 'config' && a.includes('--unset-all')));
const DEFAULT = (n) => `+refs/heads/*:refs/remotes/${n}/*`;

/** A url-less remote `leg` (listed: it has a config key) whose url git reads from a legacy .git/remotes file. */
const legacyRemote = (w) => {
  fs.mkdirSync(path.join(w.repo.dir, '.git', 'remotes'), { recursive: true });
  fs.writeFileSync(path.join(w.repo.dir, '.git', 'remotes', 'leg'), `URL: ${w.origin.dir}\nPull: refs/heads/main:refs/remotes/leg/main\n`);
  w.repo.git('config', 'remote.leg.fetch', DEFAULT('leg'));
};

test('remote.list: every remote in git remote order with urls as git counts them, raw fetch, masked displayUrl, dotted names, legacy', async (t) => {
  const w = await refsWorld(t);
  fs.mkdirSync(path.join(w.repo.dir, '.git', 'remotes'), { recursive: true });
  w.repo.git('remote', 'add', 'a', 'https://u:secret@h.example/r.git');
  w.repo.git('remote', 'add', 'a.b', 'git@h:x.git');
  w.repo.git('config', '--add', 'remote.a.b.pushurl', 'ssh://p@h/x');
  w.repo.git('config', '--add', 'remote.a.url', '');
  w.repo.git('config', '--add', 'remote.a.url', 'https://u:pw@later.example/r');
  w.repo.git('config', 'remote.pushonly.pushurl', 'https://h/p');
  legacyRemote(w);
  const r = await w.op('remote.list', undefined);
  const byName = Object.fromEntries(r.remotes.map((x) => [x.name, x]));
  assert.deepEqual(r.remotes.map((x) => x.name).sort(), ['a', 'a.b', 'leg', 'origin', 'pushonly']);
  assert.deepEqual(byName.a, { name: 'a', urls: ['https://u:pw@later.example/r'], pushUrls: [], fetch: [DEFAULT('a')], displayUrl: 'https://u:***@later.example/r', legacy: false });
  assert.deepEqual(byName['a.b'], { name: 'a.b', urls: ['git@h:x.git'], pushUrls: ['ssh://p@h/x'], fetch: [DEFAULT('a.b')], displayUrl: 'git@h:x.git', legacy: false });
  assert.deepEqual(byName.origin, { name: 'origin', urls: [w.origin.dir], pushUrls: [], fetch: [DEFAULT('origin')], displayUrl: w.origin.dir, legacy: false });
  assert.deepEqual(byName.pushonly, { name: 'pushonly', urls: [], pushUrls: ['https://h/p'], fetch: [], displayUrl: 'https://h/p', legacy: false });
  assert.deepEqual(byName.leg, { name: 'leg', urls: [], pushUrls: [], fetch: [DEFAULT('leg')], displayUrl: null, legacy: true });
  assert.equal(w.writes().length, 0);
});

test('remote.add: --end-of-options before the name, the url and push url written, undo.remotes holds what was created', async (t) => {
  const w = await refsWorld(t);
  const r = await w.op('remote.add', { name: 'up', url: 'https://h.example/up.git', pushUrl: 'git@h.example:up.git' });
  assert.equal(r.name, 'up');
  assert.deepEqual(config(w, 'remote.up.url'), ['https://h.example/up.git']);
  assert.deepEqual(config(w, 'remote.up.pushurl'), ['git@h.example:up.git']);
  assert.deepEqual(config(w, 'remote.up.fetch'), [DEFAULT('up')]);
  const [add, setUrl] = remoteWrites(w);
  assert.deepEqual(add, ['remote', 'add', '--end-of-options', 'up', 'https://h.example/up.git']);
  assert.deepEqual(setUrl, ['remote', 'set-url', '--push', '--end-of-options', 'up', 'git@h.example:up.git']);
  assert.deepEqual(r.undo.remotes, [{ name: 'up', old: null, new: { urls: ['https://h.example/up.git'], pushUrls: ['git@h.example:up.git'], fetch: [DEFAULT('up')], upstreams: [] } }]);
  assert.deepEqual([r.undo.refs, r.undo.head], [[], null]);
  await w.op('remote.add', { name: 'plain', url: '/srv/plain.git' });
  assert.deepEqual(config(w, 'remote.plain.pushurl'), []);
});

test('remote.add: an existing name → REMOTE_EXISTS before any write; a bad url or name is refused before any exec', async (t) => {
  const w = await refsWorld(t);
  await assert.rejects(w.op('remote.add', { name: 'origin', url: '/x.git' }), refused('REMOTE_EXISTS'));
  assert.deepEqual(remoteWrites(w), []);
  const execs = w.cc.state.execCalls.length;
  await assert.rejects(w.op('remote.add', { name: 'evil', url: 'ext::sh -c id' }), refused('BAD_URL'));
  await assert.rejects(w.op('remote.add', { name: 'ok', url: '/x.git', pushUrl: '--receive-pack=x' }), refused('BAD_URL'));
  await assert.rejects(w.op('remote.add', { name: '-x', url: '/x.git' }), refused('BAD_REF'));
  await assert.rejects(w.op('remote.add', { name: 'a..b', url: '/x.git' }), refused('BAD_REF'));
  await assert.rejects(w.op('remote.add', { name: 'x', url: '/x.git', extra: 1 }), refused('BAD_PARAMS'));
  assert.equal(w.cc.state.execCalls.length, execs, 'nothing ran');
});

test('remote.edit changes only the fields given: url alone, pushUrl alone, pushUrl null unsets; undo has old and new', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('config', 'remote.origin.pushurl', '/push.git');
  const r1 = await w.op('remote.edit', { name: 'origin', url: '/moved.git' });
  assert.deepEqual([config(w, 'remote.origin.url'), config(w, 'remote.origin.pushurl')], [['/moved.git'], ['/push.git']]);
  assert.deepEqual(remoteWrites(w), [['remote', 'set-url', '--end-of-options', 'origin', '/moved.git']]);
  assert.deepEqual(r1.undo.remotes, [{
    name: 'origin',
    old: { urls: [w.origin.dir], pushUrls: ['/push.git'], fetch: [DEFAULT('origin')], upstreams: [{ branch: 'main', merge: 'refs/heads/main' }] },
    new: { urls: ['/moved.git'], pushUrls: ['/push.git'], fetch: [DEFAULT('origin')], upstreams: [{ branch: 'main', merge: 'refs/heads/main' }] },
  }]);
  await w.op('remote.edit', { name: 'origin', pushUrl: 'git@h:p.git' });
  assert.deepEqual([config(w, 'remote.origin.url'), config(w, 'remote.origin.pushurl')], [['/moved.git'], ['git@h:p.git']]);
  await w.op('remote.edit', { name: 'origin', pushUrl: null });
  assert.deepEqual([config(w, 'remote.origin.url'), config(w, 'remote.origin.pushurl')], [['/moved.git'], []]);
  assert.deepEqual(remoteWrites(w).at(-1), ['config', '--unset-all', 'remote.origin.pushurl']);
  await w.op('remote.edit', { name: 'origin', pushUrl: null });
  assert.deepEqual(config(w, 'remote.origin.pushurl'), [], 'unsetting an unset push url succeeds');
});

test('remote.edit refuses a multi-valued list it would replace, a legacy remote, an unknown remote, no field, a bad url', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('config', '--add', 'remote.origin.url', '/second.git');
  await assert.rejects(w.op('remote.edit', { name: 'origin', url: '/x.git' }), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'origin' }));
  w.repo.git('config', '--unset-all', 'remote.origin.url');
  w.repo.git('config', 'remote.origin.url', w.origin.dir);
  w.repo.git('config', '--add', 'remote.origin.pushurl', '/p1');
  w.repo.git('config', '--add', 'remote.origin.pushurl', '/p2');
  await assert.rejects(w.op('remote.edit', { name: 'origin', pushUrl: '/x.git' }), refused('REMOTE_CONFIG_UNSUPPORTED'));
  await assert.rejects(w.op('remote.edit', { name: 'origin', pushUrl: null }), refused('REMOTE_CONFIG_UNSUPPORTED'));
  await w.op('remote.edit', { name: 'origin', url: '/single-url-ok.git' });
  legacyRemote(w);
  await assert.rejects(w.op('remote.edit', { name: 'leg', url: '/x.git' }), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'leg', refspec: null }));
  await assert.rejects(w.op('remote.edit', { name: 'nope', url: '/x.git' }), refused('REMOTE_UNKNOWN'));
  assert.deepEqual(remoteWrites(w), [['remote', 'set-url', '--end-of-options', 'origin', '/single-url-ok.git']]);
  await assert.rejects(w.op('remote.edit', { name: 'origin' }), refused('BAD_PARAMS'));
  await assert.rejects(w.op('remote.edit', { name: 'origin', url: 'fd::3' }), refused('BAD_URL'));
  await assert.rejects(w.op('remote.edit', { name: '-o', url: '/x' }), refused('REMOTE_UNKNOWN'));
});

test('remote.rename: the default refspec renames tracking refs (HEAD alias included) and upstreams; undo names both', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('fetch', '-q', 'origin');
  w.repo.git('remote', 'set-head', 'origin', 'main');
  const r = await w.op('remote.rename', { name: 'origin', newName: 'up/stream' });
  assert.equal(r.name, 'up/stream');
  assert.deepEqual(remoteWrites(w), [['remote', 'rename', '--end-of-options', 'origin', 'up/stream']]);
  assert.equal(w.exists('refs/remotes/origin/main'), false);
  assert.equal(w.oid('refs/remotes/up/stream/main'), w.base);
  assert.equal(w.repo.git('symbolic-ref', 'refs/remotes/up/stream/HEAD'), 'refs/remotes/up/stream/main');
  assert.deepEqual(config(w, 'branch.main.remote'), ['up/stream']);
  assert.deepEqual(r.undo.remotes.map((x) => [x.name, x.old?.urls ?? null, x.new?.fetch ?? null]), [['origin', [w.origin.dir], null], ['up/stream', null, [DEFAULT('up/stream')]]]);
});

test('remote.rename refuses a custom refspec, a symbolic tracking ref, an existing or bad new name; nothing renamed', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('fetch', '-q', 'origin');
  await assert.rejects(w.op('remote.rename', { name: 'origin', newName: 'origin' }), refused('REMOTE_EXISTS'));
  w.repo.git('remote', 'add', 'other', '/o.git');
  await assert.rejects(w.op('remote.rename', { name: 'origin', newName: 'other' }), refused('REMOTE_EXISTS'));
  w.repo.git('branch', 'victim');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/alias', 'refs/heads/victim');
  await assert.rejects(w.op('remote.rename', { name: 'origin', newName: 'n' }), refused('SYMBOLIC_REF', { ref: 'refs/remotes/origin/alias', target: 'refs/heads/victim' }));
  w.repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/alias');
  w.repo.git('config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*');
  await assert.rejects(w.op('remote.rename', { name: 'origin', newName: 'n' }), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'origin' }));
  w.repo.git('config', '--unset-all', 'remote.origin.fetch');
  w.repo.git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/elsewhere/*');
  await assert.rejects(w.op('remote.rename', { name: 'origin', newName: 'n' }), refused('REMOTE_CONFIG_UNSUPPORTED'));
  assert.deepEqual(remoteWrites(w), []);
  await assert.rejects(w.op('remote.rename', { name: 'origin', newName: 'a b' }), refused('BAD_REF'));
  assert.equal(w.oid('refs/remotes/origin/main'), w.base);
});

test('remote.remove deletes its tracking refs (kept: one another remote maps) and upstreams; local branches stay; undo restores all of it', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('push', '-q', 'origin', 'main:feat');
  w.repo.git('fetch', '-q', 'origin');
  w.repo.git('remote', 'set-head', 'origin', 'main');
  w.repo.git('config', 'remote.origin.pushurl', '/push.git');
  w.repo.git('branch', '--track', 'feat', 'origin/feat');
  // A second remote whose refspec also maps origin/feat: git keeps that ref.
  w.repo.git('remote', 'add', 'twin', w.origin.dir);
  w.repo.git('config', '--unset-all', 'remote.twin.fetch');
  w.repo.git('config', 'remote.twin.fetch', '+refs/heads/feat:refs/remotes/origin/feat');
  const r = await w.op('remote.remove', { name: 'origin' });
  assert.deepEqual(remoteWrites(w), [['remote', 'remove', '--end-of-options', 'origin']]);
  assert.deepEqual(r.deletedRefs.sort(), ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  assert.equal(w.exists('refs/remotes/origin/feat'), true, 'the ref twin maps stays');
  assert.deepEqual(r.clearedUpstreams, [{ branch: 'main', merge: 'refs/heads/main' }, { branch: 'feat', merge: 'refs/heads/feat' }]);
  assert.deepEqual([config(w, 'branch.main.remote'), config(w, 'branch.feat.merge'), config(w, 'remote.origin.url')], [[], [], []]);
  assert.deepEqual([w.oid('main'), w.oid('feat')], [w.base, w.base], 'local branches stay');
  assert.deepEqual(r.undo.refs.sort((a, b) => a.ref.localeCompare(b.ref)), [
    { ref: 'refs/remotes/origin/HEAD', old: null, new: null, symref: 'refs/remotes/origin/main' },
    { ref: 'refs/remotes/origin/main', old: w.base, new: null },
  ]);
  assert.deepEqual(r.undo.remotes, [{
    name: 'origin', new: null,
    old: { urls: [w.origin.dir], pushUrls: ['/push.git'], fetch: [DEFAULT('origin')], upstreams: [{ branch: 'main', merge: 'refs/heads/main' }, { branch: 'feat', merge: 'refs/heads/feat' }] },
  }]);
});

test('remote.remove refuses a symbolic tracking ref (other than its HEAD alias), a legacy remote and an unknown one; nothing removed', async (t) => {
  const w = await refsWorld(t);
  w.repo.git('fetch', '-q', 'origin');
  w.repo.git('branch', 'victim');
  w.repo.git('symbolic-ref', 'refs/remotes/origin/x', 'refs/heads/victim');
  await assert.rejects(w.op('remote.remove', { name: 'origin' }), refused('SYMBOLIC_REF', { ref: 'refs/remotes/origin/x', target: 'refs/heads/victim' }));
  legacyRemote(w);
  await assert.rejects(w.op('remote.remove', { name: 'leg' }), refused('REMOTE_CONFIG_UNSUPPORTED', { remote: 'leg' }));
  await assert.rejects(w.op('remote.remove', { name: 'nope' }), refused('REMOTE_UNKNOWN'));
  assert.deepEqual(remoteWrites(w), []);
  assert.deepEqual([w.oid('victim'), config(w, 'remote.origin.url')], [w.base, [w.origin.dir]]);
});

test('every user-named remote argument follows --end-of-options', async (t) => {
  const w = await refsWorld(t);
  await w.op('remote.add', { name: 'n1', url: '/n1.git', pushUrl: '/p.git' });
  await w.op('remote.edit', { name: 'n1', url: '/n2.git', pushUrl: '/p2.git' });
  await w.op('remote.rename', { name: 'n1', newName: 'n3' });
  await w.op('remote.remove', { name: 'n3' });
  const writes = remoteWrites(w).filter((a) => a[0] === 'remote');
  assert.equal(writes.length, 6);
  for (const a of writes) endOfOptionsBefore(a, a.at(-1));
});
