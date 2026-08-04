import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  buildDomainControlManifest,
  reviewDomainControlManifest,
  verifyDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { canonicalArtifactJson } from '../frontend/src/lib/analysis/artifact-integrity.ts';

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
      mx: ['mail.example.test'],
      caa: ['0 issue "ca.example"'],
      tlsIssuer: 'Example Issuer',
      tlsSpkiSha256: 'a'.repeat(64),
      registrarLock: 'required',
      renewalReviewAt: '2026-08-20T00:00:00Z',
    }],
  };
}

describe('domain control manifests', () => {
  it('normalizes desired state and produces a deterministic integrity digest', () => {
    const left = buildDomainControlManifest(input(), generatedAt);
    const right = buildDomainControlManifest(input(), generatedAt);

    assert.equal(left.schema, DOMAIN_CONTROL_MANIFEST_SCHEMA);
    assert.equal(left.entries[0]?.domain, 'example.test');
    assert.deepEqual(left.entries[0]?.nameservers, ['ns1.example.test', 'ns2.example.test']);
    assert.equal(left.integrity.digestSha256, right.integrity.digestSha256);
    assert.equal(verifyDomainControlManifest(left), left);
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
    assert.throws(() => verifyDomainControlManifest(manifest), /canonical normalized content/iu);

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
    const verification = await verifyOfflineArtifact(stdout);
    assert.equal(verification.artifact.kind, 'signed_review_artifact');
    assert.equal(verification.state, 'verified');
  });
});
