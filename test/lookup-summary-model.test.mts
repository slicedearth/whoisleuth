import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLookupSummaryModel } from '../frontend/src/lib/analysis/lookup-summary-model.ts';
import { buildRegistrarStanding } from '../lib/registrar-standing.mts';

test('builds bounded assessment signals and separately attributed diagnostics', () => {
  const summary = buildLookupSummaryModel({
    availability: {
      state: 'registered',
      confidence: 'high',
      registrar: { name: 'Example Registrar' },
      domainAgeDays: 4,
      expiresInDays: 40,
      privacyProtected: true,
      activityStatus: 'active',
      websiteProbeDetail: 'HTTPS content responded.',
      source: 'rdap',
      hasMx: true,
      hasSpf: false,
      hasDmarc: false,
      phishingLanguageMatch: 'Verify your account',
    },
    profileSignals: {
      faviconNearMatch: true,
      reusesOfficialAssets: true,
    },
    idnAnalysis: {
      mixedScript: true,
      referenceMatches: [{ domain: 'reference.example.test' }],
    },
    rdapParsed: {
      conformance: ['rdap_level_0'],
      serverTruncated: true,
      serverTruncationReasons: ['privacy policy'],
    },
    whoisParsed: {},
    registrarRdap: {
      status: 'success',
      endpoint: 'https://registrar-rdap.example.test',
      parsed: { conformance: ['rdap_level_0'] },
    },
    registrarStanding: buildRegistrarStanding({
      registrarIanaId: '4318',
      now: new Date('2026-09-03T12:00:00.000Z'),
    }),
    registryComparison: {
      fields: [{
        label: 'Registrar',
        status: 'conflict',
        assessment: 'The registry and WHOIS publications differ.',
      }],
    },
    diagnostics: {
      rdap: {
        status: 'success',
        endpoint: 'https://rdap.example.test',
        fetchedAt: '2026-03-02T03:04:05.000Z',
        attempts: [{
          endpoint: 'https://rdap.example.test',
          outcome: 'success',
          status: 200,
        }],
        registrar: { status: 'success', endpoint: 'https://registrar-rdap.example.test' },
      },
      whois: { status: 'partial', attempts: [{ outcome: 'timeout' }, { outcome: 'success' }] },
      availability: { status: 'success' },
      reverseDns: { status: 'not_found' },
    },
    createdDate: '2026-01-02T03:04:05.000Z',
    expiresDate: '2027-01-02T03:04:05.000Z',
    updatedDate: '2026-02-02T03:04:05.000Z',
  });

  assert.equal(summary.facts.find((fact) => fact.label === 'Registration')?.value, 'registered');
  assert.equal(summary.facts.find((fact) => fact.label === 'Registrar')?.value, 'Example Registrar');
  assert.deepEqual(
    summary.facts.find((fact) => fact.label === 'Registration')?.provenance.sources,
    ['Registry RDAP'],
  );
  assert.match(
    summary.facts.find((fact) => fact.label === 'Registrar')?.provenance.conflicts[0] || '',
    /publications differ/u,
  );
  assert.ok(summary.signals.some((signal) => signal.label === 'Favicon near-match' && signal.tone === 'warn'));
  assert.ok(summary.signals.some((signal) => signal.label === 'Mixed-script IDN' && signal.tone === 'warn'));
  assert.ok(summary.signals.some((signal) => signal.label === 'Privacy protected' && signal.tone === 'neutral'));
  assert.ok(summary.signals.some((signal) => signal.label.includes('Active') && signal.tone === 'neutral'));
  assert.ok(summary.signals.some((signal) => signal.label === 'Official termination notice found' && signal.tone === 'warn'));
  assert.match(
    summary.signals.find((signal) => signal.label === 'Official termination notice found')?.detail || '',
    /does not classify this domain/u,
  );
  assert.equal(summary.diagnostics.find((item) => item.source === 'whois')?.label, 'partial');
  assert.match(summary.diagnostics.find((item) => item.source === 'whois')?.detail || '', /attempts: timeout → success/u);
  assert.deepEqual(summary.diagnostics[0]?.conformance, ['rdap_level_0']);
  assert.equal(summary.diagnostics[0]?.attempts[0]?.outcome, 'success');
  assert.ok(summary.diagnostics.some((item) => item.source === 'registrar RDAP'));
  assert.equal(summary.diagnostics.at(-1)?.source, 'reverse DNS');
});

test('bounds hostile strings and preserves unknown source states', () => {
  const summary = buildLookupSummaryModel({
    availability: {
      state: `unknown\u0000${'x'.repeat(800)}`,
      confidence: '',
    },
    diagnostics: {
      rdap: { endpoint: `https://rdap.example.test/${'x'.repeat(4_000)}` },
      whois: {},
      availability: {},
    },
  });

  assert.ok((summary.facts[0]?.value.length || 0) <= 320);
  assert.ok((summary.facts[0]?.provenance.normalization.length || 0) <= 320);
  assert.equal(summary.diagnostics.map((item) => item.label).join(','), 'unknown,unknown,unknown');
  assert.ok((summary.diagnostics[0]?.detail.length || 0) <= 2_400);
  assert.equal(summary.signals.length, 0);
});
