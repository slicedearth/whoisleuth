import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  CASE_PORTABILITY_LIFECYCLE_FAMILY,
  CLI_CASE_PACK_CASE_REPORT_EPOCHS,
} from '../packages/contracts/case-portability.mts';
import { buildCaseContractDocumentation } from '../tools/case-contract-doc.mts';

test('Case compatibility documentation is generated exactly from the canonical lifecycle family', async () => {
  const expected = buildCaseContractDocumentation();
  const actual = await readFile(new URL('../docs/case-contracts.md', import.meta.url), 'utf8');
  assert.equal(actual, expected);
  assert.equal(
    actual.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---')).length,
    CASE_PORTABILITY_LIFECYCLE_FAMILY.compatibility.length
      + CLI_CASE_PACK_CASE_REPORT_EPOCHS.length
      + 2,
  );
});
