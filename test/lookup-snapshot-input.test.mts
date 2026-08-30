import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLookupWebsiteSnapshot } from '../frontend/src/lib/analysis/lookup-snapshot-input.ts';
import type { PageBaseline } from '../frontend/src/lib/analysis/page-baseline.ts';

const DIGEST = 'a'.repeat(64);
const SIMHASH = 'b'.repeat(16);
const NOW = '2026-07-29T04:00:00.000Z';

const baseline: PageBaseline = {
  baselineVersion: 1,
  domain: 'snapshot.example',
  lookupDomain: 'snapshot.example',
  observedAt: NOW,
  pageIdentityVersion: 3,
  fingerprintVersion: 1,
  pageTitle: 'Snapshot',
  canonicalHost: 'snapshot.example',
  faviconHash: DIGEST,
  faviconPHash: SIMHASH,
  normalizedHtml: { algorithm: 'sha256', value: DIGEST, tokenCount: 10, truncated: false },
  visibleText: { algorithm: 'simhash64-v1', value: SIMHASH, tokenCount: 4, featureCount: 4, truncated: false },
  domStructure: { algorithm: 'sha256', value: DIGEST, nodeCount: 6, parser: 'static-tag-sequence-v1', truncated: false },
  formStructure: { algorithm: 'sha256', value: DIGEST, formCount: 1, controlCount: 2, truncated: false },
  resourceHosts: { algorithm: 'set-sha256', value: DIGEST, values: ['assets.snapshot.example'], truncated: false },
  trackingIdentifiers: { algorithm: 'set-sha256', value: DIGEST, values: [], truncated: false },
  complete: true,
  truncated: false,
};

test('builds the compact lookup snapshot behind a typed behavior-neutral facade', () => {
  const snapshot = buildLookupWebsiteSnapshot({
    id: 'snapshot-1',
    domain: 'snapshot.example',
    observedAt: NOW,
    savedAt: NOW,
    lookupEvidenceDepth: 'deep',
    technologyProfile: { profileVersion: 11, complete: true, truncated: false },
    securityPosture: { postureVersion: 2, complete: true, truncated: false },
    tlsEvidence: {
      source: 'tls',
      scanMode: 'deep',
      complete: true,
      truncated: false,
      certificate: {
        fingerprintSha256: 'c'.repeat(64),
        serialNumber: '00a1',
        validFrom: '2026-07-01T00:00:00.000Z',
        validTo: '2026-08-01T00:00:00.000Z',
        subject: { commonNames: ['snapshot.example'] },
        issuer: { commonNames: ['Fixture issuing authority'] },
        publicKey: { fingerprintSha256: 'd'.repeat(64) },
      },
      authorization: { authorized: true },
      hostname: { matches: true },
      validity: { status: 'valid' },
    },
    baseline,
    pageIdentity: {
      forms: { externalActionOrigins: ['https://forms.snapshot.example'] },
      publicationMetadata: { version: 1, marker: 'publication metadata must not persist' },
    },
    technologyFindings: [{ id: 'framework', name: 'Framework', category: 'framework', confidence: 'high', roles: ['framework_runtime'] }],
    securityPostureFindings: [{ id: 'transport', state: 'observed' }],
    diagnostics: {
      rdap: { status: 'success' },
      whois: { status: 'partial' },
      ignored: { status: 'not retained' },
    },
  });

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.truncated, false);
  assert.equal(snapshot.identity.normalizedHtml, DIGEST);
  assert.deepEqual(snapshot.identityValues, {
    resourceHosts: ['assets.snapshot.example'],
    trackingIdentifiers: [],
    formActionOrigins: ['https://forms.snapshot.example'],
  });
  assert.deepEqual(snapshot.sources, [
    { source: 'rdap', state: 'success' },
    { source: 'whois', state: 'partial' },
  ]);
  assert.deepEqual(snapshot.technologies, [
    { id: 'framework', name: 'Framework', category: 'framework', confidence: 'high', roles: ['framework_runtime'] },
  ]);
  assert.deepEqual(snapshot.profileProvenance, {
    technology: { version: 11, state: 'known' },
    securityPosture: { version: 2, state: 'known' },
  });
  assert.deepEqual(snapshot.certificate, {
    observationVersion: 1,
    source: 'tls',
    collectionDepth: 'deep',
    fingerprintSha256: 'c'.repeat(64),
    spkiFingerprintSha256: 'd'.repeat(64),
    issuer: 'Fixture issuing authority',
    subject: 'snapshot.example',
    serialNumber: '00a1',
    validFrom: '2026-07-01T00:00:00.000Z',
    validTo: '2026-08-01T00:00:00.000Z',
    authorized: true,
    hostnameMatches: true,
    validity: 'valid',
    complete: true,
    truncated: false,
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /publication metadata|deliveryMetadata/u);
});

test('keeps a fast or incomplete lookup snapshot explicitly partial', () => {
  const snapshot = buildLookupWebsiteSnapshot({
    id: 'snapshot-2',
    domain: 'snapshot.example',
    observedAt: NOW,
    savedAt: NOW,
    lookupEvidenceDepth: 'fast',
    technologyProfile: { complete: true, truncated: true },
    securityPosture: { complete: true },
    tlsEvidence: {},
    baseline,
    technologyFindings: [],
    securityPostureFindings: [],
    diagnostics: {},
  });
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.certificate, null);
});
