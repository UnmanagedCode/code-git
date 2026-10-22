import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CC_EXEC_CAPS } from '../src/conductor/exec.js';
import { DIFF_LIMITS } from '../src/git/diff/limits.js';

test('every DIFF_LIMITS byte cap is a positive integer within cc exec output cap', () => {
  const caps = Object.entries(DIFF_LIMITS).filter(([k]) => k.endsWith('Bytes'));
  assert.ok(caps.length > 0);
  for (const [k, v] of caps) assert.ok(Number.isInteger(v) && v > 0 && v <= CC_EXEC_CAPS.EXEC_MAX_OUTPUT_BYTES, k);
});
