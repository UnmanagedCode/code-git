import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newRemoteName, remoteUrl, URL_MAX } from '../src/git/remote/url.js';
import { refused } from './_refsWorld.js';

test('remoteUrl accepts every allowlisted shape unchanged', () => {
  for (const url of [
    'https://github.com/o/r.git', 'http://127.0.0.1:8080/r.git', 'HTTPS://h/r', 'https://u:p@h/r.git',
    'ssh://git@h:2222/o/r.git', 'git+ssh://h/r.git', 'ssh+git://h/r.git', 'git://h/r.git', 'file:///srv/r.git',
    '/srv/git/r.git', 'git@github.com:o/r.git', 'h:r.git', 'host.example:path/to/r', '[::1]:r.git', 'u@[fe80::1]:r',
    'x'.repeat(URL_MAX - 5) + ':r.gi',
    // A leading `_` is not a helper name: git reads `_x::y` as scp-like host `_x`, path `:y`.
    '_x::y',
  ]) assert.equal(remoteUrl(url), url, url);
});

test('remoteUrl refuses (BAD_URL) every <transport>:: helper url, a leading -, whitespace, control characters, over-length and every other shape', () => {
  for (const url of [
    'ext::sh -c touch% /tmp/x', 'ext::sh', 'fd::3', 'file::/srv/r', 'foo::x', 'git+custom::h/r', 'Codecommit::us-east-1://r',
    // git 2.55 runs git-remote-<name> for a digit-led name too (`1foo::x` → git-remote-1foo).
    '1foo::x', '1::x', '12ab::x', '9.git::h',
    '-uhelper', '--upload-pack=touch /tmp/x', 'https://h/r .git', 'https://h/r\tx', 'https://h/r\nx', 'https://h/\x7f', 'a\x00b',
    '', ' ', 'relative/path.git', './r.git', '../r.git', 'r.git', 'h:', 'h://r', 'ftp://h/r', 'https://', 'ssh://-oProxyCommand=x/r',
    'ssh://u@-oProxyCommand=x/r', '-h:r', 'u@-oProxy:r', 'h://evil', 'x'.repeat(URL_MAX - 4) + ':r.git', 42, null, undefined, ['https://h/r'],
  ]) assert.throws(() => remoteUrl(url), refused('BAD_URL'), JSON.stringify(url));
});

// Invariant: a git:// url carrying userinfo (a user, a password or both, any case of the scheme) is refused BAD_URL —
// the git protocol cannot authenticate, and git prints the userinfo back in its errors — without echoing the url; a
// git:// url without userinfo, and userinfo in any other scheme, are accepted as before.
test('remoteUrl refuses (BAD_URL) userinfo in a git:// url, never echoing it', () => {
  for (const url of ['git://u:Zq7pw@h.example/r', 'git://u@h.example/r', 'GIT://u:Zq7pw@h/r', 'git://:Zq7pw@h:9418/r', 'git://u:Zq7pw@127.0.0.1/r', 'git://u:Zq7pw%40h.example/r', 'git://u%3AZq7pw%40h.example/r', 'git://u%40h.example/r']) {
    assert.throws(() => remoteUrl(url), (e) => e.code === 'BAD_URL' && !e.message.includes('Zq7pw') && !e.message.includes('h.example'), url);
  }
  for (const url of ['git://h/r.git', 'git://h:9418/r', 'git://h/a@b.git', 'git://h/a%40b.git', 'https://u:Zq7pw@h/r', 'ssh://u:Zq7pw@h/r', 'u@h:r.git']) assert.equal(remoteUrl(url), url, url);
});

test('newRemoteName: git\'s refs/remotes/<name>/… rule; a bad name is BAD_REF, never REMOTE_UNKNOWN', () => {
  for (const name of ['origin', 'up-stream', 'a/b', 'team.mirror', 'HEAD2', 'x_y']) assert.equal(newRemoteName(name), name);
  for (const name of ['', '-x', '--upload-pack=x', 'a b', 'a\tb', 'a\nb', '.hidden', 'a..b', 'a/', '/a', 'a//b', 'a.lock', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', '@', 'a@{x', 'x'.repeat(201), 7, null]) {
    assert.throws(() => newRemoteName(name), refused('BAD_REF'), JSON.stringify(name));
  }
});

test('newRemoteName refuses `=` (BAD_REF): `-c remote.<name>.mirror=false` would split there and pin nothing', () => {
  for (const name of ['a=b', '=x', 'x=', 'team/a=b', 'a==b']) assert.throws(() => newRemoteName(name), refused('BAD_REF'), name);
});
