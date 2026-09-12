import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInjectedBrowserLayoutDiagnostic } from '../tools/playwright-execution-contract.mts';

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
