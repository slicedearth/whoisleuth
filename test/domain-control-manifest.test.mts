import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  DOMAIN_CONTROL_REVIEW_VERSION,
  buildDomainControlManifest,
  reviewDomainControlManifest,
  verifyDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { validateSignedDigestArtifactStructure } from '../cli/artifact-structure.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { buildInterchangeFidelityReport } from '../cli/interchange-report.mts';
import { canonicalArtifactJson } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { verifyDomainControlPassport } from '../frontend/src/lib/analysis/domain-control-passport.ts';
import { serializeDomainControlManifest } from '../packages/evidence/domain-control-runtime.mts';

const generatedAt = '2026-08-03T00:00:00.000Z';

function input() {
  return {
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
    version: 1,
    expiresAt: '2026-09-03T00:00:00.000Z',
    entries: [{
      domain: 'Example.Test.',
      nameservers: ['NS2.EXAMPLE.TEST', 'ns1.example.test'],
      ds: ['12345 13 2 abcdef'],
      mx: ['10 mail.example.test', '0 .'],
      caa: ['0 issue "ca.example"'],
      tlsIssuer: 'Example Issuer',
      tlsSpkiSha256: 'a'.repeat(64),
      registrarLock: 'required',
      renewalReviewAt: '2026-08-20T00:00:00Z',
    }],
  };
}

