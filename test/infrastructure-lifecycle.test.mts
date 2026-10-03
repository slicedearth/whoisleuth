import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { EXTERNAL_OBSERVATION_INTERCHANGE_LIFECYCLE_FAMILY as family, EXTERNAL_FINDINGS_SCHEMA, EXTERNAL_FINDINGS_VERSION, INFRASTRUCTURE_OBSERVATION_SCHEMA, INFRASTRUCTURE_COMPARISON_INPUT_SCHEMA, MAX_INFRASTRUCTURE_OBSERVATION_BYTES, MAX_INFRASTRUCTURE_COMPARISON_INPUT_BYTES } from '../packages/contracts/external-observation-interchange.mts';
import { parseExternalFindingsDocument, serializeExternalFindingsDocument } from '../packages/interchange/external-findings-import.mts';
import { convertExternalFindingRows, convertSupportedExternalFindings, convertInfrastructureObservation } from '../packages/interchange/external-findings-converters.mts';
import { readInfrastructureObservation, serialiseInfrastructureObservation } from '../packages/investigation/infrastructure-observation.mts';
import { buildOfflineEvidenceReview } from '../cli/offline-evidence-review.mts';

async function fixture(id: string) {
  const descriptor = family.fixtures.find(row => row.id === id);
  assert.ok(descriptor, id);
  const raw = await readFile(new URL(`../${descriptor.path}`, import.meta.url), 'utf8');
  return { descriptor, raw, value: JSON.parse(raw) as Record<string, unknown> };
}
test('infrastructure lifecycle fixtures retain immutable digests and supported historical findings bytes', async () => {
  for (const descriptor of family.fixtures) {
    const { raw, value } = await fixture(descriptor.id);
    assert.equal(Buffer.byteLength(raw), descriptor.bytes, descriptor.id);
    assert.equal(createHash('sha256').update(raw).digest('hex'), descriptor.sha256, descriptor.id);
    if (descriptor.schema === EXTERNAL_FINDINGS_SCHEMA) {
      assert.deepEqual(parseExternalFindingsDocument(value), value);
      if (descriptor.version === 4) { assert.equal(descriptor.role, 'historical'); assert.equal(parseExternalFindingsDocument(value).schemaVersion, 4); }
    }
  }
  assert.equal(EXTERNAL_FINDINGS_VERSION, 5);
  assert.equal(family.contracts.find(row => row.schema === EXTERNAL_FINDINGS_SCHEMA && row.version === 4)?.emitted, false);
  assert.equal(family.contracts.find(row => row.schema === EXTERNAL_FINDINGS_SCHEMA && row.version === 5)?.emitted, true);
});
test('typed version-1 row inputs emit current version-5 fixtures without rewriting historical outputs', async () => {
  for (const descriptor of family.fixtures.filter(row => row.expectedOutputFixtureId)) {
    const input = await fixture(descriptor.id), expected = await fixture(descriptor.expectedOutputFixtureId!);
    const converted = descriptor.id === 'external-finding-rows-v1' ? convertExternalFindingRows(input.value)
      : convertSupportedExternalFindings(input.value, descriptor.id === 'domain-observation-rows-v1' ? 'domain-observations-v1' : descriptor.id === 'dns-observation-rows-v1' ? 'dns-observations-v1' : 'certificate-observations-v1').document;
    assert.equal(converted.schemaVersion, 5);
    assert.deepEqual(converted, expected.value);
    assert.equal(serializeExternalFindingsDocument(converted), expected.raw);
  }
});
test('standalone snapshots and offline comparison inputs share exact lifecycle readers and bounds', async () => {
  const snapshot = await fixture('infrastructure-observation-v1'), findings = await fixture('external-findings-v5');
  assert.deepEqual(readInfrastructureObservation(snapshot.value), snapshot.value);
  assert.deepEqual(convertInfrastructureObservation(snapshot.value), findings.value);
  assert.equal(serializeExternalFindingsDocument(findings.value), findings.raw);
  assert.deepEqual(readInfrastructureObservation(JSON.parse(serialiseInfrastructureObservation(snapshot.value))), snapshot.value);
  const pair = await fixture('infrastructure-comparison-input-v1');
  const review = buildOfflineEvidenceReview(pair.raw, '2026-10-03T00:00:00.000Z');
  assert.equal(review.kind, 'infrastructure_comparison');
  assert.equal((review.result as { state: string }).state, 'compared');
  assert.ok(family.contracts.some(row => row.schema === INFRASTRUCTURE_OBSERVATION_SCHEMA && row.emitted));
  assert.ok(family.contracts.some(row => row.schema === INFRASTRUCTURE_COMPARISON_INPUT_SCHEMA && row.readable && !row.emitted));
  assert.throws(() => buildOfflineEvidenceReview({ ...pair.value, version: 2 }));
  assert.throws(() => buildOfflineEvidenceReview(snapshot.raw + ' '.repeat(MAX_INFRASTRUCTURE_OBSERVATION_BYTES)), /byte bound/u);
  assert.throws(() => buildOfflineEvidenceReview(pair.raw + ' '.repeat(MAX_INFRASTRUCTURE_COMPARISON_INPUT_BYTES)), /byte bound/u);
});
