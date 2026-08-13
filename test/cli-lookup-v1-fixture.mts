import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CLI_LOOKUP_V1_FIXTURE_SHA256 = '0e6601693e384b29285ead97b20947c3a464baf2521277901ff86ad5a6e3a59e';
const CLI_LOOKUP_V1_FIXTURE_URL = new URL('./fixtures/cli-lookup-v1.json', import.meta.url);

async function loadCliLookupV1Fixture(): Promise<string> {
  const raw = await readFile(fileURLToPath(CLI_LOOKUP_V1_FIXTURE_URL), 'utf8');
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== CLI_LOOKUP_V1_FIXTURE_SHA256) throw new Error('Frozen CLI Lookup v1 fixture changed.');
  return raw;
}

export { CLI_LOOKUP_V1_FIXTURE_SHA256, CLI_LOOKUP_V1_FIXTURE_URL, loadCliLookupV1Fixture };
