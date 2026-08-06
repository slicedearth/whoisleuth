import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  MAX_BULK_REVIEW_PRESETS,
  MAX_BULK_REVIEW_ROWS,
} from '../frontend/src/lib/analysis/bulk-review-model.ts';
import {
  BULK_SESSION_SCHEMA_VERSION,
  SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';
import {
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  WORKSPACE_ARCHIVE_VERSION,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import { BROWSER_LOCAL_COLLECTIONS } from '../frontend/src/lib/browser-local-data-definitions.ts';
import {
  HANDOFF_KEY,
  MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES,
  MAX_GENERATED_CONTEXT,
  MAX_HANDOFF_CANDIDATES,
} from '../frontend/src/lib/candidate-handoff-core.ts';

const ROOT_NOTICE_URL = new URL('../PRIVACY.md', import.meta.url);
const PUBLIC_NOTICE_URL = new URL('../frontend/src/routes/(public)/privacy/+page.svelte', import.meta.url);

function mib(bytes: number): number {
  return bytes / (1024 * 1024);
}

test('public privacy notices track versioned browser-local data contracts', async () => {
  const [rootNotice, publicNotice] = await Promise.all([
    readFile(ROOT_NOTICE_URL, 'utf8'),
    readFile(PUBLIC_NOTICE_URL, 'utf8'),
  ]);

  for (const notice of [rootNotice, publicNotice]) {
    const compact = notice.replace(/\s+/gu, ' ');
    assert.match(compact, /Last updated: 6 August 2026/u);
    assert.ok(compact.includes(`up to ${MAX_HANDOFF_CANDIDATES.toLocaleString('en-AU')} selected domains`));
    assert.ok(compact.includes(`up to ${MAX_GENERATED_CONTEXT.toLocaleString('en-AU')} generated candidates`));
    assert.ok(compact.includes(`capped at ${mib(MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES)} MiB`));
    assert.ok(compact.includes(`up to ${MAX_BULK_REVIEW_PRESETS} named filter and sorting presets`));
    assert.ok(compact.includes(`up to ${MAX_BULK_REVIEW_ROWS.toLocaleString('en-AU')} per-domain review states`));
    assert.ok(compact.includes(`version ${WORKSPACE_ARCHIVE_VERSION} added Bulk review state`));
    assert.ok(compact.includes(`Saved session schema ${BULK_SESSION_SCHEMA_VERSION}`));
    assert.ok(compact.includes('Schema 1 and 2 sessions remain readable')
      || compact.includes('Schemas 1 and 2 remain readable'));
    assert.ok(compact.includes('Versions 1 through 4 remain readable'));
    assert.ok(compact.includes('random one-use token'));
    assert.ok(compact.includes(HANDOFF_KEY));
  }

  assert.equal(BROWSER_LOCAL_COLLECTIONS.length, 12);
  assert.deepEqual([...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS], [1, 2, 3, 4, WORKSPACE_ARCHIVE_VERSION]);
  assert.deepEqual([...SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS], [1, 2, BULK_SESSION_SCHEMA_VERSION]);
  assert.match(rootNotice, /twelve browser-local collections/u);
  assert.match(publicNotice, /twelve browser-local collections/u);
});
