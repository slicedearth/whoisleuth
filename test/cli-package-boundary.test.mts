import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';

import packageJson from '../package.json' with { type: 'json' };
import packageTemplate from '../packages/cli/package.template.json' with { type: 'json' };

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('CLI package boundary', () => {
  test('remains private and does not advertise an application library entry point', () => {
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.license, 'AGPL-3.0-only');
    assert.equal(Object.hasOwn(packageJson, 'main'), false);
    assert.match(packageJson.description, /local-first domain intelligence/u);
    assert.deepEqual(packageJson.keywords, [
      'whois',
      'rdap',
      'dns',
      'domain-intelligence',
      'brand-protection',
      'typosquatting',
      'certificate-transparency',
      'osint',
      'threat-intelligence',
      'asn',
    ]);
  });

  test('leaves distributable metadata to the scoped package builder', () => {
    assert.equal(Object.hasOwn(packageJson, 'files'), false);
    assert.equal(Object.hasOwn(packageJson, 'bin'), false);
    assert.equal(packageTemplate.private, true);
    assert.deepEqual(packageTemplate.bin, { whoisleuth: 'bin/whoisleuth.mjs' });
  });

  test('keeps the source CLI entry point executable for repository use', () => {
    const mode = statSync(join(__dirname, '..', 'bin/whoisleuth.mts')).mode;
    assert.notEqual(mode & 0o111, 0);
  });
});
