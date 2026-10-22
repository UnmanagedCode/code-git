import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CC_EXEC_CAPS } from '../src/conductor/exec.js';
import { STAGE_LIMITS } from '../src/git/stage/limits.js';

const BODY_LIMIT = 1024 * 1024; // express.json's limit in src/app.js

test('every STAGE_LIMITS byte cap is a positive integer within cc exec output cap', () => {
  const caps = Object.entries(STAGE_LIMITS).filter(([k]) => k.endsWith('Bytes'));
  assert.ok(caps.length >= 4);
  for (const [k, v] of caps) assert.ok(Number.isInteger(v) && v > 0 && v <= CC_EXEC_CAPS.EXEC_MAX_OUTPUT_BYTES, k);
});

test('a patch at applyPatchMaxBytes still fits the API body once base64-encoded, with room for the envelope', () => {
  assert.ok(Math.ceil(STAGE_LIMITS.applyPatchMaxBytes / 3) * 4 + 4096 <= BODY_LIMIT);
});

test('the argv chunk stays far below the kernel single-argument and argv limits', () => {
  assert.ok(STAGE_LIMITS.argvChunkBytes >= 4097 && STAGE_LIMITS.argvChunkBytes <= 128 * 1024);
});
