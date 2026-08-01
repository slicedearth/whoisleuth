import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cliCsvCell } from '../cli/csv.mts';

describe('CLI CSV cells', () => {
  test('neutralizes spreadsheet formulas after bounded text normalization', () => {
    assert.equal(cliCsvCell('=HYPERLINK("https://example.invalid")'), `"'=HYPERLINK(""https://example.invalid"")"`);
    assert.equal(cliCsvCell('  @SUM(A1:A2)'), "'@SUM(A1:A2)");
    assert.equal(cliCsvCell('\t+1'), "'+1");
    assert.equal(cliCsvCell('-2+3'), "'-2+3");
  });

  test('quotes delimiters and preserves ordinary bounded list output', () => {
    assert.equal(cliCsvCell('ordinary value'), 'ordinary value');
    assert.equal(cliCsvCell('one,"two"'), '"one,""two"""');
    assert.equal(cliCsvCell(['one', 'two']), 'one | two');
    assert.equal(cliCsvCell(null), '');
  });
});
