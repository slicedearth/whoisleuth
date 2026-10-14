import assert from 'node:assert/strict';
import { test } from 'node:test';
import { declareImageDerivation, readImageDerivationDeclaration, imageRegionPaintRectangles, MAX_EVIDENCE_IMAGE_PIXELS, MAX_EVIDENCE_IMAGE_REGIONS, readEvidenceImageDimensions, readImageDerivation, readImageRegionPlan } from '../packages/evidence/image-regions.mts';
import { addCaseAttachments, assertDerivedCaseAttachmentSource, readCaseAttachment, reviewCaseImageDerivation } from '../packages/cases/case-attachment-model.mts';
import { createCase, normalizeCaseStore, projectCaseForAudience, serializeCaseStore } from '../packages/cases/case-model.mts';
import { MAX_SELECTED_FILES } from '../packages/contracts/selected-file-limits.mts';

const region = { kind: 'redact', x: 2, y: 3, width: 5, height: 6 } as const;
const plan = { width: 20, height: 20, regions: [region] };
const now = '2026-09-13T00:00:00.000Z';
const source = readCaseAttachment({ id: 'source-one', fileName: 'private-source.png', mediaType: 'image/png', source: 'Private selected observation', observedAt: null,
  retainedAt: now, digestSha256: `sha256:${'a'.repeat(64)}`, byteLength: 100 });
const derivation = { method: 'png-regions-v1', sourceAttachmentId: source.id, source: { digestSha256: source.digestSha256, byteLength: source.byteLength }, plan };
const derivative = readCaseAttachment({ ...source, id: 'derived-one', fileName: 'private-derived.png', byteLength: 110, digestSha256: `sha256:${'b'.repeat(64)}`, derivation });

test('image review matches the exact parent reference without claiming checked bytes or unedited history', () => {
  const before = structuredClone([source, derivative]);
  assert.deepEqual(reviewCaseImageDerivation(derivative, [source, derivative]), {
    steps: [{ declaration: { method: 'png-regions-v1', source: { digestSha256: source.digestSha256, byteLength: 100 }, operations: ['redact'] },
      parentReference: 'matching', parentHasDeclaredEdits: false }], termination: 'no_further_declaration',
  });
  assert.equal(reviewCaseImageDerivation(source, [source, derivative]), null);
  assert.deepEqual([source, derivative], before);
});

test('image review preserves missing and conflicting parent references rather than matching by bytes alone', () => {
  for (const retained of [[], [{ ...source, id: 'same-bytes-other-observation' }]]) {
    const reviewed = reviewCaseImageDerivation(derivative, retained)!;
    assert.equal(reviewed.steps[0]!.parentReference, 'missing');
    assert.equal(reviewed.steps[0]!.parentHasDeclaredEdits, null);
    assert.equal(reviewed.steps[0]!.declaration.source.digestSha256, source.digestSha256);
    assert.equal(reviewed.termination, 'missing_parent');
  }
  for (const retained of [[{ ...source, byteLength: 101 }], [{ ...source, digestSha256: derivative.digestSha256 }],
    [{ ...source, mediaType: 'image/jpeg' as const }], [source, { ...source }]]) {
    const reviewed = reviewCaseImageDerivation(derivative, retained)!;
    assert.equal(reviewed.steps[0]!.parentReference, 'conflicting');
    assert.equal(reviewed.steps[0]!.parentHasDeclaredEdits, null);
    assert.equal(reviewed.termination, 'conflicting_parent');
  }
});

test('image review follows ordered declarations without merging edits or inventing a missing earlier parent', () => {
  const second = readCaseAttachment({ ...derivative, id: 'derived-two', digestSha256: `sha256:${'c'.repeat(64)}`,
    derivation: { ...derivation, sourceAttachmentId: derivative.id,
      source: { digestSha256: derivative.digestSha256, byteLength: derivative.byteLength }, plan: { ...plan, regions: [{ ...region, kind: 'outline' }] } } });
  const retained = [source, derivative, second], before = structuredClone(retained);
  const reviewed = reviewCaseImageDerivation(second, retained)!;
  assert.equal(reviewed.termination, 'no_further_declaration');
  assert.deepEqual(reviewed.steps.map(step => [step.parentReference, step.parentHasDeclaredEdits, step.declaration.operations, step.declaration.source.digestSha256]), [
    ['matching', true, ['outline'], derivative.digestSha256], ['matching', false, ['redact'], source.digestSha256],
  ]);
  assert.doesNotMatch(JSON.stringify(reviewed), /private-|source-one|derived-one|sourceAttachmentId|"regions"|"plan"/);
  assert.deepEqual(retained, before);
  assert.ok(Object.isFrozen(reviewed) && Object.isFrozen(reviewed.steps) && reviewed.steps.every(Object.isFrozen));
  const missing = reviewCaseImageDerivation(second, [derivative, second])!;
  assert.equal(missing.termination, 'missing_parent');
  assert.deepEqual(missing.steps.map(step => step.parentReference), ['matching', 'missing']);
  for (const conflicting of [[{ ...source, byteLength: 101 }], [source, { ...source }]]) {
    const stopped = reviewCaseImageDerivation(second, [...conflicting, derivative, second])!;
    assert.equal(stopped.termination, 'conflicting_parent');
    assert.deepEqual(stopped.steps.map(step => step.parentReference), ['matching', 'conflicting']);
  }
  assert.equal(reviewCaseImageDerivation(second, [derivative, second, { ...source, id: 'other-case-reference' }])!.termination, 'missing_parent');
});

