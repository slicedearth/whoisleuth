import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBulkPeerOutlierExport,
  buildBulkPeerOutlierMatrix,
  filterBulkPeerOutlierRows,
} from '../frontend/src/lib/analysis/bulk-peer-outliers.ts';
import type { ScanResult } from '../frontend/src/lib/analysis/bulk-result-model.ts';

function row(domain: string, overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    domain,
    status: 'complete',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Common Registrar',
    activity: 'active',
    risk: 10,
    opportunity: 0,
    mutationTypes: [],
    trusted: null,
    error: '',
    saved: {
      domain,
      capturedAt: '2026-07-31T00:00:00.000Z',
      source: 'lookup',
      scanDepth: 'deep',
      availability: 'registered',
      confidence: 'high',
      registrarName: 'Common Registrar',
      nameservers: ['ns1.example.test', 'ns2.example.test'],
      hasMx: true,
      hasNullMx: false,
      hasSpf: true,
      hasDmarc: true,
      faviconHash: 'a'.repeat(64),
      faviconPHash: null,
      riskModelVersion: 1,
      riskScore: 10,
      riskFactors: [],
      opportunityScore: 0,
      opportunityFactors: [],
      mutationTypes: [],
    },
    nameservers: ['ns1.example.test', 'ns2.example.test'],
    faviconHash: 'a'.repeat(64),
    faviconPHash: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: false,
    hasExternalFormAction: false,
    phishingLanguageMatch: null,
    registrant: null,
    abuseEvidence: null,
    ct: null,
    idn: null,
    dns: {
      status: 'success',
      records: {
        a: ['192.0.2.10'],
        aaaa: [],
        cname: [],
        caa: [],
      },
    },
    dnssec: 'signed',
    comparisonEvidence: {
      version: 1,
      technology: {
        state: 'success',
        ids: ['shop-platform', 'web-framework'],
        truncated: false,
      },
      tls: {
        state: 'success',
        issuerLabel: 'Common Issuing CA',
        spkiSha256: 'd'.repeat(64),
      },
    },
    relationship: {
      version: 2,
      nameservers: ['ns1.example.test', 'ns2.example.test'],
      ipAddresses: ['192.0.2.10'],
      trackingIdentifiers: ['google-analytics:G-COMMON'],
      officialAssetHosts: ['cdn.example.test'],
      faviconHash: 'a'.repeat(64),
      faviconPHash: null,
      certificateFingerprint: 'b'.repeat(64),
      truncated: false,
    },
    sourceCoverage: [
      { source: 'rdap', state: 'complete' },
      { source: 'dns', state: 'complete' },
    ],
    ...overrides,
  } as ScanResult;
}

test('peer outliers require a local majority and exclude unavailable values', () => {
  const rows = [
    row('one.example'),
    row('two.example'),
    row('three.example'),
    row('different.example', {
      registrar: 'Different Registrar',
      nameservers: ['ns9.example.test'],
      saved: {
        ...row('temporary.example').saved,
        registrarName: 'Different Registrar',
        nameservers: ['ns9.example.test'],
      },
    }),
    row('missing.example', {
      registrar: '',
      nameservers: [],
      saved: { ...row('temporary.example').saved, registrarName: '', nameservers: [] },
    }),
  ];
  const matrix = buildBulkPeerOutlierMatrix(rows);
  const different = matrix.rows.find((item) => item.domain === 'different.example');
  assert.ok(different?.findings.some((finding) => finding.dimension === 'registrar'));
  assert.ok(different?.findings.some((finding) => finding.dimension === 'nameserver_set'));
  assert.equal(matrix.rows.some((item) => item.domain === 'missing.example'), false);
  assert.equal(matrix.dimensions.find((item) => item.id === 'registrar')?.excludedCount, 1);
});

test('small or fragmented cohorts do not manufacture outliers', () => {
  assert.equal(buildBulkPeerOutlierMatrix([row('one.example'), row('two.example')]).rows.length, 0);
  const fragmented = buildBulkPeerOutlierMatrix([
    row('one.example', { registrar: 'Registrar One' }),
    row('two.example', { registrar: 'Registrar Two' }),
    row('three.example', { registrar: 'Registrar Three' }),
  ]);
  assert.equal(fragmented.rows.some((item) => item.findings.some((finding) => finding.dimension === 'registrar')), false);
});

