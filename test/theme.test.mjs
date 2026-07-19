import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeThemePreference,
  resolveThemePreference,
} from '../frontend/src/lib/theme.ts';

test('theme preferences accept only the bounded public vocabulary', () => {
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('light'), 'light');
  assert.equal(normalizeThemePreference('system'), 'system');
  assert.equal(normalizeThemePreference('LIGHT'), 'system');
  assert.equal(normalizeThemePreference(''), 'system');
  assert.equal(normalizeThemePreference(null), 'system');
  assert.equal(normalizeThemePreference({ theme: 'light' }), 'system');
});

test('explicit theme preferences do not depend on the system preference', () => {
  assert.equal(resolveThemePreference('dark', false), 'dark');
  assert.equal(resolveThemePreference('dark', true), 'dark');
  assert.equal(resolveThemePreference('light', false), 'light');
  assert.equal(resolveThemePreference('light', true), 'light');
});

test('system theme resolves from the current operating-system preference', () => {
  assert.equal(resolveThemePreference('system', false), 'dark');
  assert.equal(resolveThemePreference('system', true), 'light');
});
