import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startApp } from './_app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'conductor.plugin.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// The key sets cc's validator accepts (cc's src/plugins/manifest.ts: KNOWN_TOP_KEYS, backend and frontend checks).
const TOP = ['id', 'name', 'version', 'pluginApi', 'backend', 'frontend', 'mcp', 'conventions', 'roles', 'playbooks', 'claudePlugin'];

test('the manifest uses only keys cc accepts, and is a UI-only plugin (no MCP tools)', () => {
  for (const k of Object.keys(manifest)) assert.ok(TOP.includes(k), k);
  for (const k of Object.keys(manifest.backend)) assert.ok(['start', 'healthPath', 'readyWhen'].includes(k), k);
  for (const k of Object.keys(manifest.frontend)) assert.ok(['path', 'navLabel', 'keepAlive'].includes(k), k);
  assert.equal(manifest.id, 'code-git');
  assert.equal(manifest.pluginApi, 1);
  assert.equal('mcp' in manifest, false);
  assert.equal(manifest.frontend.path, '/');
  assert.equal(manifest.backend.start, 'npm start');
  assert.equal(pkg.scripts.start, 'node server.js');
});

test('manifest version equals the package version', () => {
  assert.equal(manifest.version, pkg.version);
});

test('healthPath is served', async (t) => {
  const { call } = await startApp(t);
  const r = await call('GET', manifest.backend.healthPath);
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
});
