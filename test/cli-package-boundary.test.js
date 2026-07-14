const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { statSync } = require('node:fs');
const { join } = require('node:path');

const packageJson = require('../package.json');

const EXPECTED_PACKAGE_FILES = [
  'bin/**/*.mts',
  'cli/**/*.mts',
  'lib/**/*.mts',
  'docs/cli.md',
  'LICENSE',
  'NOTICE',
];

describe('CLI package boundary', () => {
  test('remains private and does not advertise an application library entry point', () => {
    assert.equal(packageJson.private, true);
    assert.equal(Object.hasOwn(packageJson, 'main'), false);
  });

  test('uses a narrow allowlist for distributable runtime files', () => {
    assert.deepEqual(packageJson.files, EXPECTED_PACKAGE_FILES);
  });

  test('exposes the native TypeScript CLI entry point as an executable', () => {
    assert.deepEqual(packageJson.bin, { whoisleuth: 'bin/whoisleuth.mts' });
    const mode = statSync(join(__dirname, '..', packageJson.bin.whoisleuth)).mode;
    assert.notEqual(mode & 0o111, 0);
  });
});
