import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { checkPattern, LFS_LIMITS } from '../src/git/lfs/limits.js';
import { parseLfsAttributes, parseLfsVersion, parseLsFilesJson } from '../src/git/lfs/parse.js';
import { refused } from './_ops.js';

const fixture = (name) => fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url));
const EXPECTED_FILES = [
  { path: 'a.bin', size: 4, oid: '2c8b08da5ce60398e1f19af0e5dccc744df274b826abe585eaba68c525434806', downloaded: true },
  { path: 'assets/b.psd', size: 8, oid: '89eaf5ec9a1b0935bcd304dbd8c7872c789736c7036ad40a492668ba11360bef', downloaded: false },
];

test('parseLsFilesJson reads name, size, oid and downloaded from git-lfs 3.3.0 (the floor met) and 3.6.1 output', () => {
  assert.deepEqual(parseLsFilesJson(fixture('lfs-3.3.0-ls-files.json')), EXPECTED_FILES);
  assert.deepEqual(parseLsFilesJson(fixture('lfs-3.6.1-ls-files.json')), EXPECTED_FILES);
});

test('parseLsFilesJson: `files: null` (no LFS files) is an empty list; a missing field reads as null; malformed output is GIT_FAILED, never a guess', () => {
  assert.deepEqual(parseLsFilesJson(Buffer.from('{\n "files": null\n}\n')), []);
  assert.deepEqual(parseLsFilesJson(Buffer.from('{"files":[{"name":"x.bin"}]}')), [{ path: 'x.bin', size: null, oid: null, downloaded: null }]);
  for (const bad of ['{', '[]', '{"files": {}}', '{"files": [{"size": 1}]}', '{"files": [{"name": "a", "size": "4"}]}', '{"files": [{"name": "a", "downloaded": "yes"}]}', '']) {
    assert.throws(() => parseLsFilesJson(Buffer.from(bad)), refused('GIT_FAILED'), bad);
  }
});

test('parseLfsVersion: the first line `git-lfs/x.y.z`; 3.2.0 and later are supported, earlier not; anything else is GIT_FAILED', () => {
  assert.deepEqual(parseLfsVersion('git-lfs/3.3.0 (GitHub; linux amd64; go 1.19.8)\n'), { version: '3.3.0', supported: true });
  assert.deepEqual(parseLfsVersion('git-lfs/3.2.0 (GitHub)\n'), { version: '3.2.0', supported: true });
  assert.deepEqual(parseLfsVersion('git-lfs/4.0.1\n'), { version: '4.0.1', supported: true });
  assert.deepEqual(parseLfsVersion('git-lfs/3.1.4 (GitHub)\n'), { version: '3.1.4', supported: false });
  assert.deepEqual(parseLfsVersion('git-lfs/2.13.3\n'), { version: '2.13.3', supported: false });
  for (const bad of ['', 'git version 2.39.5\n', 'git-lfs/3\n', 'x git-lfs/3.3.0\n']) {
    assert.throws(() => parseLfsVersion(bad), refused('GIT_FAILED'), bad);
  }
});

test('parseLfsAttributes lists a pattern only when its line ends up with filter=lfs; comments, blanks, macros and negative patterns are skipped', () => {
  const text = [
    '# *.no filter=lfs',
    '   # indented comment',
    '',
    '*.bin filter=lfs diff=lfs merge=lfs -text',
    '*.txt text',
    '\t*.tab\tfilter=lfs',
    '*.iso filter=lfs -filter',
    '*.zip -filter filter=lfs',
    '*.raw !filter filter=lfs',
    '*.near filter=lfsx',
    '*.unset filter',
    '[attr]lfsmacro filter=lfs',
    '!neg filter=lfs',
    '*.crlf filter=lfs\r',
    '<b>x</b> filter=lfs',
    'no-newline-at-end filter=lfs',
  ].join('\n');
  assert.deepEqual(parseLfsAttributes(Buffer.from(text, 'latin1')), [
    '*.bin', '*.tab', '*.zip', '*.raw', '*.crlf', '<b>x</b>', 'no-newline-at-end',
  ]);
});

test('parseLfsAttributes: the last filter token decides, `!filter` (unspecified) included; CR separates a pattern from its attributes, not only at a line end', () => {
  const text = ['*.x filter=lfs !filter', '*.y filter=lfs -filter', '*.z !filter filter=lfs', '*.bin\rfilter=lfs', '*.tab\t\rfilter=lfs\r'].join('\n');
  assert.deepEqual(parseLfsAttributes(Buffer.from(text, 'latin1')), ['*.z', '*.bin', '*.tab']);
});

test("parseLfsAttributes: a quoted pattern is C-unquoted as data (escapes, octal UTF-8 bytes, spaces); a quote git cannot unquote is a literal token, as git's attr parser reads it", () => {
  const lines = [
    '"with space.psd" filter=lfs',
    '"say \\"hi\\" \\\\ now" filter=lfs',
    '"caf\\303\\251.bin" filter=lfs',
    '"tab\\there" filter=lfs',
    '"unterminated filter=lfs',
    '"bad\\q" filter=lfs',
    '"glued"filter=lfs',
    '"quoted.no" text',
  ];
  assert.deepEqual(parseLfsAttributes(Buffer.from(`${lines.join('\n')}\n`, 'latin1')), [
    'with space.psd', 'say "hi" \\ now', 'café.bin', 'tab\there', '"unterminated', '"bad\\q"', 'glued',
  ]);
  assert.deepEqual(parseLfsAttributes(Buffer.from('café.bin filter=lfs\n', 'utf8')), ['café.bin'], 'UTF-8 bytes decode');
  assert.deepEqual(parseLfsAttributes(Buffer.alloc(0)), []);
});

test('checkPattern: 1…patternMaxLength characters; no control character; no leading -, #, ! or "; no whitespace at either end', () => {
  for (const ok of ['*.bin', 'assets/*.psd', 'a b.bin', 'x'.repeat(LFS_LIMITS.patternMaxLength), 'mid-#!"']) assert.equal(checkPattern(ok), ok);
  for (const bad of ['', '-x', '#x', '!x', '"x', ' x', 'x ', 'a\tb', 'a\nb', 'a\u007fb', 'x'.repeat(LFS_LIMITS.patternMaxLength + 1), 42, null]) {
    assert.throws(() => checkPattern(bad), refused('BAD_PARAMS'), JSON.stringify(bad));
  }
});
