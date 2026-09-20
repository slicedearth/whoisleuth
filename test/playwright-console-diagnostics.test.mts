import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isInjectedBrowserLayoutDiagnostic, isCancelledSessionPageDiagnostic, isNativePreloadTimingDiagnostic, isPolicyFixtureDiagnostic } from '../tools/playwright-execution-contract.mts';

test('native policy diagnostics cannot suppress application errors or errors from another document', () => {
  const origin = 'http://127.0.0.1:4173', fixture = `${origin}/__policy-fixture`;
  const text = "Executing inline script violates the following Content Security Policy directive 'script-src \'none\''. Either a hash or a nonce is required. The action has been blocked.";
  for (const source of ['', fixture]) assert.equal(isPolicyFixtureDiagnostic('chromium', 'error', text, source, fixture, origin), true);
  for (const [browser, type, diagnostic, source, page] of [
    ['webkit', 'error', text, fixture, fixture], ['chromium', 'warning', text, fixture, fixture],
    ['chromium', 'error', text, '', `${origin}/lookup`], ['chromium', 'error', text, `${origin}/cli`, fixture],
    ['chromium', 'error', text, fixture, `${fixture}?other`], ['chromium', 'error', 'TypeError: application failed', fixture, fixture],
    ['chromium', 'error', text + ' unexpected failure', fixture, fixture],
  ]) assert.equal(isPolicyFixtureDiagnostic(browser!, type!, diagnostic!, source!, page!, origin), false);
});

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

test('native preload timing diagnostics require a completed local script and cannot hide other console failures', () => {
  const origin = 'http://127.0.0.1:4180';
  const resource = `${origin}/_app/immutable/chunks/fixture-build.js`;
  const text = `The resource ${resource} was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it wasn't preloaded for nothing.`;
  const completed = new Set([resource]);
  assert.equal(isNativePreloadTimingDiagnostic('webkit', 'warning', text, '', origin, completed), true);
  assert.equal(isNativePreloadTimingDiagnostic('webkit', 'warning', text, '', origin, new Set()), false);
  for (const [browser, type, message, source, allowed] of [
    ['chromium', 'warning', text, '', origin], ['firefox', 'warning', text, '', origin],
    ['webkit', 'error', text, '', origin], ['webkit', 'warning', text, resource, origin],
    ['webkit', 'warning', text, '', 'http://127.0.0.1:4181'],
    ['webkit', 'warning', text + ' Another error', '', origin],
    ['webkit', 'warning', text.replace('.js ', '.css '), '', origin],
    ['webkit', 'warning', text.replace('fixture-build.js', 'fixture-build.js?other'), '', origin],
    ['webkit', 'warning', text.replace('/_app/immutable/chunks/', '/api/'), '', origin],
    ['webkit', 'warning', text.replace('127.0.0.1', 'example.test'), '', origin],
    ['webkit', 'warning', 'Application warning', '', origin],
  ]) assert.equal(isNativePreloadTimingDiagnostic(browser!, type!, message!, source!, allowed!, completed), false);
});
