import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectWorkspaceArchive } from '../cli/archive-inspect.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { decryptWorkspaceArchive, encryptWorkspaceArchive } from '../packages/workspace/workspace-archive-crypto.mts';
import {
  buildWorkspaceArchive,
  prepareWorkspaceArchive,
  readWorkspaceArchive,
} from '../packages/workspace/workspace-archive.mts';

const NOW = '2026-09-09T00:00:00.000Z';
const PASSPHRASE = 'synthetic archive verification phrase';

function buildArchive() {
  return buildWorkspaceArchive({
    shortlist: [{ domain: 'review.example', availability: 'unknown', mutationTypes: [], savedAt: NOW }],
    settings: { theme: 'dark' },
  }, { generatedAt: NOW });
}

test('archive verification owns its data before awaiting any checksum', async () => {
  const raw = await buildArchive();
  const expected = await readWorkspaceArchive(structuredClone(raw));
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let calls = 0;
  const actual = await readWorkspaceArchive(raw, { cryptoProvider: { subtle: {
    digest: (algorithm, data) => {
      calls += 1;
      if (calls === 1) {
        raw.sections.shortlist.entries[0]!.domain = 'edited.example';
        raw.sections.settings.theme = 'light';
        raw.generatedAt = '2026-09-10T00:00:00.000Z';
        raw.limitations = ['Unverified caller modification'];
      }
      return digest(algorithm, data);
    },
  } } });
  assert.equal(calls, raw.manifest.sectionCount);
  assert.deepEqual(actual, expected);
  assert.notEqual(raw.sections.settings.theme, 'dark');
});

test('retained archive readers reuse checksums but never share mutable preview data', async () => {
  const raw = await buildArchive();
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let calls = 0;
  const prepared = await prepareWorkspaceArchive(raw, { cryptoProvider: { subtle: {
    digest: (algorithm, data) => { calls += 1; return digest(algorithm, data); },
  } } });
  assert.equal(calls, raw.manifest.sectionCount);
  const firstRead = prepared.read();
  const expectedRead = structuredClone(firstRead);
  const firstPreview = prepared.preview({});
  assert.equal(firstPreview.sections.find((section) => section.id === 'shortlist')?.added, 1);
  raw.sections.shortlist.entries[0]!.domain = 'caller-edited.example';
  firstRead.sections.length = 0;
  firstPreview.sections.find((section) => section.id === 'settings')!.data = { theme: 'light' };
  const shortlistPreview = firstPreview.sections.find((section) => section.id === 'shortlist')!;
  (shortlistPreview.data as { entries: Array<{ domain: string }> }).entries[0]!.domain = 'preview-edited.example';
  firstPreview.limitations.push('Not verified');
  assert.deepEqual(prepared.read(), expectedRead);
  const next = prepared.preview({
    shortlist: [{ domain: 'review.example', availability: 'unknown', mutationTypes: [], savedAt: NOW }],
  }, { selectedSectionIds: ['shortlist'] });
  assert.equal(next.sections.find((section) => section.id === 'shortlist')?.added, 0);
  assert.equal(next.sections.find((section) => section.id === 'shortlist')?.updated, 1);
  assert.deepEqual(next.sections.filter((section) => section.selected).map((section) => section.id), ['shortlist']);
  assert.deepEqual(next.limitations, expectedRead.limitations);
  assert.equal(calls, raw.manifest.sectionCount);
});

test('invalid archives cannot create a reusable verified reader', async () => {
  const raw = await buildArchive();
  raw.sections.shortlist.entries[0]!.domain = 'tampered.example';
  await assert.rejects(prepareWorkspaceArchive(raw), /byte-count|checksum/u);
  await assert.rejects(prepareWorkspaceArchive({ verified: true, read: () => raw }), /ordinary JSON/u);
});

test('encryption uses the verified snapshot rather than later caller changes', async (t) => {
  const raw = await buildArchive();
  const expected = structuredClone(raw);
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(globalThis.crypto.subtle, 'digest', (algorithm: AlgorithmIdentifier, data: BufferSource) => {
    raw.sections.shortlist.entries[0]!.domain = 'after-validation.example';
    return digest(algorithm, data);
  });
  const encrypted = await encryptWorkspaceArchive(raw, PASSPHRASE);
  assert.deepEqual(await decryptWorkspaceArchive(encrypted, PASSPHRASE), expected);
  assert.equal(raw.sections.shortlist.entries[0]!.domain, 'after-validation.example');
});

test('offline archive commands checksum each section once and decrypt at most once', async (context) => {
  const archive = await buildArchive();
  const plain = JSON.stringify(archive);
  const encrypted = JSON.stringify(await encryptWorkspaceArchive(archive, PASSPHRASE));
  for (const kind of ['plain', 'encrypted'] as const) {
    for (const command of ['verify', 'inspect'] as const) {
      await context.test(`${command} ${kind}`, async (t) => {
        const digest = t.mock.method(globalThis.crypto.subtle, 'digest');
        const decrypt = t.mock.method(globalThis.crypto.subtle, 'decrypt');
        const raw = kind === 'plain' ? plain : encrypted;
        const options = kind === 'plain' ? {} : { passphrase: PASSPHRASE };
        const result = command === 'verify'
          ? await verifyOfflineArtifact(raw, options)
          : await inspectWorkspaceArchive(raw, options);
        assert.equal(result.summary.sectionCount, archive.manifest.sectionCount);
        assert.equal(digest.mock.callCount(), archive.manifest.sectionCount);
        assert.equal(decrypt.mock.callCount(), kind === 'encrypted' ? 1 : 0);
      });
    }
  }
});
