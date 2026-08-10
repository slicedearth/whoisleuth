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
import {
  MAX_CAMPAIGN_COHORT_ASSERTIONS,
  MAX_CAMPAIGN_COHORT_MEMBERS,
  MAX_CAMPAIGN_COHORT_RATIONALES,
  MAX_CAMPAIGN_COHORTS,
} from '../frontend/src/lib/analysis/campaign-cohort-review.ts';
import {
  MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE,
  MAX_OPERATIONS_REPORT_CASES,
} from '../frontend/src/lib/analysis/brand-protection-operations-report.ts';

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
    assert.match(compact, /Last updated: 10 August 2026/u);
    assert.ok(compact.includes(`up to ${MAX_HANDOFF_CANDIDATES.toLocaleString('en-AU')} selected domains`));
    assert.ok(compact.includes(`up to ${MAX_GENERATED_CONTEXT.toLocaleString('en-AU')} generated candidates`));
    assert.ok(compact.includes(`capped at ${mib(MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES)} MiB`));
    assert.ok(compact.includes(`up to ${MAX_BULK_REVIEW_PRESETS} named filter and sorting presets`));
    assert.ok(compact.includes(`up to ${MAX_BULK_REVIEW_ROWS.toLocaleString('en-AU')} per-domain review states`));
    assert.ok(compact.includes(`version ${WORKSPACE_ARCHIVE_VERSION} added Bulk review state`));
    assert.ok(compact.includes(`Saved session schema ${BULK_SESSION_SCHEMA_VERSION}`));
    assert.ok(compact.includes('Schemas 1 through 3 remain readable'));
    assert.ok(compact.includes('Versions 1 through 4 remain readable'));
    assert.ok(compact.includes('random one-use token'));
    assert.ok(compact.includes(HANDOFF_KEY));
    assert.ok(compact.includes('up to eight exact opaque Brand Profile identifiers'));
    assert.ok(compact.includes('failed local reads remain explicit'));
    assert.ok(compact.includes('Case report v8 JSON and Markdown'));
    assert.ok(compact.includes('Public CLI case packs clear them'));
    assert.ok(compact.includes(`at most ${MAX_CAMPAIGN_COHORT_MEMBERS} matching cases`));
    assert.ok(compact.includes(`at most ${MAX_CAMPAIGN_COHORTS} cohorts`));
    assert.ok(compact.includes(`at most ${MAX_CAMPAIGN_COHORT_RATIONALES} source-qualified rationales`));
    assert.ok(compact.includes(`Up to ${MAX_CAMPAIGN_COHORT_ASSERTIONS} assertions are displayed separately`));
    assert.ok(compact.includes('creates no stored record'));
    assert.ok(compact.includes('Evidence-debt review'));
    assert.ok(compact.includes('the absence of a retained source record remains distinct from an explicit skipped collection'));
    assert.match(compact, /starts no lookup, retry, export, or write/u);
    assert.ok(compact.includes('Lookup claim passport'));
    assert.match(compact, /stable requirement identifiers, exact retained source states/u);
    assert.match(compact, /without another request or a browser-local write/u);
    assert.ok(compact.includes('Brand-protection operations report'));
    assert.ok(compact.includes(`at most ${MAX_OPERATIONS_REPORT_CASES} readable Cases`));
    assert.ok(compact.includes(`${MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE} current action records per Case`));
    assert.match(compact, /excludes Case and domain identifiers, domains, recipients, notes, references, outcome text, raw evidence, and provider payloads/u);
    assert.match(compact, /target-free Risk calibration summary/iu);
    assert.match(compact, /rejects the detailed report/u);
    assert.match(compact, /writes no browser storage/u);
  }

  assert.equal(BROWSER_LOCAL_COLLECTIONS.length, 12);
  assert.deepEqual([...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS], [1, 2, 3, 4, WORKSPACE_ARCHIVE_VERSION]);
  assert.deepEqual([...SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS], [1, 2, 3, BULK_SESSION_SCHEMA_VERSION]);
  assert.match(rootNotice, /twelve browser-local collections/u);
  assert.match(publicNotice, /twelve browser-local collections/u);
});
