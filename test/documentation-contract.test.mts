import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { WHOISLEUTH_APPLICATION_VERSION } from '../lib/application-version.mts';
import { TECHNOLOGY_PROFILE_VERSION } from '../lib/lookup-child-profile-contract.mts';
import { TLS_PROFILE_VERSION } from '../lib/lookup-network-evidence-bounds.mts';

async function documentation(pathname: string): Promise<string> {
  return readFile(new URL(`../${pathname}`, import.meta.url), 'utf8');
}

test('critical current profile and public-writer statements follow canonical version owners', async () => {
  const [readme, productBoundary, registryContract, portableContracts, caseContracts] = await Promise.all([
    documentation('README.md'),
    documentation('docs/product-boundary.md'),
    documentation('docs/registry-data-contract.md'),
    documentation('docs/portable-domain-contracts.md'),
    documentation('docs/case-contracts.md'),
  ]);

  assert.match(
    registryContract,
    new RegExp(`Current profile version ${TECHNOLOGY_PROFILE_VERSION}\\b`, 'u'),
  );
  assert.match(
    registryContract,
    new RegExp(`current deep TLS profile, version ${TLS_PROFILE_VERSION}\\b`, 'u'),
  );
  assert.match(registryContract, /lookup-child-profile-contract\.mts/u);
  assert.match(registryContract, /lookup-network-evidence-bounds\.mts/u);
  assert.equal((registryContract.match(/Current profile version/gu) ?? []).length, 1);

  const applicationVersion = WHOISLEUTH_APPLICATION_VERSION.replaceAll('.', '\\.');
  const publicWriter = new RegExp(`(?:[Pp]ublic release|[Rr]elease|[Aa]pplication release) ${applicationVersion}[^\\n]*current public writer`, 'u');
  assert.match(readme, publicWriter);
  assert.match(productBoundary, publicWriter);
  assert.match(portableContracts, publicWriter);
  assert.match(caseContracts, new RegExp(`Release ${applicationVersion} is the latest public writer`, 'u'));
  assert.doesNotMatch(productBoundary, /Once v2 is public/iu);
});
