import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCampaignTemporalExport,
  buildCampaignTemporalReview,
} from '../frontend/src/lib/analysis/campaign-temporal-review.ts';
import { openOrCreateCase, updateCase } from '../frontend/src/lib/analysis/case-model.ts';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../lib/evidence-export.mts';

describe('campaign temporal review', () => {
  test('colliding observation groups conserve caveats independently of pin order', async () => {
    const opened = openOrCreateCase([], { domain: 'alpha.example', source: 'lookup' }, '2026-08-01T00:00:00Z');
    let cases = opened.cases;
    for (const pin of [
      { field: 'dns.nameservers', value: 'ns1.alpha.example', completeness: 'partial' as const, truncated: true, limitations: ['Nameservers were truncated.'] },
      { field: 'dns.addresses', value: '192.0.2.1', completeness: 'complete' as const, truncated: false, limitations: ['One resolver observed.'] },
    ]) {
      cases = updateCase(cases, opened.record.id, { evidencePin: { ...pin, category: 'dns', label: pin.field,
        source: 'Fixture resolver', observedAt: '2026-07-21T00:00:00Z' } }, '2026-08-01T01:00:00Z').cases;
    }
    const review = buildCampaignTemporalReview(['alpha.example'], cases);
    const reversed = buildCampaignTemporalReview(['alpha.example'], cases.map(record => ({ ...record, evidencePins: [...record.evidencePins].reverse() })));
    assert.deepEqual(reversed, review);
    const event = review.events[0]!;
    assert.equal(event.observationCount, 1);
    assert.equal(event.completeness, 'partial');
    assert.equal(event.truncated, true);
    assert.deepEqual(event.limitations, ['Nameservers were truncated.', 'One resolver observed.']);
    const duplicate = buildCampaignTemporalReview(['alpha.example'], cases.map(record => ({ ...record, evidencePins: [...record.evidencePins, ...record.evidencePins] })));
    assert.deepEqual(duplicate, review);
    const exported = await buildCampaignTemporalExport({ id: 'campaign-1', name: 'Example review', domains: ['alpha.example'] }, review, '2026-08-02T00:00:00Z');
    assert.ok(JSON.stringify(exported).includes('Nameservers were truncated.'));
    assert.ok(JSON.stringify(exported).includes('One resolver observed.'));

    const record = cases[0]!;
    const pin = record.evidencePins[0]!;
    const sighting = { id: 'linked-sighting', state: 'analyst_confirmed' as const, sourceClass: 'analyst' as const,
      category: 'delegation' as const, source: pin.source, observedAt: pin.observedAt, completeness: 'complete' as const,
      evidencePinId: pin.id, limitations: ['Sighting used the same answer.'], createdAt: record.createdAt };
    const withSighting = buildCampaignTemporalReview(['alpha.example'], [{ ...record, sightings: [sighting] }]).events[0]!;
    assert.equal(withSighting.observationCount, 1);
    assert.equal(withSighting.truncated, true);
    assert.equal(withSighting.completeness, 'partial');
    assert.deepEqual(withSighting.limitations, ['Nameservers were truncated.', 'One resolver observed.', 'Sighting used the same answer.']);
    const distinct = buildCampaignTemporalReview(['alpha.example'], [{ ...record, evidencePins: [pin,
      { ...pin, id: 'later', observedAt: '2026-07-22T00:00:00.000Z' },
      { ...pin, id: 'source', source: 'Independent fixture resolver' },
      { ...pin, id: 'origin', sourceSchema: { collection: 'external_observations', schema: 'whoisleuth.dns-observation-rows', version: 1 } },
    ] }]).events[0]!;
    assert.equal(distinct.observationCount, 4);
    assert.deepEqual(distinct.origins, ['analyst', 'provider']);
  });

  test('keeps exact retained source families and unavailable members explicit', async () => {
    const opened = openOrCreateCase([], { domain: 'alpha.example', source: 'lookup' }, '2026-08-01T00:00:00Z');
    let cases = opened.cases;
    const inputs = [
      ['registration.created', 'registration', 'Creation publication', '2026-07-20T00:00:00Z', '2025-01-01'],
      ['dns.nameservers', 'dns', 'Nameservers', '2026-07-21T00:00:00Z', 'ns1.alpha.example'],
      ['dns.mx', 'dns', 'MX hosts', '2026-07-22T00:00:00Z', 'mail.alpha.example'],
      ['tls.issuer', 'tls', 'TLS issuer', '2026-07-23T00:00:00Z', 'Example issuer'],
      ['http.final_origin', 'http', 'Final website origin', '2026-07-24T00:00:00Z', 'https://alpha.example'],
    ] as const;
    for (const [field, category, label, observedAt, value] of inputs) {
      cases = updateCase(cases, opened.record.id, {
        evidencePin: {
          field,
          category,
          label,
          value,
          source: 'Lookup checkpoint',
          sourceSchema: { collection: 'lookup_result', schema: 'whoisleuth.lookup-evidence', version: LOOKUP_EVIDENCE_SCHEMA_VERSION },
          observedAt,
          completeness: 'complete',
        },
      }, '2026-08-01T01:00:00Z').cases;
    }
    cases = updateCase(cases, opened.record.id, {
      evidencePin: {
        field: 'dns.spf',
        category: 'dns',
        label: 'SPF publication',
        value: 'Not observed',
        source: 'Lookup checkpoint',
        sourceSchema: { collection: 'lookup_result', schema: 'whoisleuth.lookup-evidence', version: LOOKUP_EVIDENCE_SCHEMA_VERSION },
        observedAt: '2026-07-25T00:00:00Z',
        completeness: 'complete',
      },
    }, '2026-08-01T02:00:00Z').cases;
    cases = updateCase(cases, opened.record.id, {
      evidencePin: {
        field: 'certificateSha256',
        category: 'certificate',
        label: 'Imported certificate event',
        value: 'a'.repeat(64),
        source: 'Reviewed event fixture',
        sourceSchema: { collection: 'external_observations', schema: 'whoisleuth.certificate-observation-rows', version: 1 },
        observedAt: '2026-07-19T00:00:00Z',
        completeness: 'partial',
        truncated: true,
      },
    }, '2026-08-01T03:00:00Z').cases;

    const review = buildCampaignTemporalReview(['alpha.example', 'missing.example'], cases);
    assert.equal(review.memberCount, 2);
    assert.equal(review.linkedCaseCount, 1);
    assert.equal(review.unavailableCaseCount, 1);
    assert.deepEqual(Object.values(review.layerCounts), [1, 1, 1, 1, 1, 1]);
    assert.equal(review.events.find((item) => item.layer === 'ct')?.completeness, 'partial');
    assert.equal(review.events.find((item) => item.layer === 'ct')?.truncated, true);
    assert.equal(review.events.find((item) => item.layer === 'mail')?.observationCount, 1);
    assert.equal(review.layerCoverage.mail.unavailable, 1);
    assert.match(review.limitations.join(' '), /not global first-seen/u);

    const exported = await buildCampaignTemporalExport({ id: 'campaign-1', name: 'Example review', domains: ['alpha.example'] }, review, '2026-08-02T00:00:00Z');
    assert.equal(exported.schema, 'whoisleuth.campaign-temporal-review');
    assert.match(exported.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(exported), /Example issuer/u);
  });
});
