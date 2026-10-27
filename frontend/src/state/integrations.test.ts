import { afterEach, expect, test, vi } from 'vitest';
import { json } from '@/test/fixtures';
import { frameInCc, unframe } from '@/test/fakeHost';
import { stubFetch } from '@/test/stubFetch';
import { integrationsStore, loadIntegrations, resetIntegrations } from './integrations';

afterEach(() => { unframe(); resetIntegrations(); });

test('inside cc, the enabled code-review\'s id is stored', async () => {
  frameInCc();
  stubFetch({ 'GET api/integrations': { codeReview: { id: 'code-review' } } });
  await loadIntegrations();
  expect(integrationsStore.get()).toEqual({ codeReview: 'code-review' });
});

test('inside cc, code-review not enabled stores null', async () => {
  frameInCc();
  integrationsStore.set({ codeReview: 'stale' });
  stubFetch({ 'GET api/integrations': { codeReview: null } });
  await loadIntegrations();
  expect(integrationsStore.get()).toEqual({ codeReview: null });
});

test('a refused request hides the links and warns with the code', async () => {
  frameInCc();
  integrationsStore.set({ codeReview: 'stale' });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  stubFetch({ 'GET api/integrations': json({ error: 'cc down', code: 'CONDUCTOR_UNAVAILABLE' }, 503) });
  await loadIntegrations();
  expect(integrationsStore.get()).toEqual({ codeReview: null });
  expect(warn).toHaveBeenCalledOnce();
  expect(String(warn.mock.calls[0].join(' '))).toContain('CONDUCTOR_UNAVAILABLE');
});

test('standalone, nothing is requested', async () => {
  const { fn } = stubFetch({});
  await loadIntegrations();
  expect(fn).not.toHaveBeenCalled();
  expect(integrationsStore.get()).toEqual({ codeReview: null });
});
