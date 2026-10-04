import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createAcquisitionReviewWorkspace,
  type AcquisitionReviewDraft,
} from '../frontend/src/lib/controllers/acquisition-review-workspace.ts';
import {
  ACQUISITION_MANUAL_CHECKS,
  buildAcquisitionDecisionPacket,
  readAcquisitionDecisionPacket,
  MAX_ACQUISITION_DECISION_PACKET_BYTES,
} from '../packages/investigation/acquisition-decision-packet.mts';
import { buildAcquisitionDueDiligence } from '../packages/investigation/acquisition-due-diligence.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';

const historicalTime = '2020-01-01T00:00:00.000Z';
const currentTime = '2026-10-01T00:00:00.000Z';
const review = () =>
  buildAcquisitionDueDiligence({
    availability: {
      domain: 'candidate.example',
      state: 'registered',
      source: 'rdap',
      confidence: 'high',
    },
  });
const makePacket = () =>
  buildAcquisitionDecisionPacket({
    target: 'candidate.example',
    review: review(),
    generatedAt: historicalTime,
    evidenceObservedAt: historicalTime,
    decision: 'pause',
    rationale: 'Historical private rationale.',
    reviewedChecks: [...ACQUISITION_MANUAL_CHECKS],
  });
const draft = (): AcquisitionReviewDraft => ({
  decision: 'unresolved',
  rationale: 'Fresh private edits.',
  reviewedChecks: [],
});
function setup() {
  let edits = draft();
  const context = {
    target: 'candidate.example',
    synthetic: false,
    observedAt: currentTime,
    review: review(),
  };
  const workspace = createAcquisitionReviewWorkspace({
    readContext: () => context,
    readDraft: () => edits,
    writeDraft: (value) => {
      edits = value;
    },
  });
  return {
    workspace,
    context,
    get edits() {
      return edits;
    },
    set edits(value) {
      edits = value;
    },
  };
}

test('reopen previews and cancellation preserve edits and fresh evidence; deliberate accept restores only manual fields', async () => {
  const h = setup(),
    original = JSON.stringify(h.context),
    packet = await makePacket();
  assert.deepEqual(await h.workspace.preview(new Blob([packet.content])), packet.document);
  assert.deepEqual(h.edits, draft());
  h.workspace.cancel();
  assert.throws(() => h.workspace.accept(), /changed/);
  assert.deepEqual(h.edits, draft());
  await h.workspace.preview(new Blob([packet.content]));
  h.workspace.accept();
  assert.equal(JSON.stringify(h.context), original);
  assert.equal(h.edits.rationale, 'Historical private rationale.');
  assert.deepEqual(h.edits.reviewedChecks, ACQUISITION_MANUAL_CHECKS);
  await assert.rejects(h.workspace.prepareDownload(), /Reconfirm/);
  h.workspace.reconfirm(true);
  const exported = await h.workspace.prepareDownload();
  assert.equal(exported.document.evidenceObservedAt, currentTime);
  assert.notEqual(exported.document.generatedAt, historicalTime);
  assert.deepEqual(exported.document.evidenceReview, h.context.review);
  assert.equal(exported.document.analystReview.state, 'reviewed');
  const { integrity, ...unsigned } = exported.document;
  assert.equal(
    integrity.digestSha256,
    `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex')}`,
  );
  h.edits = { ...h.edits, rationale: 'Changed after confirmation.' };
  assert.equal(h.workspace.isReconfirmed(), false);
  await assert.rejects(h.workspace.prepareDownload(), /Reconfirm/);
});

test('fresh context drift refuses acceptance and invalidates reconfirmation without replacing either evidence family', async () => {
  const h = setup(),
    packet = await makePacket();
  await h.workspace.preview(new Blob([packet.content]));
  Reflect.set(h.context.review.items[0]!, 'detail', 'A newly observed state.');
  assert.throws(() => h.workspace.accept(), /changed/);
  assert.deepEqual(h.edits, draft());
  await h.workspace.preview(new Blob([packet.content]));
  h.workspace.accept();
  h.workspace.reconfirm(true);
  h.context.observedAt = '2026-10-02T00:00:00.000Z';
  assert.equal(h.workspace.isReconfirmed(), false);
  await assert.rejects(h.workspace.prepareDownload(), /Reconfirm/);
});

test('a cancelled delayed file read never exposes a preview or replaces fresh edits', async () => {
  const h = setup(),
    packet = await makePacket();
  let resolve!: (content: string) => void;
  const text = new Promise<string>((done) => {
    resolve = done;
  });
  class DelayedFile extends Blob {
    override slice() {
      return this;
    }
    override text() {
      return text;
    }
  }
  const pending = h.workspace.preview(new DelayedFile([packet.content]));
  h.workspace.cancel();
  h.edits = { ...draft(), rationale: 'Edited while reading.' };
  resolve(packet.content);
  assert.equal(await pending, null);
  assert.equal(h.edits.rationale, 'Edited while reading.');
});

test('shared reopening rejects unsupported, malformed, wrong-target, synthetic and digest-altered inputs before preview', async () => {
  const packet = await makePacket(),
    expected = { target: 'candidate.example', synthetic: false };
  for (const mutate of [
    (value: typeof packet.document) => {
      value.version = 999 as typeof value.version;
    },
    (value: typeof packet.document) => {
      value.analystReview.rationale = 'Tampered';
    },
    (value: typeof packet.document) => {
      Reflect.set(value.evidenceReview, 'items', []);
    },
  ]) {
    const value = structuredClone(packet.document);
    mutate(value);
    await assert.rejects(readAcquisitionDecisionPacket(JSON.stringify(value), expected));
  }
  await assert.rejects(
    readAcquisitionDecisionPacket(packet.content, { ...expected, target: 'other.example' }),
    /different target/,
  );
  await assert.rejects(
    readAcquisitionDecisionPacket(packet.content, { ...expected, synthetic: true }),
    /demonstration context/,
  );
  await assert.rejects(readAcquisitionDecisionPacket('{"schema":', expected));
  const h = setup();
  const oversized = new Blob([new Uint8Array(MAX_ACQUISITION_DECISION_PACKET_BYTES + 1)]);
  await assert.rejects(h.workspace.preview(oversized), /15 MiB/);
  assert.deepEqual(h.edits, draft());
  const parsed = await readAcquisitionDecisionPacket(packet.content, expected);
  assert.ok(Object.isFrozen(parsed.analystReview));
  assert.throws(() => parsed.analystReview.reviewedChecks.push('eligibility'), TypeError);
});

test('the published acquisition decision fixture reopens through the same strict supported reader', async () => {
  const raw = await readFile(
    new URL('fixtures/investigation-portability/acquisition-decision-v2.json', import.meta.url),
    'utf8',
  );
  const value = JSON.parse(raw) as { target: string; synthetic: boolean };
  const parsed = await readAcquisitionDecisionPacket(raw, value);
  assert.equal(parsed.version, 2);
});

test('download preparation refuses a changed intent across the digest await', async () => {
  const h = setup();
  const original = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.crypto.subtle.digest = async (algorithm, bytes) => {
    started();
    await gate;
    return original(algorithm, bytes);
  };
  try {
    const pending = h.workspace.prepareDownload();
    await entered;
    h.edits = { ...h.edits, rationale: 'Changed during hashing.' };
    release();
    await assert.rejects(pending, /changed while preparing/);
    assert.equal(h.edits.rationale, 'Changed during hashing.');
  } finally {
    globalThis.crypto.subtle.digest = original;
    release();
  }
});
