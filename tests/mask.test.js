import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capStderr, createActivityLog, redactArgv } from '../src/activity/log.js';
import { BASE_ARGS } from '../src/git/runner.js';
import { Refusal } from '../src/refusals.js';
import { isMaskedUrl, maskDeep, maskUrl, maskUrls } from '../src/mask.js';
import { refsWorld } from './_refsWorld.js';
import { startApp } from './_app.js';

// One masking function for every place a url with a password could be shown: remote.list's display urls and the
// activity log's argv (and so /api/activity, its SSE events and the Activity panel).

test('maskUrl hides everything from the userinfo\'s first : to the authority\'s last @, whatever the password holds', () => {
  assert.equal(maskUrl('https://user:secret@host/r.git'), 'https://user:***@host/r.git');
  assert.equal(maskUrl('https://user:sec/ret@host/r'), 'https://user:***@host/r');
  assert.equal(maskUrl('https://user:p@ss@host/r'), 'https://user:***@host/r');
  assert.equal(maskUrl('https://user:a/b@c@host:8443/r'), 'https://user:***@host:8443/r');
  assert.equal(maskUrl('https://:tok@host/r'), 'https://:***@host/r');
  assert.equal(maskUrl('ssh://u:pw@h:22/r'), 'ssh://u:***@h:22/r');
});

// Invariant: git hands any `<scheme>://` to git-remote-<scheme>, so a scheme starting with a digit is a url too:
// maskUrl, maskUrls and redactArgv mask its password.
test('a scheme starting with a digit: maskUrl, maskUrls and redactArgv mask its password', () => {
  assert.equal(maskUrl('1password://u:pw@h/r'), '1password://u:***@h/r');
  assert.equal(maskUrl('9z://u:pw@h/r'), '9z://u:***@h/r');
  assert.equal(maskUrls("fatal: unable to access '1password://u:pw@h/r/' and 9z://u:pw2@h/r"), "fatal: unable to access '1password://u:***@h/r/' and 9z://u:***@h/r");
  assert.deepEqual(redactArgv(['git', 'config', '--add', 'remote.o.url', '1password://u:pw@h/r']), ['git', 'config', '--add', 'remote.o.url', '1password://u:***@h/r']);
});

// Invariant: a url embedded in a value (`<transport>::<url>`, a value git stores though remote.add refuses it) is masked
// as a url alone is, isMaskedUrl agrees with what maskUrl produces for it, and redactArgv masks it as an argument.
test('a <transport>::<url> value: maskUrl masks the url after ::, isMaskedUrl agrees, redactArgv masks it', () => {
  assert.equal(maskUrl('foo::https://u:pw@h/r'), 'foo::https://u:***@h/r');
  assert.equal(maskUrl('ext::https://u:p@ss@h/r'), 'ext::https://u:***@h/r');
  assert.equal(maskUrl('1foo::9z://u:pw@h/r'), '1foo::9z://u:***@h/r');
  assert.equal(maskUrl('foo::https://h/r'), 'foo::https://h/r');
  assert.equal(isMaskedUrl('foo::https://u:***@h/r'), true);
  assert.equal(isMaskedUrl('foo::https://u:pw@h/r'), false);
  assert.equal(isMaskedUrl(maskUrl('foo::https://u:pw@h/r')), true);
  assert.deepEqual(redactArgv(['git', 'config', '--add', 'remote.o.url', 'foo::https://u:pw@h/r']), ['git', 'config', '--add', 'remote.o.url', 'foo::https://u:***@h/r']);
});

// Invariant: a scheme of digits only is a scheme: its url's password is masked in a value and in a text.
test('a scheme of digits only (123://) is masked by maskUrl and maskUrls', () => {
  assert.equal(maskUrl('123://u:pw@h/r'), '123://u:***@h/r');
  assert.equal(maskUrls("fatal: unable to access '123://u:pw@h/r/'"), "fatal: unable to access '123://u:***@h/r/'");
  assert.equal(isMaskedUrl('123://u:***@h/r'), true);
});