test('peer outliers compare bounded relationship evidence without adding collection', () => {
  const rows = [
    row('one.example'),
    row('two.example'),
    row('three.example'),
    row('different.example', {
      comparisonEvidence: {
        version: 1,
        technology: { state: 'success', ids: ['different-platform'], truncated: false },
        tls: {
          state: 'success',
          issuerLabel: 'Different Issuing CA',
          spkiSha256: 'e'.repeat(64),
        },
      },
      relationship: {
        ...row('temporary.example').relationship,
        trackingIdentifiers: ['google-analytics:G-DIFFERENT'],
        officialAssetHosts: ['assets.different.example'],
        certificateFingerprint: 'c'.repeat(64),
      },
    }),
    row('unavailable.example', {
      relationship: {
        ...row('temporary.example').relationship,
        trackingIdentifiers: [],
        officialAssetHosts: [],
        certificateFingerprint: null,
      },
    }),
  ];
  const matrix = buildBulkPeerOutlierMatrix(rows);
  const different = matrix.rows.find((item) => item.domain === 'different.example');
  assert.ok(different?.findings.some((finding) => finding.dimension === 'tracking_identifier_set'));
  assert.ok(different?.findings.some((finding) => finding.dimension === 'official_asset_host_set'));
  assert.ok(different?.findings.some((finding) => finding.dimension === 'certificate_fingerprint'));
  assert.ok(different?.findings.some((finding) => finding.dimension === 'technology_set'));
  assert.ok(different?.findings.some((finding) => finding.dimension === 'tls_issuer'));
  assert.ok(different?.findings.some((finding) => finding.dimension === 'tls_spki'));
  assert.equal(matrix.dimensions.find((item) => item.id === 'certificate_fingerprint')?.excludedCount, 1);
});

test('outlier export is formula-safe and includes the local baseline', () => {
  const matrix = buildBulkPeerOutlierMatrix([
    row('one.example'),
    row('two.example'),
    row('three.example'),
    row('=different.example', { registrar: 'Different Registrar' }),
  ]);
  const output = buildBulkPeerOutlierExport(matrix, '2026-07-31T00:00:00.000Z');
  assert.match(output.filename, /2026-07-31/u);
  assert.match(output.content, /cohort_baseline/u);
  assert.doesNotMatch(output.content, /^=different/u);
});

test('peer outlier rows filter by bounded domain, evidence, and dimension values', () => {
  const matrix = buildBulkPeerOutlierMatrix([
    row('one.example'),
    row('two.example'),
    row('three.example'),
    row('different.example', {
      registrar: 'Different Registrar',
      nameservers: ['ns9.example.test'],
      saved: {
        ...row('temporary.example').saved,
        registrarName: 'Different Registrar',
        nameservers: ['ns9.example.test'],
      },
    }),
  ]);

  assert.deepEqual(filterBulkPeerOutlierRows(matrix, 'different.example').map((item) => item.domain), ['different.example']);
  assert.deepEqual(filterBulkPeerOutlierRows(matrix, 'ns9.example.test').map((item) => item.domain), ['different.example']);
  assert.deepEqual(
    filterBulkPeerOutlierRows(matrix, '', 'registrar')[0]?.findings.map((finding) => finding.dimension),
    ['registrar'],
  );
  assert.equal(filterBulkPeerOutlierRows(matrix, '', 'technology_set').length, 0);
  assert.deepEqual(filterBulkPeerOutlierRows(matrix, '', 'unsupported'), matrix.rows);
});

test('peer outlier filtering is non-mutating and removes control characters before matching', () => {
  const matrix = buildBulkPeerOutlierMatrix([
    row('one.example'),
    row('two.example'),
    row('three.example'),
    row('different.example', { registrar: 'Different Registrar' }),
  ]);
  const before = structuredClone(matrix);
  assert.deepEqual(filterBulkPeerOutlierRows(matrix, 'different\u0000.example'), []);
  assert.deepEqual(matrix, before);
});
