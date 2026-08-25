import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CASE_DOMAIN_COMPATIBILITY_FACADES } from '../packages/contracts/case-portability.mts';
import { EXTERNAL_OBSERVATION_INTERCHANGE_COMPATIBILITY_FACADES } from '../packages/contracts/external-observation-interchange.mts';
import { INVESTIGATION_DOMAIN_COMPATIBILITY_FACADES } from '../packages/contracts/investigation-portability.mts';
import { OFFLINE_COMPARISON_COMPATIBILITY_FACADES } from '../packages/contracts/offline-comparison.mts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE_FACADES = CASE_DOMAIN_COMPATIBILITY_FACADES.filter(([, owner]) => (
  owner.startsWith('packages/workspace/workspace-archive')
));
const PORTABLE_FACADES = Object.freeze([
  ...INVESTIGATION_DOMAIN_COMPATIBILITY_FACADES,
  ...EXTERNAL_OBSERVATION_INTERCHANGE_COMPATIBILITY_FACADES,
  ...OFFLINE_COMPARISON_COMPATIBILITY_FACADES,
  ...ARCHIVE_FACADES,
]);

describe('portable domain compatibility facades', () => {
  for (const [facade, owner] of PORTABLE_FACADES) {
    test(`${facade} preserves every shared owner export identity`, async () => {
      const [facadeModule, ownerModule] = await Promise.all([
        import(pathToFileURL(resolve(ROOT, facade)).href),
        import(pathToFileURL(resolve(ROOT, owner)).href),
      ]);
      assert.deepEqual(Object.keys(facadeModule).sort(), Object.keys(ownerModule).sort());
      for (const name of Object.keys(ownerModule)) {
        assert.strictEqual(facadeModule[name], ownerModule[name], `${facade}#${name}`);
      }
    });
  }
});
