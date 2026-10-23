import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CC_EXEC_CAPS } from '../src/conductor/exec.js';
import { SUBMODULE_LIMITS } from '../src/git/submodule/limits.js';

test('SUBMODULE_LIMITS within CC_EXEC_CAPS: the clone timeout and byte caps are positive integers cc accepts', () => {
  const { cloneTimeoutMs, cloneMaxOutputBytes, maxDepth, maxListed, probeConcurrency } = SUBMODULE_LIMITS;
  assert.ok(Number.isInteger(cloneTimeoutMs) && cloneTimeoutMs > 0 && cloneTimeoutMs <= CC_EXEC_CAPS.EXEC_MAX_TIMEOUT_MS);
  assert.ok(Number.isInteger(cloneMaxOutputBytes) && cloneMaxOutputBytes > 0 && cloneMaxOutputBytes <= CC_EXEC_CAPS.EXEC_MAX_OUTPUT_BYTES);
  for (const n of [maxDepth, maxListed, probeConcurrency]) assert.ok(Number.isInteger(n) && n > 0);
});
