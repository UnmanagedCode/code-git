import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URL_MAX } from '../src/git/remote/url.js';
import { isRelativeUrl, submoduleUrl } from '../src/git/submodule/url.js';
import { refused } from './_refsWorld.js';

// submoduleUrl: relative urls are C9's own; anything else is remoteUrl's (tests/remote-url.test.js).

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