// Invariant: in a text, a `://` starts a url only at a url boundary (the text's start, whitespace, a quote, ( [ < , = or a
// `<transport>::`): one inside a password (`https://u:pw://x@h`) is part of it, so the password is masked whole, as maskUrl
// masks the same value.
test('maskUrls: a :// inside a password is not a new url; maskUrl and maskUrls agree on it', () => {
  const url = 'https://u:pw://x@h.example.invalid/r';
  assert.equal(maskUrl(url), 'https://u:***@h.example.invalid/r');
  assert.equal(maskUrls(`fatal: unable to access '${url}/': URL rejected`), "fatal: unable to access 'https://u:***@h.example.invalid/r/': URL rejected");
  for (const [text, masked] of [
    ['(https://u:pw@h/r)', '(https://u:***@h/r)'], ['[https://u:pw@h/r]', '[https://u:***@h/r]'], ['<https://u:pw@h/r>', '<https://u:***@h/r>'],
    ['a,https://u:pw@h/r', 'a,https://u:***@h/r'], ['--url=https://u:pw@h/r', '--url=https://u:***@h/r'], ['"https://u:pw@h/r"', '"https://u:***@h/r"'],
    ['foo::https://u:pw@h/r', 'foo::https://u:***@h/r'], ["'ext::https://u:pw@h/r'", "'ext::https://u:***@h/r'"],
  ]) assert.equal(maskUrls(text), masked, text);
});

// Invariant: a text password span never crosses another scheme://: a credential-less url followed by a credentialed
// one on the same line keeps its own text, and the second url keeps its scheme and user name.
test('maskUrls: a password span never crosses into the next url', () => {
  assert.equal(maskUrls('https://a:p https://b:x@h/r failed'), 'https://a:p https://b:***@h/r failed');
  assert.equal(maskUrls('https://a:p q 9z://b:x@h/r'), 'https://a:p q 9z://b:***@h/r');
});

test('maskUrl leaves urls without a password alone', () => {
  for (const u of ['https://host/r.git', 'https://user@host/r', 'ssh://git@host:22/r.git', 'git@host:o/r.git', '/srv/r.git', 'file:///srv/r', 'origin', '--end-of-options']) {
    assert.equal(maskUrl(u), u, u);
  }
});

// Invariant: isMaskedUrl holds exactly for a url maskUrl leaves unchanged that has a password span, i.e. one whose
// password is the mask `***` itself; a raw password, none at all, or a password merely starting with *** is not masked.
test('isMaskedUrl: true only when the password span is exactly *** (what maskUrl shows)', () => {
  for (const u of ['https://u:***@h/r', 'https://a@b:***@h/r', 'https://:***@h/r', 'ssh://u:***@h:22/r']) assert.equal(isMaskedUrl(u), true, u);
  for (const u of ['https://u:pw@h/r', 'https://u@h/r', 'https://h/r', 'git@h:o/r.git', 'u:***@h:r', '/srv/r.git', 'https://u:***x@h/r', 'https://u:x***@h/r']) {
    assert.equal(isMaskedUrl(u), false, u);
  }
});

test('redactArgv masks a url password in any argument; the activity entry, its events and list() never hold it', () => {
  assert.deepEqual(redactArgv(['git', 'remote', 'add', '--end-of-options', 'o', 'https://u:tok@h/r', 'x']), ['git', 'remote', 'add', '--end-of-options', 'o', 'https://u:***@h/r', 'x']);
  const log = createActivityLog();
  const events = [];
  log.events.on('activity', (e) => events.push(e));
  const { entry } = log.open({ opRunId: 'r', op: 'remote.add', kind: 'write', target: { project: 'p' }, argv: ['git', 'remote', 'set-url', 'o', 'https://u:sec/ret@h/r'], cancellable: false });
  log.close(entry, { status: 'ok', exitCode: 0 });
  for (const e of [...events, ...log.list()]) assert.equal(e.argv.at(-1), 'https://u:***@h/r');
  assert.ok(!JSON.stringify([events, log.list()]).includes('sec/ret'));
});

// Invariant: an argument of a command whose arguments are names, urls and values (remote, submodule, config, the network
// commands) is masked as a stored value (maskUrl: even a password starting with a space); every other argument (a commit
// message) through the text masker: free text keeps its shape, each credentialed url in it masked on its own.
test('redactArgv: url and config value arguments masked whole; free text keeps its shape', () => {
  const git = (...args) => ['git', ...BASE_ARGS, ...args];
  assert.deepEqual(redactArgv(git('remote', 'add', '--end-of-options', 'o', 'https://u: pw@h/r')), git('remote', 'add', '--end-of-options', 'o', 'https://u:***@h/r'));
  assert.deepEqual(redactArgv(git('remote', 'set-url', '--push', '--end-of-options', 'o', 'https://u: pw@h/r')), git('remote', 'set-url', '--push', '--end-of-options', 'o', 'https://u:***@h/r'));
  assert.deepEqual(redactArgv(git('config', '--add', 'remote.o.url', 'https://u: pw@h/r')), git('config', '--add', 'remote.o.url', 'https://u:***@h/r'));
  assert.deepEqual(redactArgv(git('submodule', 'add', '--', 'https://u: pw@h/r', 'x')), git('submodule', 'add', '--', 'https://u:***@h/r', 'x'));
  const message = '--message=wip for https://github.com/o/r/pull/1: ping @alice';
  assert.deepEqual(redactArgv(git('commit', message)), git('commit', message));
  assert.deepEqual(redactArgv(git('commit', '-m', 'see https://u:pw@h/r and https://v:pw2@h2/r')), git('commit', '-m', 'see https://u:***@h/r and https://v:***@h2/r'));
});

