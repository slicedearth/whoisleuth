import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromiumUserNamespaceProfile, pinnedHeadlessShellPath } from '../tools/ci-browser-sandbox.mts';

test('the CI namespace exception names only the pinned installed browser', () => {
  const executable = pinnedHeadlessShellPath('/fixture/cache', { browsers: [
    { name: 'chromium', revision: '999' }, { name: 'chromium-headless-shell', revision: '1234' },
  ] });
  assert.equal(executable, '/fixture/cache/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell');
  assert.equal(chromiumUserNamespaceProfile(executable),
    `abi <abi/4.0>,\nprofile whoisleuth-ci-chromium "${executable}" flags=(unconfined) {\n  userns,\n}\n`);
  for (const metadata of [null, {}, { browsers: [] }, { browsers: [
    { name: 'chromium-headless-shell', revision: '1234' }, { name: 'chromium-headless-shell', revision: '1234' },
  ] }, { browsers: [{ name: 'chromium-headless-shell', revision: '../other' }] }]) {
    assert.throws(() => pinnedHeadlessShellPath('/fixture/cache', metadata), TypeError);
  }
});

test('profile generation rejects wildcard, relative and injected attachments', () => {
  for (const executable of ['chrome-headless-shell', '/fixture/**/chrome-headless-shell',
    '/fixture/../other/chrome-headless-shell', '/fixture//chrome-headless-shell',
    '/fixture/"quoted"/chrome-headless-shell', '/fixture/\nuserns,/chrome-headless-shell',
    '/fixture/{other}/chrome-headless-shell', '/fixture/chrome']) {
    assert.throws(() => chromiumUserNamespaceProfile(executable), TypeError);
  }
});
