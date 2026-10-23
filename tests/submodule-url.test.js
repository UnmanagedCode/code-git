import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remoteUrl, URL_MAX } from '../src/git/submodule/copied/url.js';
import { isRelativeUrl, submoduleUrl } from '../src/git/submodule/url.js';
import { refused } from './_refsWorld.js';

// COPY: the two remoteUrl cases below are tests/remote-url.test.js on code-conductor/c6-remotes (C6 Remotes). On
// rebase onto C6: drop them (the original covers remoteUrl) and keep the submoduleUrl cases.

test('remoteUrl accepts every allowlisted shape unchanged', () => {
  for (const url of [
    'https://github.com/o/r.git', 'http://127.0.0.1:8080/r.git', 'HTTPS://h/r', 'https://u:p@h/r.git',
    'ssh://git@h:2222/o/r.git', 'git+ssh://h/r.git', 'ssh+git://h/r.git', 'git://h/r.git', 'file:///srv/r.git',
    '/srv/git/r.git', 'git@github.com:o/r.git', 'h:r.git', 'host.example:path/to/r', '[::1]:r.git', 'u@[fe80::1]:r',
    'x'.repeat(URL_MAX - 5) + ':r.gi',
  ]) assert.equal(remoteUrl(url), url, url);
});

test('remoteUrl refuses (BAD_URL) every <transport>:: helper url, a leading -, whitespace, control characters, over-length and every other shape', () => {
  for (const url of [
    'ext::sh -c touch% /tmp/x', 'ext::sh', 'fd::3', 'file::/srv/r', 'foo::x', 'git+custom::h/r', 'Codecommit::us-east-1://r',
    '-uhelper', '--upload-pack=touch /tmp/x', 'https://h/r .git', 'https://h/r\tx', 'https://h/r\nx', 'https://h/\x7f', 'a\x00b',
    '', ' ', 'relative/path.git', './r.git', '../r.git', 'r.git', 'h:', 'h://r', 'ftp://h/r', 'https://', 'ssh://-oProxyCommand=x/r',
    'ssh://u@-oProxyCommand=x/r', '-h:r', 'u@-oProxy:r', 'h://evil', 'x'.repeat(URL_MAX - 4) + ':r.git', 42, null, undefined, ['https://h/r'],
  ]) assert.throws(() => remoteUrl(url), refused('BAD_URL'), JSON.stringify(url));
});

test("relative ./ and ../ accepted; a relative one with :: or whitespace or a backslash refused; -x refused", () => {
  for (const url of ['./r.git', '../r.git', '../../group/r', '../a:b/r', './x'.padEnd(URL_MAX, 'x')]) assert.equal(submoduleUrl(url), url, url);
  for (const url of ['../ext::sh', './x::y', './a b', '../a\tb', '../a\nb', '../\x7f', '..\\x', '../a\\b', './'.padEnd(URL_MAX + 1, 'x'),
    '-x', '--upload-pack=x', '..', '.', 'r.git', 'ext::sh -c x', '', null, 3]) {
    assert.throws(() => submoduleUrl(url), refused('BAD_URL'), JSON.stringify(url));
  }
  // Anything not relative is remoteUrl's.
  assert.equal(submoduleUrl('https://h/r.git'), 'https://h/r.git');
  assert.equal(isRelativeUrl('../x'), true);
  assert.equal(isRelativeUrl('..x'), false);
});
