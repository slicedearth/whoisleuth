import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';

import packageJson from '../package.json' with { type: 'json' };

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const EXPECTED_PACKAGE_FILES = [
  'bin/**/*.mts',
  'cli/**/*.mts',
  'lib/**/*.mts',
  'docs/cli.md',
  'LICENSE',
  'LICENSES/Retire.js-Apache-2.0.txt',
  'NOTICE',
  'frontend/static/third-party-notices.txt',
  'TRADEMARKS.md',
];

describe('CLI package boundary', () => {
  test('remains private and does not advertise an application library entry point', () => {
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.license, 'AGPL-3.0-only');
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