test('image history stops at exact-reference cycles, but reports a mismatched closing link as a conflict', () => {
  const cycleSource = readCaseAttachment({ ...source, derivation: { ...derivation, sourceAttachmentId: derivative.id,
    source: { digestSha256: derivative.digestSha256, byteLength: derivative.byteLength } } });
  const retained = [cycleSource, derivative], before = structuredClone(retained);
  const reviewed = reviewCaseImageDerivation(derivative, retained)!;
  assert.equal(reviewed.termination, 'cycle');
  assert.equal(reviewed.steps.length, 2);
  assert.ok(reviewed.steps.every(step => step.parentReference === 'matching'));
  assert.deepEqual(retained, before);
  const conflict = { ...cycleSource, derivation: { ...cycleSource.derivation!, source: { digestSha256: derivative.digestSha256, byteLength: 999 } } };
  const stopped = reviewCaseImageDerivation(derivative, [conflict, derivative])!;
  assert.equal(stopped.termination, 'conflicting_parent');
  assert.deepEqual(stopped.steps.map(step => step.parentReference), ['matching', 'conflicting']);
});

test('image history admits the complete Case bound and bounds input indexing and traversal independently', () => {
  const chain = [source];
  const child = (parent: typeof source, index: number) => readCaseAttachment({ ...source, id: `link-${index}`, digestSha256: `sha256:${index.toString(16).padStart(64, '0')}`,
    derivation: { ...derivation, sourceAttachmentId: parent.id, source: { digestSha256: parent.digestSha256, byteLength: parent.byteLength } } });
  for (let index = 1; index < MAX_SELECTED_FILES; index++) chain.push(child(chain.at(-1)!, index));
  const complete = reviewCaseImageDerivation(chain.at(-1)!, chain)!;
  assert.equal(complete.steps.length, MAX_SELECTED_FILES - 1);
  assert.equal(complete.termination, 'no_further_declaration');
  const over = [...chain, child(chain.at(-1)!, MAX_SELECTED_FILES)];
  Object.defineProperty(over, 0, { get() { throw new Error('Must reject oversized input before indexing.'); } });
  assert.throws(() => reviewCaseImageDerivation(derivative, over), /Case attachment bound/u);
  const oldestWithMissingParent = readCaseAttachment({ ...source, derivation: { ...derivation, sourceAttachmentId: 'not-in-this-case' } });
  const limited = reviewCaseImageDerivation(child(chain.at(-1)!, MAX_SELECTED_FILES), [oldestWithMissingParent, ...chain.slice(1)])!;
  assert.equal(limited.steps.length, MAX_SELECTED_FILES);
  assert.equal(limited.termination, 'limit');
});

test('shareable image declarations retain only immediate-parent identity and unique operation kinds', () => {
  const declared = declareImageDerivation(readImageDerivation({ ...derivation, plan: { ...plan, regions: [region, { ...region, kind: 'outline' }, region] } }));
  assert.deepEqual(declared, { method: 'png-regions-v1', source: { digestSha256: source.digestSha256, byteLength: 100 }, operations: ['redact', 'outline'] });
  assert.doesNotMatch(JSON.stringify(declared), /private-|source-one|"(?:sourceAttachmentId|plan|regions|coordinates|width|height)":/);
  const secondGeneration = declareImageDerivation(readImageDerivation({ ...derivation, sourceAttachmentId: derivative.id,
    source: { digestSha256: derivative.digestSha256, byteLength: derivative.byteLength }, plan: { ...plan, regions: [{ ...region, kind: 'outline' }] } }));
  assert.equal(secondGeneration.source.digestSha256, derivative.digestSha256);
  assert.deepEqual(secondGeneration.operations, ['outline']);
  // No Case lookup or retained parent pixels are needed to declare saved lineage.
  assert.deepEqual(declareImageDerivation(readCaseAttachment(derivative).derivation!), { ...declared, operations: ['redact'] });
});

test('image declarations reject private fields, unsupported methods and malformed categories or fingerprints', () => {
  const declaration = { method: 'png-regions-v1', source: { ...derivation.source }, operations: ['redact'] };
  const admitted = readImageDerivationDeclaration(declaration);
  declaration.source.byteLength = 42; declaration.operations.push('outline');
  assert.equal(admitted.source.byteLength, 100);
  assert.deepEqual(admitted.operations, ['redact']);
  assert.ok(Object.isFrozen(admitted.source) && Object.isFrozen(admitted.operations));
  for (const value of [null, { ...admitted, sourceAttachmentId: source.id }, { ...admitted, plan },
    { ...admitted, method: 'future-method' }, { ...admitted, operations: [] }, { ...admitted, operations: ['redact', 'redact'] },
    { ...admitted, operations: ['blur'] }, { ...admitted, operations: ['redact', 'outline', 'redact'] },
    { ...admitted, source: { ...admitted.source, byteLength: 0 } }, { ...admitted, source: { ...admitted.source, digestSha256: 'invalid' } },
    { ...admitted, source: { ...admitted.source, url: 'https://private.example/' } },
  ]) assert.throws(() => readImageDerivationDeclaration(value));
});

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
