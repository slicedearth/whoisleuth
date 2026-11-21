import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildLookupEvidence } from '../lib/evidence-export.mts';
import { parseLookupEvidenceReplay, type LookupEvidenceReplay } from '../lib/lookup-evidence-replay.mts';
import { buildLookupEvidenceReplayDiff } from '../lib/lookup-evidence-replay-diff.mts';
import { lookupRegistrationCreatedObservations } from '../lib/lookup-key-facts.mts';
import { selectRegistrationCreation } from '../packages/evidence/prior-registration.mts';
import {
  certificateChronologyEligibility, pageFieldEligibility, sourceEligibility,
} from '../packages/evidence/evidence-eligibility.mts';

// Every combination of collection state is run through the real evidence
// writer and replay reader, so no surface can classify a pair differently from
// the shared eligibility rules.

const saved = JSON.parse(readFileSync(new URL('./fixtures/cli-lookup-v1.json', import.meta.url), 'utf8'));
const EARLIER = '2026-08-01T00:00:00.000Z', LATER = '2026-08-08T00:00:00.000Z';

test('source eligibility separates failed, incomplete and unrecorded states', () => {
  const cases: Array<[string, boolean | null, boolean, string | null]> = [
    ['success', true, false, null], ['complete', null, false, null], ['provided', true, true, null],
    ['success', null, true, 'source_state_unknown'], ['success', false, false, 'source_incomplete'],
    ['partial', true, false, 'source_incomplete'], ['error', null, false, 'source_failed'],
    ['timeout', null, false, 'source_failed'], ['not found', true, false, 'source_failed'],
    ['', null, false, 'source_state_unknown'], ['reported', null, false, 'source_state_unknown'],
  ];
  for (const [state, complete, requireExplicitComplete, reason] of cases) {
    assert.equal(sourceEligibility({ state, complete }, { requireExplicitComplete }).reason, reason, `${state}/${complete}/${requireExplicitComplete}`);
  }
  assert.equal(sourceEligibility(null).reason, 'source_state_unknown');
  assert.equal(certificateChronologyEligibility({ firstObservedAt: '2020-01-01T00:00:00.000Z' }).eligible, true);
  assert.equal(certificateChronologyEligibility({ firstObservedAt: '2020-01-01T00:00:00.000Z', chronologyContradicted: true }).reason, 'chronology_contradictory');
  assert.equal(certificateChronologyEligibility({ firstObservedAt: null }).reason, 'value_unusable');
});

type PageVariant = Readonly<{ label: string; page: Record<string, unknown>; quality?: 'complete' | 'partial' | 'unavailable' }>;
const PAGE_VARIANTS: readonly PageVariant[] = [
  { label: 'explicitly complete page, no retained quality', page: { status: 'success', complete: true } },
  { label: 'successful page without a completeness flag', page: { status: 'success' } },
  { label: 'partial page, no retained quality', page: { status: 'partial', complete: false } },
  { label: 'unavailable page, no retained quality', page: { status: 'unavailable' } },
  { label: 'complete retained quality', page: { status: 'success', complete: true }, quality: 'complete' },
  { label: 'partial retained quality', page: { status: 'partial', complete: false }, quality: 'partial' },
  { label: 'unavailable retained quality', page: { status: 'unavailable' }, quality: 'unavailable' },
];

async function pageCapture(variant: PageVariant, hasPasswordField: boolean, observedAt: string) {
  const lookup = structuredClone(saved);
  Object.assign(lookup.availability, {
    hasPasswordField,
    pageIdentity: { ...variant.page, observedAt },
    ...(variant.quality ? { webCollectionQuality: {
      version: 1, page: variant.quality, favicon: 'complete', combined: variant.quality === 'complete' ? 'complete' : 'partial',
    } } : {}),
  });
  const replay = await parseLookupEvidenceReplay(JSON.stringify(buildLookupEvidence(lookup, { generatedAt: observedAt, idnAnalysis: null })));
  return { variant, value: hasPasswordField, replay };
}