describe('domain control manifests', () => {
  it('assigns UTC to version-1 input timestamps but requires explicit runtime times', () => {
    const legacyInput = input();
    legacyInput.expiresAt = '2026-09-03T12:00:00.000';
    legacyInput.entries[0] = { ...legacyInput.entries[0]!, renewalReviewAt: '2026-08-20T12:00:00.000' };
    const manifest = buildDomainControlManifest(legacyInput, generatedAt);
    assert.equal(manifest.expiresAt, '2026-09-03T12:00:00.000Z');
    assert.equal(manifest.entries[0]?.renewalReviewAt, '2026-08-20T12:00:00.000Z');
    assert.throws(() => buildDomainControlManifest(input(), '2026-08-03T12:00:00.000'), /explicit timezone/u);

    const report = reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: 1,
      manifest,
      observations: [{
        domain: 'example.test',
        fields: { nameservers: { state: 'partial', values: [], source: 'Legacy review', observedAt: '2026-08-03T12:00:00.000' } },
      }],
    }, generatedAt);
    assert.equal(report.domains[0]?.comparisons.find((item) => item.field === 'nameservers')?.observedAt, '2026-08-03T12:00:00.000Z');
    assert.throws(() => reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, version: 1, manifest, observations: [],
    }, '2026-08-03T12:00:00.000'), /explicit timezone/u);
  });

  it('normalizes desired state and produces a deterministic integrity digest', () => {
    const left = buildDomainControlManifest(input(), generatedAt);
    const right = buildDomainControlManifest(input(), generatedAt);

    assert.equal(left.schema, DOMAIN_CONTROL_MANIFEST_SCHEMA);
    assert.equal(left.entries[0]?.domain, 'example.test');
    assert.deepEqual(left.entries[0]?.nameservers, ['ns1.example.test', 'ns2.example.test']);
    assert.deepEqual(left.entries[0]?.mx, ['0 .', '10 mail.example.test']);
    assert.deepEqual(left.entries[0]?.caa, ['0 issue ca.example']);
    assert.deepEqual(left.entries[0]?.ds, ['12345 13 2 abcdef']);
    assert.equal(left.integrity.digestSha256, right.integrity.digestSha256);
    assert.deepEqual(verifyDomainControlManifest(left), left);
  });

  it('canonicalises structured and presentation-form MX, CAA, and DS records identically', () => {
    const presentation = buildDomainControlManifest(input(), generatedAt);
    const structuredInput = input();
    structuredInput.entries[0] = {
      ...structuredInput.entries[0]!,
      mx: [{ priority: 10, exchange: 'MAIL.EXAMPLE.TEST.' }, { priority: 0, exchange: '.' }] as unknown as string[],
      caa: [{ critical: 0, tag: 'ISSUE', value: 'ca.example' }] as unknown as string[],
      ds: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' }] as unknown as string[],
    };
    const structured = buildDomainControlManifest(structuredInput, generatedAt);
    assert.deepEqual(structured.entries[0]?.mx, presentation.entries[0]?.mx);
    assert.deepEqual(structured.entries[0]?.caa, presentation.entries[0]?.caa);
    assert.deepEqual(structured.entries[0]?.ds, presentation.entries[0]?.ds);
    assert.equal(structured.integrity.digestSha256, presentation.integrity.digestSha256);
  });

  it('rejects changed manifest content and duplicate domains', () => {
    const manifest = buildDomainControlManifest(input(), generatedAt);
    const changed = {
      ...structuredClone(manifest),
      entries: [{ ...structuredClone(manifest.entries[0]!), note: 'changed' }],
    };
    assert.throws(() => verifyDomainControlManifest(changed), /integrity check/iu);

    const duplicate = input();
    duplicate.entries.push({ ...duplicate.entries[0]!, domain: 'example.test' });
    assert.throws(() => buildDomainControlManifest(duplicate, generatedAt), /unique domains/iu);
  });

  it('rejects non-canonical and unknown manifest content even with a matching digest', () => {
    const built = buildDomainControlManifest(input(), generatedAt);
    const { integrity, ...builtUnsigned } = built;
    const unsigned = {
      ...structuredClone(builtUnsigned),
      entries: [{ ...structuredClone(built.entries[0]!), domain: 'Example.Test.' }],
    };
    const manifest = {
      ...unsigned,
      integrity: {
        ...integrity,
        digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJson(unsigned)).digest('hex')}`,
      },
    };
    assert.throws(() => verifyDomainControlManifest(manifest), /canonical normalised content/iu);

    const withUnknown = { ...buildDomainControlManifest(input(), generatedAt), extra: 'not part of the contract' };
    assert.throws(() => verifyDomainControlManifest(withUnknown), /unknown field: extra/iu);

    const withChangedLimitations = { ...buildDomainControlManifest(input(), generatedAt), limitations: ['Changed limitation'] };
    assert.throws(() => verifyDomainControlManifest(withChangedLimitations), /unsupported or malformed structure/iu);
  });

  it('rejects unknown fields throughout manifest and review inputs', () => {
    assert.throws(() => buildDomainControlManifest({ ...input(), secret: 'must-not-be-accepted' }, generatedAt), /unknown field: secret/iu);

    const manifest = buildDomainControlManifest(input(), generatedAt);
    assert.throws(() => reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: 1,
      manifest,
      observations: [{
        domain: 'example.test',
        fields: {
          nameservers: {
            state: 'observed',
            values: ['ns1.example.test'],
            source: 'saved DNS evidence',
            observedAt: generatedAt,
            rawPayload: 'must-not-be-accepted',
          },
        },
      }],
    }, generatedAt), /unknown field: rawPayload/iu);
  });

  it('rejects incomplete or over-bound observation fields before comparison', () => {
    const manifest = buildDomainControlManifest(input(), generatedAt);
    const field = () => ({
      state: 'observed',
      values: ['ns1.example.test'],
      source: 'saved DNS evidence',
      observedAt: generatedAt,
    });
    const reviewInput = (nameservers: unknown) => ({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_REVIEW_VERSION,
      manifest,
      observations: [{ domain: 'example.test', fields: { nameservers } }],
    });

    const withoutValues = field() as Record<string, unknown>;
    delete withoutValues.values;
    const withoutObservedAt = field() as Record<string, unknown>;
    delete withoutObservedAt.observedAt;
    for (const malformed of [
      withoutValues,
      withoutObservedAt,
      'not an observation field',
      { ...field(), values: 'not an array' },
      { ...field(), values: ['x'.repeat(1_013)] },
      { ...field(), source: 'x'.repeat(481) },
      { ...field(), observedAt: `${generatedAt}unexpected` },
    ]) {
      assert.throws(
        () => reviewDomainControlManifest(reviewInput(malformed), generatedAt),
        /invalid observation/iu,
      );
    }

    let tailReads = 0;
    const overBoundValues = new Array(129).fill('ns1.example.test');
    Object.defineProperty(overBoundValues, '128', {
      enumerable: true,
      configurable: true,
      get() {
        tailReads += 1;
        return 'tail.example.test';
      },
    });
    assert.throws(
      () => reviewDomainControlManifest(reviewInput({ ...field(), values: overBoundValues }), generatedAt),
      /invalid observation/iu,
    );
    assert.equal(tailReads, 0);

    const customValues = ['ns1.example.test'];
    Object.assign(customValues, { extra: true });
    assert.throws(
      () => reviewDomainControlManifest(reviewInput({ ...field(), values: customValues }), generatedAt),
      /invalid observation/iu,
    );

    const observation = { domain: 'example.test', fields: { nameservers: field() } };
    let customMapCalls = 0;
    const customObservations = [observation];
    Object.defineProperty(customObservations, 'map', {
      configurable: true,
      value() {
        customMapCalls += 1;
        return [{ domain: 'example.test', fields: { nameservers: { ...field(), values: new Array(10_001).fill('forged.example.test') } } }];
      },
    });
    assert.throws(() => reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_REVIEW_VERSION,
      manifest,
      observations: customObservations,
    }, generatedAt), /bounded array/iu);
    assert.equal(customMapCalls, 0);

    let observationGetterCalls = 0;
    const accessorObservations = [observation];
    Object.defineProperty(accessorObservations, '0', {
      enumerable: true,
      configurable: true,
      get() {
        observationGetterCalls += 1;
        return observation;
      },
    });
    assert.throws(() => reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_REVIEW_VERSION,
      manifest,
      observations: accessorObservations,
    }, generatedAt), /bounded array/iu);
    assert.equal(observationGetterCalls, 0);

    assert.throws(
      () => reviewDomainControlManifest({ ...reviewInput(field()), version: DOMAIN_CONTROL_REVIEW_VERSION + 1 }, generatedAt),
      new RegExp(`version ${DOMAIN_CONTROL_REVIEW_VERSION}\\.`, 'u'),
    );
  });

  it('bounds and normalises admitted observation text before retaining it', () => {
    const manifest = buildDomainControlManifest(input(), generatedAt);
    const report = reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_REVIEW_VERSION,
      manifest,
      observations: [{
        domain: 'example.test',
        fields: {
          tlsIssuer: {
            state: 'observed',
            values: ['a'.repeat(2_000)],
            source: 's'.repeat(480),
            observedAt: generatedAt,
          },
          registrarLock: {
            state: 'observed',
            values: new Array(128).fill('required'),
            source: 'saved registrar evidence',
            observedAt: null,
          },
        },
      }],
    }, generatedAt);
    const comparisons = report.domains[0]?.comparisons ?? [];
    const issuer = comparisons.find((item) => item.field === 'tlsIssuer');
    const lock = comparisons.find((item) => item.field === 'registrarLock');
    assert.equal(issuer?.source?.length, 120);
    assert.equal(issuer?.observed[0]?.length, 500);
    assert.deepEqual(lock?.observed, ['required']);

    assert.throws(() => reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_REVIEW_VERSION,
      manifest,
      observations: [{
        domain: 'example.test',
        fields: {
          tlsSpkiSha256: {
            state: 'observed',
            values: ['a'.repeat(65)],
            source: 'saved certificate evidence',
            observedAt: generatedAt,
          },
        },
      }],
    }, generatedAt), /invalid observation/iu);
  });

  it('reports drift only from complete separately attributed observations', () => {
    const manifest = buildDomainControlManifest(input(), generatedAt);
    const report = reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: 1,
      manifest,
      observations: [{
        domain: 'example.test',
        fields: {
          nameservers: {
            state: 'observed',
            values: ['ns3.example.test'],
            source: 'saved DNS evidence',
            observedAt: '2026-08-03T00:05:00Z',
          },
          ds: {
            state: 'partial',
            values: [],
            source: 'imported registry evidence',
            observedAt: '2026-08-03T00:05:00Z',
          },
        },
      }],
    }, '2026-08-04T00:00:00Z');

    const comparisons = report.domains[0]?.comparisons ?? [];
    assert.equal(comparisons.find((item) => item.field === 'nameservers')?.state, 'drift');
    assert.equal(comparisons.find((item) => item.field === 'ds')?.state, 'partial');
    assert.equal(comparisons.find((item) => item.field === 'mx')?.state, 'unavailable');
    assert.equal(report.state, 'drift');
  });

  it('keeps missing evidence inconclusive and reports expired manifests explicitly', () => {
    const manifest = buildDomainControlManifest(input(), generatedAt);
    const report = reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: 1,
      manifest,
      observations: [{
        domain: 'unrelated.example',
        fields: {},
      }],
    }, '2026-10-01T00:00:00Z');

    assert.equal(report.state, 'expired');
    assert.equal(report.ignoredObservationCount, 1);
    assert.equal(report.counts.drift, 0);
    assert.ok((report.counts.unavailable ?? 0) > 0);
  });

  it('builds and verifies a manifest through the offline CLI contract', async () => {
    assert.deepEqual(parseCliArguments(['domain-control', 'input.json', '--json']), {
      action: 'domain-control',
      source: 'input.json',
      output: 'json',
      quiet: false,
      color: true,
    });
    let stdout = '';
    let stderr = '';
    const code = await runCli(['domain-control', '--json'], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
      readArtifactInput: async () => JSON.stringify(input()),
      now: () => generatedAt,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr, '');
    const manifest = JSON.parse(stdout);
    assert.equal(manifest.schema, DOMAIN_CONTROL_MANIFEST_SCHEMA);
    assert.equal(stdout, serializeDomainControlManifest(manifest));
    assert.equal(stdout.endsWith('\n'), true);
    const verification = await verifyOfflineArtifact(stdout);
    assert.equal(verification.artifact.kind, 'signed_review_artifact');
    assert.equal(verification.state, 'verified');
  });

  it('keeps frozen historical, future-version, and expiry semantics aligned across consumers', async () => {
    const [legacyRaw, currentRaw] = await Promise.all([
      readFile(new URL('./fixtures/domain-control-manifest-v1.json', import.meta.url), 'utf8'),
      readFile(new URL('./fixtures/domain-control-manifest-v2.json', import.meta.url), 'utf8'),
    ]);
    for (const [version, raw] of [[1, legacyRaw], [2, currentRaw]] as const) {
      const document = JSON.parse(raw) as Record<string, unknown>;
      assert.doesNotThrow(() => validateSignedDigestArtifactStructure(DOMAIN_CONTROL_MANIFEST_SCHEMA, document));
      const offline = await verifyOfflineArtifact(raw);
      assert.equal(offline.artifact.schema, DOMAIN_CONTROL_MANIFEST_SCHEMA);
      assert.equal(offline.artifact.version, version);
      assert.equal(offline.state, 'verified');
      assert.equal(offline.checks.structure, 'verified');
      assert.equal(offline.checks.contentIntegrity, 'verified');

      const interchange = await buildInterchangeFidelityReport(raw, {
        generatedAt: '2026-08-20T00:00:00.000Z',
      });
      assert.equal(interchange.recognised, true);
      assert.equal(interchange.artifact.id, 'domain_control_passport');
      assert.equal(interchange.artifact.version, version);
      assert.equal(interchange.artifact.versionSupported, true);
      assert.equal(interchange.verification.state, 'verified');
      assert.equal(interchange.verification.assuranceSatisfied, true);
      assert.equal(interchange.compatibility.fidelity, 'normalised_merge');
    }

    const current = JSON.parse(currentRaw) as Record<string, unknown>;
    const future = structuredClone(current);
    future.version = 3;
    const futureEntries = future.entries as Array<Record<string, unknown>>;
    futureEntries[0]!.domain = 'future-private.example';
    const futureRaw = JSON.stringify(future);
    let structureError = '';
    try {
      validateSignedDigestArtifactStructure(DOMAIN_CONTROL_MANIFEST_SCHEMA, future);
    } catch (error) {
      structureError = String(error);
    }
    assert.match(structureError, /unsupported or malformed structure/iu);
    assert.doesNotMatch(structureError, /future-private/iu);
    await assert.rejects(
      () => verifyOfflineArtifact(futureRaw),
      (error: unknown) => {
        assert.match(String(error), /schema or version is not supported/iu);
        assert.doesNotMatch(String(error), /future-private/iu);
        return true;
      },
    );
    const futureInterchange = await buildInterchangeFidelityReport(futureRaw, {
      generatedAt: '2026-08-20T00:00:00.000Z',
    });
    assert.equal(futureInterchange.recognised, true);
    assert.equal(futureInterchange.artifact.version, 3);
    assert.equal(futureInterchange.artifact.versionSupported, false);
    assert.equal(futureInterchange.verification.state, 'unsupported_version');
    assert.equal(futureInterchange.compatibility.fidelity, 'unsupported');
    assert.doesNotMatch(JSON.stringify(futureInterchange), /future-private/iu);

    const expiredAt = '2026-10-01T00:00:00.000Z';
    assert.deepEqual(verifyDomainControlManifest(current), current);
    assert.equal((await verifyOfflineArtifact(currentRaw)).state, 'verified');
    assert.equal(
      (await buildInterchangeFidelityReport(currentRaw, { generatedAt: expiredAt })).verification.state,
      'verified',
    );
    await assert.rejects(
      () => verifyDomainControlPassport(current, expiredAt),
      /expired/iu,
    );
    const review = reviewDomainControlManifest({
      schema: DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: 1,
      manifest: current,
      observations: [],
    }, expiredAt);
    assert.equal(review.state, 'expired');
    assert.equal(review.manifest.expired, true);
  });
});
