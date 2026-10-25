import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CC_EXEC_CAPS } from '../src/conductor/exec.js';
import { DIFF_LIMITS } from '../src/git/diff/limits.js';
import { LIMITS } from '../src/git/limits.js';

test('every DIFF_LIMITS byte cap is a positive integer within cc exec output cap', () => {
  const caps = Object.entries(DIFF_LIMITS).filter(([k]) => k.endsWith('Bytes'));
  assert.ok(caps.length > 0);
  for (const [k, v] of caps) assert.ok(Number.isInteger(v) && v > 0 && v <= CC_EXEC_CAPS.EXEC_MAX_OUTPUT_BYTES, k);
});

test("the stat-only probe's bound is a positive integer within cc's exec timeout cap and below the read timeout", () => {
  const v = DIFF_LIMITS.probeTimeoutMs;
  assert.ok(Number.isInteger(v) && v > 0 && v <= CC_EXEC_CAPS.EXEC_MAX_TIMEOUT_MS, String(v));
  assert.ok(v < LIMITS.read.timeoutMs, String(v));
});

test("the --no-index content read's bound is a positive integer within cc's exec timeout cap and below the read timeout", () => {
  const v = DIFF_LIMITS.contentReadTimeoutMs;
  assert.ok(Number.isInteger(v) && v > 0 && v <= CC_EXEC_CAPS.EXEC_MAX_TIMEOUT_MS, String(v));
  assert.ok(v < LIMITS.read.timeoutMs, String(v));
});
