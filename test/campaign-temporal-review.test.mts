import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCampaignTemporalExport,
  buildCampaignTemporalReview,
} from '../frontend/src/lib/analysis/campaign-temporal-review.ts';
import { openOrCreateCase, updateCase } from '../frontend/src/lib/analysis/case-model.ts';
import { LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../lib/evidence-export.mts';

describe('campaign temporal review', () => {
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
