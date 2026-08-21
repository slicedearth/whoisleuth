import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WORKSPACE_DOMAIN_COMPATIBILITY_FACADES } from '../packages/contracts/workspace-portability.mts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('workspace domain compatibility facades', () => {
  for (const [facade, owner] of WORKSPACE_DOMAIN_COMPATIBILITY_FACADES) {
    test(`${facade} preserves the shared owner export identities`, async () => {
      const facadeModule = await import(pathToFileURL(resolve(ROOT, facade)).href);
      const ownerModule = await import(pathToFileURL(resolve(ROOT, owner)).href);
      assert.deepEqual(Object.keys(facadeModule).sort(), Object.keys(ownerModule).sort());
      for (const name of Object.keys(ownerModule)) {
        assert.strictEqual(facadeModule[name], ownerModule[name], `${facade}#${name}`);
      }
    });
  }
});
