import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { TECHNOLOGY_PROFILE_VERSION } from '../lib/lookup-child-profile-contract.mts';
import { TLS_PROFILE_VERSION } from '../lib/lookup-network-evidence-bounds.mts';
import { WHOISLEUTH_APPLICATION_VERSION } from '../lib/application-version.mts';
import { LATEST_PUBLIC_APPLICATION_VERSION } from '../packages/contracts/case-portability.mts';

async function documentation(pathname: string): Promise<string> {
  return readFile(new URL(`../${pathname}`, import.meta.url), 'utf8');
}

test('critical current profile and release-writer statements follow canonical version owners', async () => {
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

  const currentVersion = WHOISLEUTH_APPLICATION_VERSION.replaceAll('.', '\\.');
  const publicVersion = LATEST_PUBLIC_APPLICATION_VERSION.replaceAll('.', '\\.');
  const checkoutWriter = new RegExp(`Version ${currentVersion} is the current writer in this\\s+checkout`, 'u');
  const publishedBoundary = new RegExp(`published by release ${publicVersion}`, 'u');
  assert.match(readme, checkoutWriter);
  assert.match(readme, publishedBoundary);
  assert.match(productBoundary, checkoutWriter);
  assert.match(productBoundary, publishedBoundary);
  assert.match(portableContracts, checkoutWriter);
  assert.match(portableContracts, publishedBoundary);
  assert.match(caseContracts, new RegExp(`Release ${publicVersion} is the immediately preceding public writer`, 'u'));
  assert.match(caseContracts, checkoutWriter);
  assert.doesNotMatch(productBoundary, /Once v2 is public/iu);
});
