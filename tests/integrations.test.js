import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startApp } from './_app.js';
import { fakeCc } from './_fakeCc.js';

// GET api/integrations: whether the UI may offer "Review in code-review", read from cc's GET /api/plugins.

const ROW = { id: 'code-review', enabled: true, hasFrontend: true };

async function integrations(t, plugins) {
  const cc = await fakeCc({ plugins });
  t.after(() => cc.close());
  const { call } = await startApp(t);
  return call('GET', '/api/integrations');
}

test('integrations: an enabled code-review with a frontend is offered by its id', async (t) => {
  const res = await integrations(t, [{ id: 'code-git', enabled: true, hasFrontend: true }, ROW]);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { codeReview: { id: 'code-review' } });
});

for (const [name, plugins] of [
  ['disabled', [{ ...ROW, enabled: false }]],
  ['without a frontend', [{ ...ROW, hasFrontend: false }]],
  ['absent', []],
  ['another id only', [{ ...ROW, id: 'code-reviewer' }]],
]) {
  test(`integrations: code-review ${name} is null`, async (t) => {
    const res = await integrations(t, plugins);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { codeReview: null });
  });
}

test('integrations: a cc without GET /api/plugins is unavailable, not "absent"', async (t) => {
  const res = await integrations(t, undefined);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'CONDUCTOR_UNAVAILABLE');
});

test('integrations: without CONDUCTOR_URL the route is unavailable', async (t) => {
  const prev = process.env.CONDUCTOR_URL;
  delete process.env.CONDUCTOR_URL;
  t.after(() => { if (prev !== undefined) process.env.CONDUCTOR_URL = prev; });
  const { call } = await startApp(t);
  const res = await call('GET', '/api/integrations');
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'CONDUCTOR_UNAVAILABLE');
});
