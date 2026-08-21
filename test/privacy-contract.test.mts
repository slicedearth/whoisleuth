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
import { MAX_CASE_INPUT_RECORDS, MAX_CASES } from '../frontend/src/lib/analysis/case-model.ts';
import { MAX_SAFE_FETCH_ADDRESS_CANDIDATES } from '../lib/safe-fetch.mts';
import {
  MAX_BOUNDED_JSON_CONTAINER_ITEMS,
  MAX_BOUNDED_JSON_DEPTH,
  MAX_BOUNDED_JSON_KEYS,
  MAX_BOUNDED_JSON_VALUES,
} from '../lib/bounded-json.mts';
import { MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS } from '../lib/lookup-response-contract.mts';
import {
  LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH,
  LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES,
} from '../lib/evidence-export.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from '../cli/saved-lookup.mts';

const ROOT_NOTICE_URL = new URL('../PRIVACY.md', import.meta.url);
const PUBLIC_NOTICE_URL = new URL('../frontend/src/routes/(public)/privacy/+page.svelte', import.meta.url);
const DISCLOSURE_URL = new URL('../DISCLOSURE', import.meta.url);

function mib(bytes: number): number {
  return bytes / (1024 * 1024);
}

test('public privacy notices track versioned browser-local data contracts', async () => {
  const [rootNotice, publicNotice, disclosure] = await Promise.all([
    readFile(ROOT_NOTICE_URL, 'utf8'),
    readFile(PUBLIC_NOTICE_URL, 'utf8'),
    readFile(DISCLOSURE_URL, 'utf8'),
  ]);

  for (const notice of [rootNotice, publicNotice]) {
    const compact = notice.replace(/\s+/gu, ' ');
    assert.match(compact, /Last updated: 20 August 2026/u);
    assert.match(compact, /Domain-control passports?.*?selected official-domain nameserver, DS, MX, CAA, TLS issuer or public-key, transfer-lock, and renewal-review expectations/iu);
    assert.match(compact, /Profile identity, brands, contacts, notes, retained observations, change windows, suppressions.*?excluded/iu);
    assert.match(compact, /field-level preview.*?does not delete a destination value by omission/iu);
    assert.match(compact, /valid digest detects file changes.*?does not prove that the expected state is correct or deployed/iu);
    assert.match(compact, /same bounded homepage (?:request|response)/u);
    assert.match(compact, /fixed robots and Twitter Card declaration classes/u);
    assert.match(compact, /(?:Content-Encoding, Cache-Control|selected-response content-coding and cache-policy metadata)/u);
    assert.match(compact, /Raw (?:declaration and header values|header and validator values).*?(?:not retained|discarded)/u);
    assert.match(compact, /no compression ratio/u);
    assert.match(compact, /remain(?:s)? outside compact Bulk and ordinary browser-local stores/u);
    assert.match(compact, /deliberate full saved Lookup or evidence file/u);
    assert.ok(compact.includes(`more than ${MAX_SAFE_FETCH_ADDRESS_CANDIDATES} address candidates`));
    assert.ok(compact.includes(`at most ${MAX_CASE_INPUT_RECORDS.toLocaleString('en-AU')} parsed records before the ${MAX_CASES}-case store cap`));
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
    assert.ok(compact.includes('Case report v9 JSON and Markdown'));
    assert.ok(compact.includes('Public CLI case packs clear identifiers, actions, observed-effect reviews, and closure records'));
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
    assert.ok(compact.includes(`${MAX_OPERATIONS_REPORT_ACTIONS_PER_CASE} action records per Case`));
    assert.match(compact, /excludes Case and domain identifiers, domains, recipients, notes, references, outcome text, raw evidence, and provider payloads/u);
    assert.match(compact, /target-free Risk calibration summary/iu);
    assert.match(compact, /rejects the detailed report/u);
    assert.match(compact, /writes no browser storage/u);
    assert.match(compact, /highest proven selected, public-revalidated, or connected stage/u);
    assert.match(compact, /not-evaluated after a candidate is retained or unavailable when none exists/u);
    assert.match(compact, /Only confirmed connected addresses can form address relationship leads/u);
    assert.match(compact, /do not cryptographically authenticate the A or AAAA RRset or any CNAME chain/u);
    assert.match(compact, /bounded certificate authorization and identity error text/u);
    assert.ok(compact.includes(`Live Lookup responses are rejected before display when they exceed ${MAX_BOUNDED_JSON_DEPTH} nesting levels, ${MAX_BOUNDED_JSON_KEYS.toLocaleString('en-AU')} keys, ${MAX_BOUNDED_JSON_VALUES.toLocaleString('en-AU')} values, or ${MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS.toLocaleString('en-AU')} items in any single container`));
    assert.ok(compact.includes(`stricter ${LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH}-level, ${LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES.toLocaleString('en-AU')}-entry portable evidence structure remains reviewable`));
    assert.ok(compact.includes(`Saved CLI Lookup JSON inputs are capped at ${mib(MAX_SAVED_LOOKUP_INPUT_BYTES)} MiB and scanned before parsing for duplicate keys, the prototype-sensitive`));
    assert.match(compact, /aggregate states, durations, truncation, rate-limit counts, and Fast, Deep, or unknown mode counts/u);
    assert.match(compact, /__proto__.*more than 48 nesting levels/u);
    assert.ok(compact.includes(`more than ${MAX_BOUNDED_JSON_CONTAINER_ITEMS.toLocaleString('en-AU')} items in any single container`));
    assert.match(compact, /full saved Lookup rather than a privacy-minimised evidence projection/u);
    assert.match(compact, /raw RDAP publications, WHOIS response bodies, publicly published contact data, bounded source endpoints and timings/u);
    assert.match(compact, /Saved-Lookup diff reads two local supported schema-version 1 or 2 domain documents/u);
    assert.match(compact, /Saved Lookup documents have no applicable embedded integrity contract.*?not accepted by.*?sign-artifact/u);
    assert.match(compact, /If a DANE-TA TLSA usage 2 association is published, active STARTTLS review retains only the observed leaf certificate and leaves that comparison partial because this action does not construct or validate a certificate path to a TLSA trust anchor/u);
    assert.match(compact, /SMTP relay PKIX-TA usage 0 and PKIX-EE usage 1 records are retained as unsupported and cannot complete SMTP DANE assurance; a separately attributable usage 3 match remains eligible/u);
    assert.match(compact, /explicit authorised-capture action/u);
    assert.match(compact, /executes remote page JavaScript/u);
    assert.match(compact, /Each admitted resource operator receives the exact requested URL, including its path and query/u);
    assert.match(compact, /They do not include dedicated request-path or query fields, but the page-controlled title may itself reproduce a path or query/u);
    assert.match(compact, /local fixed-size screenshot/u);
    assert.match(compact, /screenshot necessarily preserves visible rendered content and may include page text or a page-reflected path or query until the operator deletes it/u);
    assert.match(compact, /not uploaded to WHOISleuth/u);
    assert.match(compact, /persist until the operator deletes them/u);
    assert.match(compact, /UTF-8 body-text-node bound marks a capture partial/u);
    assert.match(compact, /tag sequence omits nesting and attributes/u);
    assert.match(compact, /neither is an exact DOM or visibility claim/u);
    assert.match(compact, /Version 2 comparison output reports the page-title equality state without copying either bounded title/u);
    assert.match(compact, /Every capability family and installed CLI operation represented by the current product contract has an explicit execution plane/u);
    assert.match(compact, /does not contain targets, credentials, runtime secrets, or collected evidence/u);
  }

  const compactDisclosure = disclosure.replace(/\s+/gu, ' ');
  assert.match(compactDisclosure, /Hosted and distributable collection does not .*execute remote page scripts/u);
  assert.match(compactDisclosure, /separate repo-local rendered-capture package is an explicit authorised exception/u);
  assert.match(compactDisclosure, /executes page JavaScript in a disposable, network-bounded browser/u);

  assert.equal(BROWSER_LOCAL_COLLECTIONS.length, 12);
  assert.deepEqual([...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS], [1, 2, 3, 4, WORKSPACE_ARCHIVE_VERSION]);
  assert.deepEqual([...SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS], [1, 2, 3, BULK_SESSION_SCHEMA_VERSION]);
  assert.match(rootNotice, /twelve browser-local collections/u);
  assert.match(publicNotice, /twelve browser-local collections/u);
});
