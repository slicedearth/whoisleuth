import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageRegionPaintRectangles, MAX_EVIDENCE_IMAGE_PIXELS, MAX_EVIDENCE_IMAGE_REGIONS, readEvidenceImageDimensions, readImageDerivation, readImageRegionPlan } from '../packages/evidence/image-regions.mts';
import { addCaseAttachments, assertDerivedCaseAttachmentSource, readCaseAttachment } from '../packages/cases/case-attachment-model.mts';
import { createCase, normalizeCaseStore, projectCaseForAudience, serializeCaseStore } from '../packages/cases/case-model.mts';

const region = { kind: 'redact', x: 2, y: 3, width: 5, height: 6 } as const;
const plan = { width: 20, height: 20, regions: [region] };
const now = '2026-09-13T00:00:00.000Z';
const source = readCaseAttachment({ id: 'source-one', fileName: 'private-source.png', mediaType: 'image/png', source: 'Private selected observation', observedAt: null,
  retainedAt: now, digestSha256: `sha256:${'a'.repeat(64)}`, byteLength: 100 });
const derivation = { method: 'png-regions-v1', sourceAttachmentId: source.id, source: { digestSha256: source.digestSha256, byteLength: source.byteLength }, plan };
const derivative = readCaseAttachment({ ...source, id: 'derived-one', fileName: 'private-derived.png', byteLength: 110, digestSha256: `sha256:${'b'.repeat(64)}`, derivation });

test('decoded dimensions admit the exact pixel bound and reject unsafe work before rendering', () => {
  assert.deepEqual(readEvidenceImageDimensions(4096, 4096), { width: 4096, height: 4096 });
  assert.equal(4096 * 4096, MAX_EVIDENCE_IMAGE_PIXELS);
  for (const [width, height] of [[4096, 4097], [10_001, 1], [0, 1], [-1, 1], [1.5, 1], [Infinity, 1]]) assert.throws(() => readEvidenceImageDimensions(width, height));
});

test('region admission is detached, strict, finite and does not clamp invalid coordinates', () => {
  const input = { ...plan, regions: plan.regions.map(item => ({ ...item, x: Number(item.x) })) };
  const admitted = readImageRegionPlan(input);
  input.regions[0]!.x = 5;
  assert.deepEqual(admitted, plan);
  assert.ok(Object.isFrozen(admitted.regions[0]));
  assert.equal(readImageRegionPlan({ ...plan, regions: Array.from({ length: MAX_EVIDENCE_IMAGE_REGIONS }, () => region) }).regions.length, MAX_EVIDENCE_IMAGE_REGIONS);
  for (const value of [
    { ...plan, regions: [] }, { ...plan, regions: new Array(1) }, { ...plan, regions: Array.from({ length: MAX_EVIDENCE_IMAGE_REGIONS + 1 }, () => region) },
    { ...plan, extra: true }, { ...plan, regions: [{ ...region, x: -1 }] }, { ...plan, regions: [{ ...region, y: 20 }] },
    { ...plan, regions: [{ ...region, width: 19 }] }, { ...plan, regions: [{ ...region, height: 0 }] },
    { ...plan, regions: [{ ...region, x: 1.2 }] }, { ...plan, regions: [{ ...region, kind: 'blur' }] },
    { ...plan, regions: [{ ...region, colour: 'transparent' }] },
  ]) assert.throws(() => readImageRegionPlan(value));
});

test('opaque rectangle instructions cover every selected pixel and keep annotations under redactions', () => {
  assert.deepEqual(imageRegionPaintRectangles(plan), [{ x: 2, y: 3, width: 5, height: 6, colour: '#000000' }]);
  const commands = imageRegionPaintRectangles({ width: 20, height: 20, regions: [region, { kind: 'outline', x: 1, y: 1, width: 12, height: 10 }] });
  assert.deepEqual(commands, [
    { x: 1, y: 1, width: 12, height: 3, colour: '#ffbf00' },
    { x: 1, y: 8, width: 12, height: 3, colour: '#ffbf00' },
    { x: 1, y: 1, width: 3, height: 10, colour: '#ffbf00' },
    { x: 10, y: 1, width: 3, height: 10, colour: '#ffbf00' },
    { x: 2, y: 3, width: 5, height: 6, colour: '#000000' },
  ]);
  const edge = imageRegionPaintRectangles({ width: 1, height: 1, regions: [{ kind: 'outline', x: 0, y: 0, width: 1, height: 1 }] });
  assert.equal(edge.length, 4);
  assert.ok(edge.every(item => item.x === 0 && item.y === 0 && item.width === 1 && item.height === 1));
});

test('a derivative has independent bytes and lineage without claiming a new observation', () => {
  assert.deepEqual(readImageDerivation(derivation), derivation);
  const record = addCaseAttachments(createCase({ domain: 'image-review.example' }, now), [source], now);
  assert.doesNotThrow(() => assertDerivedCaseAttachmentSource(record, derivative));
  const updated = addCaseAttachments(record, [derivative], now);
  assert.deepEqual(updated.attachments?.[0], source);
  assert.equal(updated.attachments?.[1]?.observedAt, null);
  assert.equal(updated.attachments?.[1]?.source, source.source);
  assert.deepEqual(normalizeCaseStore(JSON.parse(serializeCaseStore([updated]))).cases[0]?.attachments, [source, derivative]);
  for (const audience of ['public', 'trusted'] as const) {
    const output = JSON.stringify(projectCaseForAudience(updated, audience));
    for (const secret of ['private-source', 'private-derived', 'Private selected observation', 'source-one', 'derived-one', source.digestSha256]) assert.ok(!output.includes(secret));
  }
});

test('local retention rejects removed, replaced and differently attributed source observations', () => {
  const record = addCaseAttachments(createCase({ domain: 'image-review.example' }, now), [source], now);
  for (const changed of [[], [{ ...source, source: 'Changed source' }], [{ ...source, observedAt: now }], [{ ...source, digestSha256: derivative.digestSha256 }]]) {
    assert.throws(() => assertDerivedCaseAttachmentSource({ ...record, attachments: changed }, derivative), /changed or was removed/);
  }
  // Portable lineage remains readable even after a deliberate source removal.
  assert.deepEqual(readCaseAttachment(derivative), derivative);
  for (const value of [
    { ...derivative, mediaType: 'application/json' },
    { ...derivative, id: source.id },
    { ...derivative, derivation: { ...derivation, method: 'future-method' } },
    { ...derivative, derivation: { ...derivation, source: { ...derivation.source, byteLength: 0 } } },
    { ...derivative, derivation: undefined },
  ]) assert.throws(() => readCaseAttachment(value));
});
