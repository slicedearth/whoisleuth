import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeThemePreference,
  resolveThemePreference,
} from '../frontend/src/lib/theme.ts';
import {
  browserViewportClass,
  buildBrowserSupportDiagnostics,
  formatBrowserSupportDiagnostics,
} from '../frontend/src/lib/browser-support-diagnostics.ts';

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

test('support diagnostics retain only the fixed build, viewport, theme and capability allowlist', () => {
  assert.equal(browserViewportClass(320), 'compact');
  assert.equal(browserViewportClass(1024), 'standard');
  assert.equal(browserViewportClass(1600), 'wide');
  const report = buildBrowserSupportDiagnostics({
    applicationVersion: '2.3.0',
    buildRevision: 'ABCDEF1234567890',
    viewportWidth: 390,
    selectedTheme: 'system',
    renderedTheme: 'dark',
    secureContext: true,
    indexedDbAvailable: true,
    storageManagerAvailable: true,
    webCryptoAvailable: true,
    clipboardAvailable: false,
  });
  assert.deepEqual(Object.keys(report), [
    'product', 'applicationVersion', 'buildRevision', 'viewportClass',
    'selectedTheme', 'renderedTheme', 'capabilities',
  ]);
  assert.equal(report.buildRevision, 'abcdef123456');
  assert.equal(report.viewportClass, 'compact');
  const output = formatBrowserSupportDiagnostics(report);
  assert.doesNotMatch(output, /target|case|evidence|url|user.?agent|storage.?content/iu);
});
