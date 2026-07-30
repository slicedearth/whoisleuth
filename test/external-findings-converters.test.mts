import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EXTERNAL_FINDING_ROWS_SCHEMA,
  convertExternalFindingRows,
  convertExternalFindingsCsv,
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
});
