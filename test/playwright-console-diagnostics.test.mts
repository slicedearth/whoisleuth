import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInjectedBrowserLayoutDiagnostic, isCancelledSessionPageDiagnostic } from '../tools/playwright-execution-contract.mts';

test('only the exact injected Firefox layout warning is a retained tool diagnostic', () => {
  const text = '[JavaScript Warning: "Layout was forced before the page was fully loaded. If stylesheets are not yet loaded this may cause a flash of unstyled content." {file: "debugger eval code" line: 393}]';
  assert.equal(isInjectedBrowserLayoutDiagnostic('firefox', 'warning', text, 'debugger eval code'), true);
  for (const browser of ['chromium', 'webkit', 'unknown']) {
    assert.equal(isInjectedBrowserLayoutDiagnostic(browser, 'warning', text, 'debugger eval code'), false);
  }
  for (const url of ['http://127.0.0.1:4173/_app/immutable/app.js', '', 'http://example.test/debugger eval code']) {
    assert.equal(isInjectedBrowserLayoutDiagnostic('firefox', 'warning', text, url), false);
  }
  assert.equal(isInjectedBrowserLayoutDiagnostic('firefox', 'error', text, 'debugger eval code'), false);
  assert.equal(isInjectedBrowserLayoutDiagnostic('firefox', 'warning', 'Unrelated warning', 'debugger eval code'), false);
  assert.equal(isInjectedBrowserLayoutDiagnostic('firefox', 'warning', text + ' Additional warning', 'debugger eval code'), false);
});

test('session cancellation diagnostics require the exact browser, origin, endpoint and lifecycle evidence', () => {
  const origin = 'http://127.0.0.1:4180';
  const message = '/127.0.0.1:4180/api/session due to access control checks.';
  assert.equal(isCancelledSessionPageDiagnostic('webkit', message, origin, true, true), true);
  for (const [browser, text, source, cancelled, navigated] of [
    ['chromium', message, origin, true, true], ['firefox', message, origin, true, true],
    ['webkit', message, origin, false, true], ['webkit', message, origin, true, false],
    ['webkit', message, 'http://127.0.0.1:4181', true, true],
    ['webkit', message.replace('/session', '/logout'), origin, true, true],
    ['webkit', 'TypeError: Load failed', origin, true, true],
    ['webkit', message + ' additional failure', origin, true, true],
  ] as const) assert.equal(isCancelledSessionPageDiagnostic(browser, text, source, cancelled, navigated), false);
});
