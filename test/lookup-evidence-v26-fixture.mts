import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LOOKUP_EVIDENCE_V26_FIXTURE_SHA256 = '2b301ed8385b671873482015a9f489ec97b01724568e67e1f75b73bd3ad507bf';
const LOOKUP_EVIDENCE_V26_FIXTURE_URL = new URL('./fixtures/lookup-evidence-v26.json', import.meta.url);

async function loadLookupEvidenceV26Fixture(): Promise<string> {
  const raw = await readFile(fileURLToPath(LOOKUP_EVIDENCE_V26_FIXTURE_URL), 'utf8');
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== LOOKUP_EVIDENCE_V26_FIXTURE_SHA256) throw new Error('Frozen Lookup evidence v26 fixture changed.');
  return raw;
}

export {
  LOOKUP_EVIDENCE_V26_FIXTURE_SHA256,
  LOOKUP_EVIDENCE_V26_FIXTURE_URL,
  loadLookupEvidenceV26Fixture,
};