// Invariant: the value of a `git config` write to a remote's key other than url / pushurl / fetch (an `extra` key: a
// proxy, a pack command) is never recorded — replaced by *** with the key kept, whatever its form (a scheme-less
// user:password@host proxy included); url and pushurl keep maskUrl, fetch and everything else is recorded as given; the
// entry's events never hold it either.
test('redactArgv withholds the value of a config write to a remote extra key; url keys keep maskUrl', () => {
  const git = (...args) => ['git', ...BASE_ARGS, ...args];
  const proxy = 'proxyuser:Pr0xyPW@proxy.invalid:8080';
  assert.deepEqual(redactArgv(git('config', '--add', 'remote.o.proxy', proxy)), git('config', '--add', 'remote.o.proxy', '***'));
  assert.deepEqual(redactArgv(git('config', '--replace-all', 'remote.a.b.receivepack', 'git-receive-pack --secret')), git('config', '--replace-all', 'remote.a.b.receivepack', '***'));
  assert.deepEqual(redactArgv(['git', ...BASE_ARGS, '-C', 'sub', '--git-dir=.git', 'config', '--add', 'remote.o.uploadpack', 'x']), ['git', ...BASE_ARGS, '-C', 'sub', '--git-dir=.git', 'config', '--add', 'remote.o.uploadpack', '***']);
  assert.deepEqual(redactArgv(git('config', '--add', 'remote.o.url', 'https://u:tok@h/r')), git('config', '--add', 'remote.o.url', 'https://u:***@h/r'));
  assert.deepEqual(redactArgv(git('config', '--add', 'remote.o.pushurl', 'https://u:tok@h/r')), git('config', '--add', 'remote.o.pushurl', 'https://u:***@h/r'));
  for (const kept of [
    git('config', '--add', 'remote.o.fetch', '+refs/heads/*:refs/remotes/o/*'),
    git('config', '--add', 'remote.pushDefault', 'o'),
    git('config', '--add', 'branch.main.merge', 'refs/heads/main'),
    git('config', '--unset-all', 'remote.o.proxy'),
    git('config', '-z', '--get-regexp', '^remote\\.'),
    ['git', ...BASE_ARGS, '-C', 'config', '--git-dir=.git', 'status', 'remote.o.proxy', 'x'],
  ]) assert.deepEqual(redactArgv(kept), kept, kept.join(' '));
  const log = createActivityLog();
  const events = [];
  log.events.on('activity', (e) => events.push(e));
  const { entry } = log.open({ opRunId: 'r', op: 'undo.undo', kind: 'write', target: { project: 'p' }, argv: git('config', '--add', 'remote.o.proxy', proxy), cancellable: false });
  log.close(entry, { status: 'ok', exitCode: 0 });
  assert.ok(!JSON.stringify([events, log.list()]).includes('Pr0xyPW'));
});

// Invariant: the key of a `git config` write is found past the separate values of config's value-taking options
// (`--file` / `-f <path>`, `--blob`, `--type` / `-t`, `--default`, `--comment`), so a remote extra key's value is withheld
// there too; the option values themselves are recorded as given.
test('redactArgv finds the config key past value-taking options', () => {
  const git = (...args) => ['git', ...BASE_ARGS, ...args];
  for (const opts of [['--file', 'cfg'], ['-f', 'cfg'], ['--blob', 'HEAD:cfg'], ['--type', 'bool'], ['-t', 'bool'], ['--default', 'x'], ['--comment', 'why'], ['-f', 'cfg', '--type', 'path']]) {
    assert.deepEqual(redactArgv(git('config', ...opts, 'remote.o.proxy', 'u:pw@h')), git('config', ...opts, 'remote.o.proxy', '***'), opts.join(' '));
  }
  const listed = git('config', '-f', '.gitmodules', '-z', '--get-regexp', '^submodule\\.');
  assert.deepEqual(redactArgv(listed), listed);
});

