import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCollectionDisclosure, describeLocalFeedDisclosure } from '../frontend/src/lib/analysis/collection-disclosure.ts';

import {
  buildBulkCollectionPreflight,
  buildGuidedCollectionPreflight,
  buildLookupCollectionPreflight,
  COLLECTION_PREFLIGHT_VERSION,
} from '../frontend/src/lib/analysis/collection-preflight.ts';

test('describes fast and deep Lookup collection without promising an exact request count', () => {
  const fast = buildLookupCollectionPreflight({ mode: 'fast', targetCount: 1 });
  const deep = buildLookupCollectionPreflight({
    mode: 'deep',
    targetCount: 1,
    includeSecurityTxt: true,
    includeExternalIntelligence: true,
    disabledSourceIds: ['website_probe'],
  });
  assert.equal(fast.version, COLLECTION_PREFLIGHT_VERSION);
  assert.deepEqual(fast.sources.map((source) => source.id), ['availability', 'rdap']);
  assert.match(fast.sources[0]!.disclosure, /DNS authority fallback.*registrable domain/u);
  assert.equal(deep.sources.find((source) => source.id === 'security_txt')?.state, 'disabled', 'The explicitly selected contact request still depends on the website collector.');
  assert.equal(deep.sources.find((source) => source.id === 'external_intelligence')?.state, 'included');
  assert.equal(deep.sources.find((source) => source.id === 'website_probe')?.state, 'disabled');
  assert.match(deep.cautions.join(' '), /exact request count cannot be known/i);
  assert.match(deep.controls.join(' '), /Saved Case and guide context are not replayed/u);
});

test('keeps optional Lookup sources optional and explains multi-target handoff', () => {
  const preflight = buildLookupCollectionPreflight({ mode: 'deep', targetCount: 4 });
  assert.match(preflight.summary, /handed to Bulk/i);
  assert.match(preflight.summary, /without collecting.*separate plan/u);
  assert.deepEqual(preflight.sources, [], 'Bulk must show its separate compact plan rather than a single-target plan.');
});

test('distinguishes compact Bulk collection and bounds operator-facing values', () => {
  const preflight = buildBulkCollectionPreflight({
    mode: 'deep',
    targetCount: 99_999,
    concurrency: 99,
    pacingLabel: 'Respectful pacing',
    disabledSourceIds: ['tls_intelligence'],
  });
  assert.equal(preflight.targetCount, 2_000);
  assert.match(preflight.controls[0] ?? '', /at most 12 lookups run in parallel/i);
  assert.match(preflight.cautions.join(' '), /compact triage contract/i);
  assert.match(preflight.cautions.join(' '), /limits are not request quotas/u);
  assert.match(preflight.controls.join(' '), /Loading a saved session does not; Resume keeps recorded rows/u);
  assert.equal(preflight.sources.find((source) => source.id === 'tls_intelligence')?.state, 'disabled');
});

test('Fast DNS fallback follows authority admission, not the optional deep DNS collector', () => {
  const input = { mode: 'fast' as const, targetCount: 1, disabledSourceIds: ['dns_intelligence'] };
  for (const plan of [buildLookupCollectionPreflight(input), buildBulkCollectionPreflight({ ...input, concurrency: 1, pacingLabel: 'Default' })]) {
    const authority = plan.sources.find(item => item.id === 'availability')!;
    assert.equal(authority.state, 'included');
    assert.match(authority.disclosure, /resolver receives questions/u);
  }
});

test('guided request review preserves approval and prerequisite boundaries', () => {
  const preflight = buildGuidedCollectionPreflight({
    label: 'Deep Lookup',
    requestImpact: 'May contact registry and website sources.',
    prerequisite: 'Confirm authority for active collection.',
    requiresApproval: true,
    approved: false,
  });
  assert.equal(preflight.kind, 'guided');
  assert.match(preflight.controls[0] ?? '', /does not start until/i);
  assert.match(preflight.cautions[0] ?? '', /confirm authority/i);
  assert.match(preflight.persistence, /records progress locally/i);
  assert.match(preflight.controls.join(' '), /Select any saved input explicitly/u);
});

