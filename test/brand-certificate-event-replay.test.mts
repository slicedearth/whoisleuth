import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildBrandCertificateEventReplay } from '../frontend/src/lib/analysis/brand-certificate-event-replay.ts';
import { normalizeBrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { createCase } from '../frontend/src/lib/analysis/case-model.ts';
import { requiredValue } from './value-assertions.mts';

const NOW = '2026-08-06T00:00:00.000Z';
const DIGEST = 'a'.repeat(64);
const EVENT_ID = 'b'.repeat(64);

function profile(expectedIssuer = 'Fixture issuer', patterns = ['official.example', '*.service.example']) {
  return requiredValue(normalizeBrandProfile({
    id: 'profile-fixture',
    name: 'Fixture profile',
    officialDomains: ['official.example'],
    desiredPostureBaselines: [{
      domain: 'official.example',
      tlsIssuer: expectedIssuer,
      tlsSanPatterns: patterns,
      tlsSpkiSha256: 'c'.repeat(64),
      updatedAt: NOW,
    }],
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

function eventCase(domain: string, overrides: Record<string, unknown> = {}) {
  return createCase({
    domain,
    source: 'import',
    evidencePin: {
      label: 'External certificate finding',
      value: DIGEST,
      field: 'certificateSha256',
      category: 'certificate',
      source: 'Deployment observation: Fixture feed',
      sourceSchema: { collection: 'external_observations', schema: 'whoisleuth.certificate-observation-rows', version: 1 },
      observedAt: NOW,
      completeness: 'complete',
      limitations: [],
      certificateObservation: {
        eventId: EVENT_ID,
        logId: 'fixture-log',
        certificateSha256: DIGEST,
        issuer: 'Fixture issuer',
        notAfter: '2026-12-01T00:00:00.000Z',
        dnsNameCount: 2,
        namesComplete: true,
        ...overrides,
      },
    },
  }, NOW);
}

describe('retained certificate expectation replay', () => {
  test('reconstructs retained names and reuses one-label wildcard semantics', () => {
    const replay = buildBrandCertificateEventReplay(profile(), [
      eventCase('official.example'),
      eventCase('mail.service.example'),
    ]);
    const event = requiredValue(replay.domains[0]?.events[0]);
    assert.equal(event.state, 'aligned');
    assert.deepEqual(event.names, ['mail.service.example', 'official.example']);
    assert.equal(event.namesComplete, true);
    assert.equal(event.clauses.find((item) => item.id === 'issuer')?.state, 'aligned');
    assert.equal(event.clauses.find((item) => item.id === 'san_patterns')?.state, 'aligned');
    assert.equal(event.clauses.some((item) => item.expected.includes('c'.repeat(64))), false);
  });

  test('keeps partial name sets indeterminate instead of treating omitted SANs as a mismatch', () => {
    const replay = buildBrandCertificateEventReplay(profile('Fixture issuer', ['missing.example']), [
      eventCase('official.example', { namesComplete: false, dnsNameCount: 4 }),
    ]);
    const event = requiredValue(replay.domains[0]?.events[0]);
    assert.equal(event.state, 'indeterminate');
    assert.equal(event.clauses.find((item) => item.id === 'san_patterns')?.state, 'indeterminate');
    assert.match(event.limitations.join(' '), /did not retain every certificate name/iu);
  });

  test('marks complete issuer or SAN differences for review without claiming improper issuance', () => {
    const replay = buildBrandCertificateEventReplay(profile('Different issuer', ['missing.example']), [
      eventCase('official.example'),
      eventCase('mail.service.example'),
    ]);
    const event = requiredValue(replay.domains[0]?.events[0]);
    assert.equal(event.state, 'review');
    assert.ok(event.clauses.every((item) => item.state === 'review'));
    assert.match(replay.limitations.join(' '), /not proof/iu);
  });

  test('ignores unrelated and malformed certificate pins and keeps missing evidence explicit', () => {
    const unrelated = eventCase('unrelated.example');
    const replay = buildBrandCertificateEventReplay(profile(), [unrelated]);
    assert.equal(replay.retainedEventCount, 0);
    assert.deepEqual(replay.domains[0]?.events, []);
    assert.equal(replay.domains[0]?.baselineConfigured, true);
  });
});