test('end to end: remote.add with a credential url writes it to git config but /api/activity shows it masked', async (t) => {
  const w = await refsWorld(t);
  const app = await startApp(t);
  const r = await app.call('POST', '/api/ops/remote.add', { target: { project: 'repo' }, params: { name: 'up', url: 'https://me:p@ss/word@h.example/r.git' } });
  assert.equal(r.status, 200);
  assert.equal(w.repo.git('config', 'remote.up.url'), 'https://me:p@ss/word@h.example/r.git');
  const body = JSON.stringify((await app.call('GET', '/api/activity')).body);
  assert.ok(body.includes('https://me:***@h.example/r.git'));
  assert.ok(!body.includes('ss/word'), 'the password never reaches the activity API');
  const listed = (await app.call('POST', '/api/ops/remote.list', { target: { project: 'repo' } })).body.result.remotes.find((x) => x.name === 'up');
  assert.equal(listed.displayUrl, 'https://me:***@h.example/r.git');
});

test('maskUrls masks every credentialed url inside a text and leaves the rest', () => {
  const text = "Cloning into 'x'...\nfatal: clone of 'https://u:p@ss@host/r.git' into submodule path 'x' failed\nsee ssh://git:k3y@h:22/r and http://plain/h@x";
  assert.equal(maskUrls(text), "Cloning into 'x'...\nfatal: clone of 'https://u:***@host/r.git' into submodule path 'x' failed\nsee ssh://git:***@h:22/r and http://plain/h@x");
  assert.equal(maskUrls('no urls here'), 'no urls here');
});

test("maskUrls: a password holding ' or \" is masked whole (quotes do not end it)", () => {
  assert.equal(maskUrls("fatal: clone of 'https://u:pa'ss@host/r.git' into submodule path"), "fatal: clone of 'https://u:***@host/r.git' into submodule path");
  assert.equal(maskUrls('Submodule \'c\' (http://u:pa"ss@h/r.git) registered'), "Submodule 'c' (http://u:***@h/r.git) registered");
});

// Invariant: within a line, a password holding whitespace is masked whole, up to the @ that ends its url's authority;
// a second url on the line, a password-less url (a port, a quote then a colon) and trailing user@host text are left as
// they are, and a mask never spans two lines.
test('maskUrls: a password holding a space is masked within its line; a second url and trailing user@host text are kept', () => {
  assert.equal(maskUrls("fatal: unable to access 'https://user:S3 CRET@h/r/': 403"), "fatal: unable to access 'https://user:***@h/r/': 403");
  assert.equal(maskUrls('fetch https://a:p 1@h1/r and https://b:p2@h2/r failed'), 'fetch https://a:***@h1/r and https://b:***@h2/r failed');
  assert.equal(maskUrls("'https://u:pw x@h/r' rejected for git@example.com"), "'https://u:***@h/r' rejected for git@example.com");
  assert.equal(maskUrls("'https://u:pw@h/r' rejected for git@example.com"), "'https://u:***@h/r' rejected for git@example.com");
  assert.equal(maskUrls('https://h:8443/r and https://b:p2@h2/r'), 'https://h:8443/r and https://b:***@h2/r');
  for (const kept of [
    'https://h:8443/r failed for git@host',
    "fatal: unable to access 'https://h/r/': denied to me@corp.example",
    'https://u:p\nwrong@h',
  ]) assert.equal(maskUrls(kept), kept, kept);
});

// Invariant: a whitespace-bearing password ends at the @ that ends the url's authority (a host-like run, then / : ? #
// a quote or a closing bracket) — not at an @ inside the password, and not cut short by digits a space follows (only
// digits then / ? # a quote, a closing bracket or the line's end read as a port); the over-mask guards still hold.
test('maskUrls: a spaced password holding digits first or an @ is masked whole, up to the @ that ends the authority', () => {
  assert.equal(maskUrls('https://user:1234 5678@h/r/'), 'https://user:***@h/r/');
  assert.equal(maskUrls("fatal: unable to access 'https://user:1234 5678@h/r/': 403"), "fatal: unable to access 'https://user:***@h/r/': 403");
  assert.equal(maskUrls('https://user:p@ss word@h/r'), 'https://user:***@h/r');
  assert.equal(maskUrls("fatal: clone of 'https://user:p@ss word@h/r' into submodule path 'x' failed"), "fatal: clone of 'https://user:***@h/r' into submodule path 'x' failed");
  assert.equal(maskUrls('https://user:p@ss word@h:8443/r and https://b:p2@h2/r'), 'https://user:***@h:8443/r and https://b:***@h2/r');
  for (const kept of [
    'https://h:8443/r failed for git@host',
    "fatal: unable to access 'https://h:8443': denied to me@corp.example/x",
    "Submodule 'x' (https://h:8443) registered for git@host/x",
  ]) assert.equal(maskUrls(kept), kept, kept);
  assert.equal(maskUrls("'https://u:pw x@h/r' rejected for git@example.com"), "'https://u:***@h/r' rejected for git@example.com");
});

