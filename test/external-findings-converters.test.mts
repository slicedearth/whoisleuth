import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EXTERNAL_FINDING_ROWS_SCHEMA,
  CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
  DNS_OBSERVATION_ROWS_SCHEMA,
  DOMAIN_OBSERVATION_ROWS_SCHEMA,
  convertExternalFindingRows,
  convertExternalFindingsCsv,
  convertSupportedExternalFindings,
} from '../frontend/src/lib/analysis/external-findings-converters.ts';

const observedAt = '2026-07-01T00:00:00.000Z';

describe('external findings converters', () => {
  test('converts a bounded generic JSON row document through the strict findings parser', () => {
    const document = convertExternalFindingRows({
      schema: EXTERNAL_FINDING_ROWS_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Reviewed local tool' },
      rows: [{
        domain: 'Example.Test',
        category: 'dns',
        summary: 'An externally collected DNS observation.',
        observed_at: observedAt,
        completeness: 'partial',
        limitation: 'One source was unavailable.',
        reference: '',
      }],
    });
    assert.equal(document.source.name, 'Reviewed local tool');
    assert.equal(document.findings[0]?.domain, 'example.test');
    assert.deepEqual(document.findings[0]?.limitations, ['One source was unavailable.']);
  });

  test('converts quoted fixed-column CSV without treating formulas as executable', () => {
    const document = convertExternalFindingsCsv([
      'domain,category,summary,observed_at,completeness,limitation,reference',
      `example.test,http,"=not executed, retained as text",${observedAt},unknown,"Review, do not infer",`,
    ].join('\n'));
    assert.equal(document.findings[0]?.summary, '=not executed, retained as text');
    assert.equal(document.findings[0]?.completeness, 'unknown');
  });

  test('rejects unknown CSV layouts', () => {
    assert.throws(
      () => convertExternalFindingsCsv('domain,summary\nexample.test,Observed'),
      /CSV header must be/,
    );
  });

  test('converts documented domain observations with an explicit review summary', () => {
    const report = convertSupportedExternalFindings({
      schema: DOMAIN_OBSERVATION_ROWS_SCHEMA,
      schemaVersion: 1,
      source: { name: 'Reviewed domain inventory' },
      observations: [
        { domain: 'Example.Test', source: 'Local inventory', status: 'registered', observedAt, completeness: 'complete' },
        { domain: 'Example.Test', source: 'Local inventory', status: 'registered', observedAt, completeness: 'complete' },
        { domain: 'bad value', source: '', status: '', observedAt: 'invalid' },
      ],
    }, 'domain-observations-v1');
    assert.equal(report.document.findings[0]?.domain, 'example.test');
    assert.equal(report.accepted, 1);
    assert.equal(report.duplicates, 1);
    assert.equal(report.rejected, 1);
    assert.equal(report.truncated, false);
    assert.deepEqual(report.exclusions, [{ row: 3, reason: 'Malformed or unsupported row.' }]);
  });

  test('converts only supported DNS types and keeps record data bounded', () => {
    const report = convertSupportedExternalFindings({
      schema: DNS_OBSERVATION_ROWS_SCHEMA,
      schemaVersion: 1,
      observations: [
        { domain: 'example.test', type: 'A', value: '192.0.2.10', observedAt, completeness: 'partial' },
        { domain: 'example.test', type: 'FUTURE', value: 'discarded', observedAt },
      ],
    }, 'dns-observations-v1');
    assert.equal(report.document.findings[0]?.category, 'dns');
    assert.match(report.document.findings[0]?.summary || '', /192\.0\.2\.10/u);
    assert.equal(report.rejected, 1);
  });

  test('requires a SHA-256 fingerprint for documented certificate observations', () => {
    const report = convertSupportedExternalFindings({
      schema: CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
      schemaVersion: 1,
      observations: [
        {
          domain: 'example.test',
          fingerprintSha256: 'A'.repeat(64),
          issuer: 'Example issuing CA',
          notAfter: '2027-01-01T00:00:00Z',
          observedAt,
          completeness: 'complete',
        },
        { domain: 'example.test', fingerprintSha256: 'short', observedAt },
      ],
    }, 'certificate-observations-v1');
    assert.equal(report.document.findings[0]?.category, 'certificate');
    assert.match(report.document.findings[0]?.summary || '', new RegExp('a'.repeat(64), 'u'));
    assert.equal(report.rejected, 1);
  });
});