test('disclosure distinguishes registration, DNS questions and explicit URL selection', () => {
  const input = { mode: 'deep' as const, targetCount: 1, targetType: 'domain' as const };
  const homepage = buildLookupCollectionPreflight(input);
  const selected = buildLookupCollectionPreflight({ ...input, selectedUrl: true });
  const source = (plan: typeof homepage, id: string) => plan.sources.find(value => value.id === id)!.inspection;
  assert.match(source(homepage, 'rdap').data.join(' '), /Registrable domain; subdomain labels, URL path and query excluded/u);
  assert.doesNotMatch(source(homepage, 'rdap').data.join(' '), /Exact entered hostname/u);
  assert.match(source(homepage, 'dns_intelligence').data.join(' '), /owner name and record type/u);
  assert.match(source(homepage, 'website_probe').data.join(' '), /Homepage.*path and query are not selected/u);
  assert.doesNotMatch(source(homepage, 'website_probe').data.join(' '), /Explicitly selected URL/u);
  assert.match(source(selected, 'website_probe').data.join(' '), /Explicitly selected URL path and query; fragments are not sent/u);
  assert.doesNotMatch(source(selected, 'website_probe').data.join(' '), /Homepage/u);
  assert.deepEqual(source(homepage, 'website_probe').recipients, ['Configured DNS resolver', 'Target public service and any eligible redirect destination']);
  assert.match(source(selected, 'whois').uncertainty, /referrals.*resolved during collection/u);
});

test('IP and ASN disclosure does not invent a domain or a DNS question', () => {
  for (const targetType of ['ipv4', 'ipv6', 'asn'] as const) {
    const plan = buildLookupCollectionPreflight({ mode: 'fast', targetCount: 1, targetType });
    assert.deepEqual(plan.sources.map(value => value.id), ['rdap']);
    const data = plan.sources[0]!.inspection.data.join(' ');
    assert.match(data, targetType === 'asn' ? /Normalised ASN/u : /Normalised IP address/u);
    assert.doesNotMatch(data, /domain|DNS question/u);
  }
});

test('optional, disabled and unresolved capability states remain unrequested in disclosure', () => {
  const base = { mode: 'deep' as const, targetCount: 1 };
  for (const input of [base, { ...base, disabledSourceIds: ['external_intelligence'] }, { ...base, capabilities: null }]) {
    const source = buildLookupCollectionPreflight(input).sources.find(value => value.id === 'external_intelligence')!;
    assert.ok(['optional', 'disabled', 'unavailable'].includes(source.state));
    assert.match(source.inspection.status, /Not requested/u);
    assert.match(source.inspection.data.join(' '), /Registrable domain, not the full hostname or URL/u);
    assert.equal(source.inspection.offline, false, 'A source being unselected does not make its operation offline.');
  }
  const selected = buildLookupCollectionPreflight({ ...base, includeExternalIntelligence: true }).sources.find(value => value.id === 'external_intelligence')!;
  assert.match(selected.inspection.status, /Makes network requests/u);
});

test('feed disclosure separates local matching from configured-service search terms', () => {
  const local = describeLocalFeedDisclosure();
  assert.equal(local.offline, true);
  assert.match(local.recipients.join(' '), /No application-server, feed-service or candidate-target request/u);
  const remote = describeCollectionDisclosure('domain_feed_search', { state: 'included' });
  assert.equal(remote.offline, false);
  assert.deepEqual(remote.data, ['Selected feed identifiers, exact hostnames, positive and negative literal search terms']);
  assert.deepEqual(remote.recipients, ['Configured intelligence or feed service']);
  assert.doesNotMatch(remote.data.join(' '), /Brand Profile|Case identity/u);
  assert.match(remote.uncertainty, /unlisted scan is not private/u);
});

test('unknown collection metadata cannot silently become offline or private', () => {
  const unknown = describeCollectionDisclosure('future-unlisted-source');
  assert.equal(unknown.offline, false);
  assert.deepEqual(unknown.data, []);
  assert.deepEqual(unknown.recipients, []);
  assert.match(unknown.status, /unavailable.*no request is authorised/u);
  assert.match(unknown.uncertainty, /must not be treated as offline or private/u);
});
