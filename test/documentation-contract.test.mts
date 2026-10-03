import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { LATEST_PUBLIC_APPLICATION_VERSION } from '../packages/contracts/case-portability.mts';

async function documentation(pathname: string): Promise<string> {
  return readFile(new URL(`../${pathname}`, import.meta.url), 'utf8');
}

test('critical profiles and the canonical compatibility reference identify current writers', async () => {
  const [readme, productBoundary, registryContract, portableContracts, caseContracts] = await Promise.all([
    documentation('README.md'),
    documentation('docs/product-boundary.md'),
    documentation('docs/registry-data-contract.md'),
    documentation('docs/portable-domain-contracts.md'),
    documentation('docs/case-contracts.md'),
  ]);

  assert.match(registryContract, /lookup-child-profile-contract\.mts/u);
  assert.match(registryContract, /lookup-network-evidence-bounds\.mts/u);

  const publicVersion = LATEST_PUBLIC_APPLICATION_VERSION.replaceAll('.', '\\.');
  assert.match(readme, /\]\(docs\/case-contracts\.md\)/u);
  assert.match(productBoundary, /\]\(case-contracts\.md\)/u);
  assert.match(portableContracts, /\]\(case-contracts\.md\)/u);
  assert.match(caseContracts, new RegExp(`published format checkpoint is release ${publicVersion}`, 'u'));
  assert.match(caseContracts, /current writer emits/u);
  assert.doesNotMatch(productBoundary, /Once v2 is public/iu);
});
