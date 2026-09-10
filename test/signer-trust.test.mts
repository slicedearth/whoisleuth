import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  assessEvidenceSignerTrust, formatSignerTrustReport, parseSignerTrustStore,
  MAX_SIGNER_TRUST_ENTRIES, MAX_SIGNER_TRUST_LABEL_LENGTH, MAX_SIGNER_TRUST_NOTE_LENGTH, MAX_SIGNER_TRUST_STORE_BYTES,
} from '../cli/signer-trust.mts';
import { signEvidencePackage, verifyEvidencePackageSignature } from '../cli/evidence-signing.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildBulkReviewManifest } from '../frontend/src/lib/analysis/bulk-review-export.ts';

const NOW = '2026-09-10T00:00:00.000Z';
const BEFORE = '2026-09-01T00:00:00.000Z';
const KEY = 'a'.repeat(64);
const entry = (overrides: Record<string, unknown> = {}) => ({ keyIdSha256: KEY, label: 'Reviewed key', status: 'trusted', updatedAt: BEFORE, ...overrides });
const store = (entries: readonly unknown[] = [entry()]) => JSON.stringify({ schema: 'whoisleuth.evidence-signer-trust-store', version: 1, entries });

async function signedFixture() {
  const pair = generateKeyPairSync('ed25519');
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = createHash('sha256').update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const manifest = await buildBulkReviewManifest({
    rows: [], reviewStates: [], lookupProfile: 'fast', generatedAt: BEFORE, observedAt: BEFORE,
    view: { primaryFilter: 'all', mutationFilter: '', signalFilters: [], sourceFilter: '', lifecycleFilter: '', ageFilter: '', mailFilter: '', registrarFilter: '', caseDispositionFilter: '', reviewStateFilter: '', groupBy: '', sortKey: 'risk', sortDirection: -1 },
  });
  const raw = JSON.stringify(await signEvidencePackage(JSON.stringify(manifest.document), privatePem, BEFORE));
  return { raw, publicPem, fingerprint, verification: await verifyEvidencePackageSignature(raw) };
}

test('reads the independent version-one policy fixture without generating trust from labels or successor links', async () => {
  const raw = await readFile(new URL('./fixtures/signer-trust-store-v1.json', import.meta.url), 'utf8');
  const parsed = parseSignerTrustStore(raw);
  assert.deepEqual(parsed.entries.map((value) => [value.keyIdSha256[0], value.status]), [['a', 'trusted'], ['b', 'retired'], ['c', 'revoked']]);
  assert.equal(parsed.entries[1]!.successorKeyIdSha256, KEY);
  assert.equal(parsed.entries[0]!.successorKeyIdSha256, null);
  assert.ok(Object.isFrozen(parsed.entries) && Object.isFrozen(parsed.entries[0]));
});

test('distinguishes current trust, unknown, retirement, revocation and future review while keeping cryptographic verification unchanged', async () => {
  const fixture = await signedFixture();
  assert.equal(fixture.verification.signature.keyIdSha256, fixture.fingerprint);
  for (const [status, updatedAt, expected] of [
    ['trusted', BEFORE, 'trusted'], ['retired', BEFORE, 'retired'], ['revoked', BEFORE, 'revoked'],
    ['trusted', '2026-09-11T00:00:00.000Z', 'review_required'], ['revoked', '2026-09-11T00:00:00.000Z', 'revoked'],
  ]) {
    const raw = store([entry({ keyIdSha256: fixture.fingerprint, status, updatedAt, note: 'Local decision' })]);
    const report = assessEvidenceSignerTrust(fixture.verification, raw, NOW);
    assert.equal(report.trust.state, expected);
    assert.equal(report.state, expected === 'trusted' ? 'trusted' : 'not_trusted');
    assert.equal(report.verification, fixture.verification);
    assert.equal(report.verification.signature.signerTrust, 'embedded_key_only');
    assert.equal(report.verification.version, 2);
    assert.equal(report.trust.storeDigestSha256, createHash('sha256').update(raw).digest('hex'));
    assert.equal(report.trust.entry!.note, 'Local decision');
  }
  const unrelated = entry({ label: 'Never include this unrelated label', note: 'Never include this unrelated note', successorKeyIdSha256: fixture.fingerprint });
  const unknown = assessEvidenceSignerTrust(fixture.verification, store([unrelated]), NOW);
  assert.equal(unknown.trust.state, 'unknown');
  assert.equal(unknown.trust.entry, null);
  assert.doesNotMatch(JSON.stringify(unknown), /Never include/u);
  assert.match(formatSignerTrustReport(unknown), /No matching fingerprint/u);
  assert.equal(assessEvidenceSignerTrust(fixture.verification, store([]), NOW).trust.state, 'unknown');
  assert.throws(() => assessEvidenceSignerTrust(fixture.verification, store(), '2026-09-10T00:00:00'), /explicit timezone/u);
});

