import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CC_EXEC_CAPS } from '../src/conductor/exec.js';
import { HISTORY_LIMITS } from '../src/git/history/limits.js';
import { LIMITS } from '../src/git/limits.js';

// Invariant: every HISTORY_LIMITS byte cap is a positive integer within cc's exec output cap and the read default.
test('every HISTORY_LIMITS byte cap is a positive integer within cc exec output cap', () => {
  const caps = Object.entries(HISTORY_LIMITS).filter(([k]) => k.endsWith('Bytes'));
  assert.ok(caps.length >= 4);
  for (const [k, v] of caps) assert.ok(Number.isInteger(v) && v > 0 && v <= CC_EXEC_CAPS.EXEC_MAX_OUTPUT_BYTES && v <= LIMITS.read.maxOutputBytes, k);
});

// Invariant: the deepest history.file re-walk of budget-sized records fits its output cap (so the cap is a backstop).
test('followMaxCommits records at their budget fit one re-walk output cap', () => {
  const { followMaxCommits, followRecordBudgetBytes, fileMaxOutputBytes, pageMax } = HISTORY_LIMITS;
  assert.ok((followMaxCommits + 1) * followRecordBudgetBytes <= fileMaxOutputBytes);
  assert.ok(pageMax >= 1 && pageMax <= followMaxCommits);
});
