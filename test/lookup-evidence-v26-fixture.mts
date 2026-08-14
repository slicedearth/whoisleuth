import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LOOKUP_EVIDENCE_V26_FIXTURE_SHA256 = '59646a8e159225910d5e899f89269fc1e4628165d0ab41d4a141df6bb5624cd2';
const LOOKUP_EVIDENCE_V26_FIXTURE_URL = new URL('./fixtures/lookup-evidence-v26.json', import.meta.url);

async function loadLookupEvidenceV26Fixture(): Promise<string> {
  const file = await readFile(fileURLToPath(LOOKUP_EVIDENCE_V26_FIXTURE_URL), 'utf8');
  const raw = file.endsWith('\n') ? file.slice(0, -1) : file;
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== LOOKUP_EVIDENCE_V26_FIXTURE_SHA256) throw new Error('Frozen Lookup evidence v26 fixture changed.');
  return raw;
}

export {
  LOOKUP_EVIDENCE_V26_FIXTURE_SHA256,
  LOOKUP_EVIDENCE_V26_FIXTURE_URL,
  loadLookupEvidenceV26Fixture,
};