test('trust-file admission rejects conflicting identities, unsafe content, future formats and every exceeded bound', () => {
  for (const raw of [
    store([entry(), entry({ status: 'revoked' })]),
    store().replace('"version":1', '"version":1,"version":1'),
    store().replace('"version":1', '"version":2'),
    store().replace('"entries":', '"privateKey":"not allowed","entries":'),
    store([entry({ status: ['trusted'] })]), store([entry({ status: null })]),
    store([entry({ keyIdSha256: 'A'.repeat(64) })]), store([entry({ label: ' ' })]),
    store([entry({ note: null })]), store([entry({ updatedAt: '2026-09-31T00:00:00Z' })]),
    store([entry({ note: ['-----BEGIN ', 'PRIVATE KEY----- concealed -----END PRIVATE KEY-----'].join('') })]),
    store([entry({ label: ['-----BEGIN OPENSSH ', 'PRIVATE KEY-----'].join('') })]),
    store([entry({ updatedAt: '2026-09-01T00:00:00' })]),
    store([entry({ successorKeyIdSha256: KEY })]), store([entry({ successorKeyIdSha256: 'invalid' })]),
    store([entry({ extra: true })]), store([null]), store([[]]),
    store([entry({ label: 'x'.repeat(MAX_SIGNER_TRUST_LABEL_LENGTH + 1) })]),
    store([entry({ note: 'x'.repeat(MAX_SIGNER_TRUST_NOTE_LENGTH + 1) })]),
    store(Array.from({ length: MAX_SIGNER_TRUST_ENTRIES + 1 }, (_, index) => entry({ keyIdSha256: index.toString(16).padStart(64, '0') }))),
    store() + ' '.repeat(MAX_SIGNER_TRUST_STORE_BYTES),
  ]) assert.throws(() => parseSignerTrustStore(raw));
  for (const hidden of ['\n', '\t', '\u001b', '\u009b', '\u202e', '\u200d', '\u2028', '\u2029']) {
    for (const field of ['label', 'note']) assert.throws(() => parseSignerTrustStore(store([entry({ [field]: `before${hidden}after` })])), /hidden controls/u);
  }
  assert.equal(parseSignerTrustStore(store([entry({ label: 'x'.repeat(MAX_SIGNER_TRUST_LABEL_LENGTH), note: 'x'.repeat(MAX_SIGNER_TRUST_NOTE_LENGTH) })])).entries.length, 1);
  const maximumEntries = Array.from({ length: MAX_SIGNER_TRUST_ENTRIES }, (_, index) => entry({ keyIdSha256: index.toString(16).padStart(64, '0') }));
  assert.equal(parseSignerTrustStore(store(maximumEntries)).entries.length, MAX_SIGNER_TRUST_ENTRIES);
  const raw = store();
  assert.equal(parseSignerTrustStore(raw + ' '.repeat(MAX_SIGNER_TRUST_STORE_BYTES - Buffer.byteLength(raw))).entries.length, 1);
});

test('CLI trust is explicit, offline, policy-sensitive in quiet mode and separate from a matching supplied public key', async () => {
  const fixture = await signedFixture();
  for (const status of ['trusted', 'retired', 'revoked', 'unknown']) {
    for (const mode of ['--json', '--quiet', '--no-color']) {
      let stdout = '', stderr = '';
      const reads: string[] = [];
      const args = ['verify-signature', 'signed.json', '--trust-store-file', 'trust.json', '--public-key-file', 'public.pem', mode];
      const code = await runCli(args, {
        stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
        readArtifactInput: async (source) => { reads.push(source!); return source === 'signed.json' ? fixture.raw : store(status === 'unknown' ? [] : [entry({ keyIdSha256: fixture.fingerprint, status })]); },
        readPublicKeyFile: async () => fixture.publicPem,
        now: () => NOW,
      });
      assert.equal(code, status === 'trusted' ? EXIT_CODES.SUCCESS : EXIT_CODES.PARTIAL_FAILURE);
      assert.equal(stderr, '');
      assert.deepEqual(reads, ['signed.json', 'trust.json']);
      if (mode === '--quiet') assert.equal(stdout, '');
      else if (mode === '--json') {
        const report = JSON.parse(stdout);
        assert.equal(report.schema, 'whoisleuth.evidence-signer-trust-report');
        assert.equal(report.version, 1);
        assert.equal(report.trust.state, status);
        assert.equal(report.verification.signature.publicKeyMatched, true);
        assert.doesNotMatch(stdout, /public\.pem|trust\.json|PUBLIC KEY|publicKeySpkiDerBase64/u);
      } else {
        assert.match(stdout, new RegExp(`signer trust: ${status}`));
        assert.match(stdout, /Trusted public key: matched/u);
        assert.doesNotMatch(stdout, /Signer trust: trusted_key/u);
      }
    }
  }
  let stderr = '';
  assert.equal(await runCli(['verify-signature', 'signed.json', '--trust-store-file', 'trust.json'], {
    stdout: { write() { assert.fail('Malformed trust input must not emit a report.'); } },
    stderr: { write(value) { stderr += value; } },
    readArtifactInput: async (source) => source === 'signed.json' ? fixture.raw : '{}',
  }), EXIT_CODES.USAGE);
  assert.match(stderr, /Signer trust store must use/u);
});
