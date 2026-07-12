const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let ctCsvFields;
let CT_HOSTNAME_CSV_DELIMITER;
let rowsToCsv;
let toCsvValue;
before(async () => {
  const exportMod = await import('../frontend/src/lib/analysis/bulk-export.js');
  ctCsvFields = exportMod.ctCsvFields;
  CT_HOSTNAME_CSV_DELIMITER = exportMod.CT_HOSTNAME_CSV_DELIMITER;
  const utils = await import('../frontend/src/lib/analysis/utils.js');
  rowsToCsv = utils.rowsToCsv;
  toCsvValue = utils.toCsvValue;
});

describe('ctCsvFields', () => {
  test('populated CT provenance maps to the four columns', () => {
    const fields = ctCsvFields({
      firstObservedAt: '2026-01-01T00:00:00.000Z',
      lastObservedAt: '2026-06-01T00:00:00.000Z',
      certificateCount: 3,
      hostnames: ['a.example.com', 'b.example.com'],
    });
    assert.deepStrictEqual(fields, [
      '2026-01-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      '3',
      `a.example.com${CT_HOSTNAME_CSV_DELIMITER}b.example.com`,
    ]);
  });

  test('ordinary (non-CT) rows produce four empty fields', () => {
    assert.deepStrictEqual(ctCsvFields(null), ['', '', '', '']);
    assert.deepStrictEqual(ctCsvFields(undefined), ['', '', '', '']);
  });

  test('hostnames use the documented delimiter', () => {
    const fields = ctCsvFields({ hostnames: ['x.example.com', 'y.example.com', 'z.example.com'], certificateCount: 0 });
    assert.equal(fields[3], ['x.example.com', 'y.example.com', 'z.example.com'].join(CT_HOSTNAME_CSV_DELIMITER));
    assert.equal(CT_HOSTNAME_CSV_DELIMITER, '|');
  });

  test('zero certificate count is emitted as 0, missing count as empty', () => {
    assert.equal(ctCsvFields({ certificateCount: 0, hostnames: [] })[2], '0');
    assert.equal(ctCsvFields({ hostnames: [] })[2], '');
  });

  test('CT fields stay formula-neutral through the shared CSV helper', () => {
    // A hostile hostname beginning with a formula trigger must be neutralized
    // when routed through the same toCsvValue the export uses.
    const fields = ctCsvFields({ hostnames: ['=cmd.example.com', 'safe.example.com'], certificateCount: 1 });
    const line = rowsToCsv([fields]);
    // The pipe-joined hostname cell starts with '=', so the shared helper must
    // prepend the neutralizing quote (a pipe alone does not force CSV quoting).
    assert.ok(line.includes(`'=cmd.example.com${CT_HOSTNAME_CSV_DELIMITER}safe.example.com`));
    assert.ok(!line.includes('\n=cmd') && !line.startsWith('=cmd'));
    assert.equal(toCsvValue('=danger'), "'=danger");
  });
});