// Invariant: the stderr the activity log keeps (capStderr) and a refusal's body (toBody) mask a password holding a space.
test('a password holding a space or a :// never reaches capStderr or a refusal body', () => {
  for (const [line, masked] of [
    ["fatal: unable to access 'https://user:S3 CRET@h/r/': The requested URL returned error: 403\n", "fatal: unable to access 'https://user:***@h/r/': The requested URL returned error: 403\n"],
    ["fatal: unable to access 'https://u:pw://x@h.example.invalid/r/': URL rejected: Port number was not a decimal number between 0 and 65535\n",
      "fatal: unable to access 'https://u:***@h.example.invalid/r/': URL rejected: Port number was not a decimal number between 0 and 65535\n"],
  ]) {
    assert.equal(capStderr(Buffer.from(line)).stderr, masked);
    const body = new Refusal('GIT_FAILED', `git failed: ${line}`, { stderr: line }).toBody();
    assert.deepEqual([body.error, body.stderr], [`git failed: ${masked}`, masked]);
  }
});

test('a user name holding @: maskUrl, maskUrls and redactArgv take the first : after scheme:// and the last @', () => {
  const url = 'https://a@b:c0ntr4@host/r.git';
  assert.equal(maskUrl(url), 'https://a@b:***@host/r.git');
  assert.equal(maskUrls(`fatal: clone of '${url}' into submodule path 'x'`), "fatal: clone of 'https://a@b:***@host/r.git' into submodule path 'x'");
  assert.deepEqual(redactArgv(['git', 'submodule', 'add', '--', url, 'x']), ['git', 'submodule', 'add', '--', 'https://a@b:***@host/r.git', 'x']);
  // No password: unchanged (a port colon with no @ after it is not one).
  for (const plain of ['https://a@host:8080/r.git', 'https://host/r.git', 'git@host:o/r.git']) assert.equal(maskUrl(plain), plain);
});

test('maskDeep masks every string through arrays and plain objects, and leaves other values', () => {
  const u = 'https://u:pw1@h/r';
  assert.deepEqual(maskDeep({ error: `refs ${u}`, names: [u, 'origin'], n: 3, nested: { stderr: u }, ok: true, none: null }),
    { error: 'refs https://u:***@h/r', names: ['https://u:***@h/r', 'origin'], n: 3, nested: { stderr: 'https://u:***@h/r' }, ok: true, none: null });
});

/** Hostile inputs of about 200k characters: long alphanumeric runs, many `://`, `@` and `:`, many urls on one line. */
const HOSTILE = {
  'a run': 'a'.repeat(200_000),
  'a run then ://': `${'a'.repeat(200_000)}://`,
  'a run then ://u:': `${'a'.repeat(200_000)}://u:`,
  'many ://': 'a://'.repeat(50_000),
  'many :': 'a:'.repeat(100_000),
  'many @': '@'.repeat(200_000),
  'a password of @s': `https://u:${'a@'.repeat(100_000)}`,
  'a spaced password then @s': `https://u:p ${'x@'.repeat(100_000)}`,
  'a spaced password then user@host words': `https://u:p ${'x@h '.repeat(50_000)}`,
  'many credential-less urls': 'a://b:c '.repeat(25_000),
  'many digit urls': '1://:@'.repeat(33_000),
  'many spaced passwords': `${'https://u:p '.repeat(16_000)}@h/r`,
};

// Invariant: masking runs in linear time: each masking function finishes every hostile ~200k-character input (a
// remote helper's or ssh server's stderr, a url posted to remote.edit) well under 200 ms.
test('maskUrl, isMaskedUrl, maskUrls, maskDeep and redactArgv stay fast on hostile 200k-character input', () => {
  const fns = {
    maskUrl, isMaskedUrl, maskUrls, maskDeep: (x) => maskDeep({ stderr: x }),
    redactArgv: (x) => redactArgv(['git', 'commit', '-m', x, 'remote', x]),
    redactArgvUrl: (x) => redactArgv(['git', 'remote', 'add', '--end-of-options', 'o', x]),
  };
  for (const [what, input] of Object.entries(HOSTILE)) {
    for (const [name, fn] of Object.entries(fns)) {
      const t0 = performance.now();
      fn(input);
      const ms = performance.now() - t0;
      assert.ok(ms < 200, `${name} on ${what}: ${ms.toFixed(1)} ms`);
    }
  }
});
