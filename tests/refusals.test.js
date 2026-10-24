import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HTTP_STATUS, Refusal } from '../src/refusals.js';

test('the git-flow and LFS refusal codes are 409s, and a Refusal of each renders {error, code, …extra}', () => {
  const codes = ['FLOW_NOT_INITIALIZED', 'FLOW_EXISTS', 'FLOW_CONFLICT', 'FLOW_INCOMPLETE', 'LFS_UNAVAILABLE', 'ATTRIBUTES_UNSUPPORTED'];
  for (const code of codes) {
    assert.equal(HTTP_STATUS[code], 409, code);
    const r = new Refusal(code, 'why', { into: 'develop' });
    assert.equal(r.status, 409, code);
    assert.deepEqual(r.toBody(), { error: 'why', code, into: 'develop' });
  }
});
