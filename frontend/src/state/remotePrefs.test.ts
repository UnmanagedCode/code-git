import { expect, test } from 'vitest';
import { DEFAULT_REMOTE_PREFS, getRemotePrefs, resetRemotePrefs, updateRemotePrefs, validateRemotePrefs } from './remotePrefs';

test('defaults: pull fast-forward if possible, auto-fetch off, no push after commit', () => {
  expect(DEFAULT_REMOTE_PREFS).toEqual({ pullMode: 'ff', autoFetchMinutes: 0, pushAfterCommit: false });
  expect(getRemotePrefs('app')).toEqual(DEFAULT_REMOTE_PREFS);
});

test('the validator keeps each field only when it is an allowed value', () => {
  expect(validateRemotePrefs({ pullMode: 'rebase', autoFetchMinutes: 15, pushAfterCommit: true })).toEqual({ pullMode: 'rebase', autoFetchMinutes: 15, pushAfterCommit: true });
  expect(validateRemotePrefs({ pullMode: 'interactive', autoFetchMinutes: 7, pushAfterCommit: 'yes' })).toEqual(DEFAULT_REMOTE_PREFS);
  expect(validateRemotePrefs({ autoFetchMinutes: '5' })).toEqual(DEFAULT_REMOTE_PREFS);
  for (const raw of [null, 'x', 3, [], undefined]) expect(validateRemotePrefs(raw)).toEqual(DEFAULT_REMOTE_PREFS);
  expect(validateRemotePrefs({ pullMode: 'ffOnly' })).toEqual({ ...DEFAULT_REMOTE_PREFS, pullMode: 'ffOnly' });
});

test('per project, persisted under code-git:remotes:<project>, read back after a reload; a corrupt record falls back', () => {
  updateRemotePrefs('app', { pullMode: 'rebase' });
  updateRemotePrefs('app', { autoFetchMinutes: 30 });
  updateRemotePrefs('other', { pushAfterCommit: true });
  expect(JSON.parse(localStorage.getItem('code-git:remotes:app')!)).toEqual({ pullMode: 'rebase', autoFetchMinutes: 30, pushAfterCommit: false });
  resetRemotePrefs();
  expect(getRemotePrefs('app')).toEqual({ pullMode: 'rebase', autoFetchMinutes: 30, pushAfterCommit: false });
  expect(getRemotePrefs('other')).toEqual({ ...DEFAULT_REMOTE_PREFS, pushAfterCommit: true });
  updateRemotePrefs('app', { autoFetchMinutes: 2 });
  expect(getRemotePrefs('app').autoFetchMinutes).toBe(0);
  localStorage.setItem('code-git:remotes:broken', '{not json');
  expect(getRemotePrefs('broken')).toEqual(DEFAULT_REMOTE_PREFS);
});