function eligible(replay: LookupEvidenceReplay) {
  return pageFieldEligibility('hasPasswordField', replay.webCollection, replay.sources.find((item) => item.id === 'page-identity')).eligible;
}

test('every page collection pair is compared only when both sides are eligible', async () => {
  const left = await Promise.all(PAGE_VARIANTS.flatMap((variant) => [true, false].map((value) => pageCapture(variant, value, EARLIER))));
  const right = await Promise.all(PAGE_VARIANTS.flatMap((variant) => [true, false].map((value) => pageCapture(variant, value, LATER))));
  let compared = 0;
  for (const before of left) {
    // A negative cue from an ineligible collection is never projected as an observed absence.
    const fact = before.replay.facts.find((item) => item.id === 'page.password-field');
    assert.equal(fact?.value ?? null, before.value || eligible(before.replay) ? String(before.value) : null, before.variant.label);
    for (const after of right) {
      const row = buildLookupEvidenceReplayDiff(before.replay, after.replay).rows.find((item) => item.id === 'fact:page.password-field');
      const bothEligible = eligible(before.replay) && eligible(after.replay);
      const projected = (capture: typeof before) => capture.value || eligible(capture.replay);
      // With neither side projecting the fact, there is nothing to compare and no row.
      const expected = !projected(before) && !projected(after) ? undefined
        : !bothEligible ? 'collection_quality_difference' : before.value === after.value ? 'unchanged' : 'observed_change';
      assert.equal(row?.kind, expected, `${before.variant.label}=${before.value} → ${after.variant.label}=${after.value}`);
      compared += 1;
    }
  }
  assert.equal(compared, 196);
});

test('a saved Lookup and its evidence export select the same creation date for every source combination', async () => {
  const rdapStates = [{ status: 'success' }, { status: 'success', complete: true }, { status: 'partial', complete: false }, { status: 'error' }];
  const whoisStates = [{ status: 'complete' }, { status: 'partial', complete: false }, { status: 'error' }];
  let checked = 0;
  for (const rdap of rdapStates) {
    for (const whois of whoisStates) {
      const lookup = structuredClone(saved);
      lookup.diagnostics = { ...lookup.diagnostics, rdap, whois };
      lookup.rdap.parsed.lifecycle = { createdDateIso: '2024-09-01T00:00:00.000Z' };
      lookup.whois.parsed = { ...lookup.whois.parsed, createdDate: '2024-02-01T00:00:00Z' };
      const label = `RDAP ${JSON.stringify(rdap)} · WHOIS ${JSON.stringify(whois)}`;
      const fromSaved = selectRegistrationCreation(lookupRegistrationCreatedObservations(lookup).map((item) => ({
        source: item.source, value: item.value, sourceState: item.sourceState, complete: item.complete,
      })));
      // Expected from the shared rule alone: registry RDAP first, then WHOIS.
      const expected = sourceEligibility({ state: rdap.status, complete: rdap.complete ?? null }).eligible
        ? { createdAt: '2024-09-01T00:00:00.000Z', source: 'Registry RDAP' }
        : sourceEligibility({ state: whois.status, complete: whois.complete ?? null }).eligible
          ? { createdAt: '2024-02-01T00:00:00.000Z', source: 'WHOIS' } : null;
      assert.deepEqual(fromSaved, expected, `saved ${label}`);
      let exported: unknown;
      try { exported = buildLookupEvidence(lookup, { generatedAt: EARLIER, idnAnalysis: null }); }
      catch { continue; }
      checked += 1;
      const replay = await parseLookupEvidenceReplay(JSON.stringify(exported));
      assert.deepEqual(replay.registrationCreation ?? null, expected, `export ${label}`);
    }
  }
  assert.ok(checked >= 6, `at least six combinations are exportable (${checked})`);
});
