import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const COMPATIBILITY_FIXTURE_SHA256 = '1aaac0d0ee1379870d54e113b1e50764e92a0d4a99370fd4c27b72e2d7394fb4';

type LookupEvidenceV25Fixture = Readonly<{
  name: string;
  document: Record<string, unknown>;
}>;

export async function loadLookupEvidenceV25CompatibilityFixtures(): Promise<readonly LookupEvidenceV25Fixture[]> {
  const raw = await readFile(new URL('./fixtures/lookup-evidence-v25-compatibility.json', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(raw).digest('hex'), COMPATIBILITY_FIXTURE_SHA256);
  const parsed: unknown = JSON.parse(raw);
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  const cases = (parsed as { cases?: unknown }).cases;
  assert.ok(Array.isArray(cases));
  assert.deepEqual(cases.map((item) => (item as { name?: unknown }).name), [
    'fast-whois-skipped', 'unsupported-sources', 'source-errors', 'rdap-not-found',
  ]);
  return cases as LookupEvidenceV25Fixture[];
}
