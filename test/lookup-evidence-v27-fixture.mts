import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LOOKUP_EVIDENCE_V27_FIXTURE_SHA256 = 'd8dcba4da5f99c0dd56643cc0bab5df8495169fd7d0dbf61ca8674ea257f2b50';
const LOOKUP_EVIDENCE_V27_FIXTURE_URL = new URL('./fixtures/lookup-evidence-v27.json', import.meta.url);

async function loadLookupEvidenceV27Fixture(): Promise<string> {
  const file = await readFile(fileURLToPath(LOOKUP_EVIDENCE_V27_FIXTURE_URL), 'utf8');
  const raw = file.endsWith('\n') ? file.slice(0, -1) : file;
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== LOOKUP_EVIDENCE_V27_FIXTURE_SHA256) throw new Error('Frozen Lookup evidence v27 fixture changed.');
  return raw;
}

export {
  LOOKUP_EVIDENCE_V27_FIXTURE_SHA256,
  LOOKUP_EVIDENCE_V27_FIXTURE_URL,
  loadLookupEvidenceV27Fixture,
};
