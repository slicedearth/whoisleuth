import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { LATEST_PUBLIC_APPLICATION_VERSION } from '../packages/contracts/case-portability.mts';

async function documentation(pathname: string): Promise<string> {
  return readFile(new URL(`../${pathname}`, import.meta.url), 'utf8');
}

test('local production instructions explicitly load development-only credentials and preserve injected environments', async () => {
  const guide = await documentation('docs/getting-started.md');
  assert.match(guide, /node --env-file=\.env\.local server\.mts/u);
  assert.match(guide, /does not load\s+`\.env\.local`/u);
  const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-env-file-test-'));
  try {
    const file = path.join(directory, '.env.local');
    await writeFile(file, 'SITE_PASSWORD=fixture-only-password\nSESSION_SECRET=fixture-only-signing-secret\n', { mode: 0o600 });
    const env = { ...process.env };
    delete env.SITE_PASSWORD;
    delete env.SESSION_SECRET;
    const script = `import { checkPassword } from ${JSON.stringify(new URL('../lib/auth.mts', import.meta.url).href)}; process.stdout.write(String(checkPassword('fixture-only-password')));`;
    for (const [argumentsValue, environment, expected] of [
      [[`--env-file=${file}`], env, 'true'],
      [[], env, 'false'],
      [[], { ...env, SITE_PASSWORD: 'fixture-only-password', SESSION_SECRET: 'fixture-only-signing-secret' }, 'true'],
    ] as const) {
      const result = spawnSync(process.execPath, [...argumentsValue, '--input-type=module', '-e', script], { env: environment, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
