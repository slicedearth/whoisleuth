import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';

import {
  canonicalArtifactJson,
  canonicalArtifactJsonV2,
  sha256ArtifactDigest,
  sha256ArtifactDigestV2,
} from '../frontend/src/lib/analysis/artifact-integrity.ts';
import * as artifactIntegrityContract from '../packages/evidence/artifact-integrity.mts';
import * as artifactIntegrityFacade from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { buildBulkReviewManifest } from '../frontend/src/lib/analysis/bulk-review-export.ts';
import { ACQUISITION_DECISION_PACKET_VERSION } from '../frontend/src/lib/analysis/acquisition-decision-packet.ts';
import {
  BULK_DOMAIN_COMPARISON_EXPORT_VERSION,
  BULK_DOMAIN_COMPARISON_VERSION,
} from '../frontend/src/lib/analysis/bulk-domain-comparison.ts';
import {
  BULK_MAIL_EXPOSURE_EXPORT_VERSION,
  BULK_MAIL_EXPOSURE_VERSION,
} from '../frontend/src/lib/analysis/bulk-mail-exposure.ts';
import { BULK_REVIEW_MANIFEST_VERSION } from '../frontend/src/lib/analysis/bulk-review-export.ts';
import {
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_PASSPORT_VERSION,
} from '../frontend/src/lib/analysis/domain-control-manifest-core.ts';
import { CASE_RESPONSE_PACKET_VERSION } from '../frontend/src/lib/analysis/case-response-packet.ts';
import { INVESTIGATION_CAPSULE_VERSION } from '../frontend/src/lib/analysis/investigation-capsule.ts';
import { CASE_SCHEMA_VERSION } from '../frontend/src/lib/analysis/case-model.ts';
import { CLI_CASE_PACK_VERSION } from '../cli/case-pack.mts';
import {
  SIGNED_EVIDENCE_PACKAGE_VERSION,
} from '../cli/evidence-signing.mts';
import { INVESTIGATION_MANIFEST_VERSION } from '../cli/investigation-manifest.mts';
import {
  DOMAIN_CHANGE_PACKET_INPUT_VERSION,
  DOMAIN_CHANGE_PACKET_VERSION,
} from '../lib/domain-change-packet.mts';

type Fixture = Readonly<{
  fixtureVersion: number;
  golden: Readonly<{ value: unknown; canonical: string; digestSha256: string }>;
}>;

const fixtureRaw = readFileSync(new URL('./fixtures/artifact-integrity-v1.json', import.meta.url), 'utf8');
const fixture = JSON.parse(fixtureRaw) as Fixture;

function currentManifest() {
  return buildBulkReviewManifest({
    rows: [], reviewStates: [], lookupProfile: 'fast',
    generatedAt: '2026-08-08T00:00:00.000Z', observedAt: '2026-08-08T00:00:00.000Z',
    view: {
      primaryFilter: 'all', mutationFilter: '', signalFilters: [], sourceFilter: '', lifecycleFilter: '',
      ageFilter: '', mailFilter: '', registrarFilter: '', caseDispositionFilter: '', reviewStateFilter: '',
      groupBy: '', sortKey: 'risk', sortDirection: -1,
    },
  });
}

describe('sorted JSON artifact compatibility', () => {
  test('keeps the historical frontend facade bound to the pure evidence contract', () => {
    assert.deepEqual(
      Object.keys(artifactIntegrityFacade).sort(),
      Object.keys(artifactIntegrityContract).sort(),
    );
    for (const name of Object.keys(artifactIntegrityContract) as Array<keyof typeof artifactIntegrityContract>) {
      assert.equal(artifactIntegrityFacade[name], artifactIntegrityContract[name], name);
    }
  });

  test('keeps current envelope versions separate from unchanged nested and input contracts', () => {
    assert.equal(ACQUISITION_DECISION_PACKET_VERSION, 2);
    assert.deepEqual([BULK_DOMAIN_COMPARISON_EXPORT_VERSION, BULK_DOMAIN_COMPARISON_VERSION], [4, 3]);
    assert.deepEqual([BULK_MAIL_EXPOSURE_EXPORT_VERSION, BULK_MAIL_EXPOSURE_VERSION], [2, 1]);
    assert.equal(BULK_REVIEW_MANIFEST_VERSION, 2);
    assert.deepEqual([DOMAIN_CONTROL_MANIFEST_VERSION, DOMAIN_CONTROL_PASSPORT_VERSION], [2, 1]);
    assert.deepEqual([DOMAIN_CHANGE_PACKET_VERSION, DOMAIN_CHANGE_PACKET_INPUT_VERSION], [2, 1]);
    assert.equal(INVESTIGATION_MANIFEST_VERSION, 2);
    assert.equal(CASE_RESPONSE_PACKET_VERSION, 8);
    assert.equal(INVESTIGATION_CAPSULE_VERSION, 3);
    assert.deepEqual([CLI_CASE_PACK_VERSION, CASE_SCHEMA_VERSION], [2, 14]);
    assert.equal(SIGNED_EVIDENCE_PACKAGE_VERSION, 2);
  });

  test('keeps the frozen sorted-json-v1 canonical string and digest byte-identical', async () => {
    assert.equal(fixture.fixtureVersion, 1);
    assert.equal(canonicalArtifactJson(fixture.golden.value), fixture.golden.canonical);
    assert.equal(await sha256ArtifactDigest(fixture.golden.value), fixture.golden.digestSha256);
    assert.doesNotMatch(fixtureRaw, /PRIVATE KEY/u);
  });

  test('keeps the frozen ASCII v1 vocabulary locale-stable', () => {
    const moduleUrl = new URL('../frontend/src/lib/analysis/artifact-integrity.ts', import.meta.url).href;
    const fixtureUrl = new URL('./fixtures/artifact-integrity-v1.json', import.meta.url).href;
    const source = `
      import { readFileSync } from 'node:fs';
      import { canonicalArtifactJson, canonicalArtifactJsonV2 } from ${JSON.stringify(moduleUrl)};
      const fixture = JSON.parse(readFileSync(new URL(${JSON.stringify(fixtureUrl)}), 'utf8'));
      if (canonicalArtifactJson(fixture.golden.value) !== canonicalArtifactJsonV2(fixture.golden.value)) process.exit(1);
    `;
    for (const locale of ['C', 'en_US.UTF-8', 'sv_SE.UTF-8', 'tr_TR.UTF-8']) {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        encoding: 'utf8', env: { ...process.env, LANG: locale, LC_ALL: locale },
      });
      assert.equal(child.status, 0, `${locale}: ${child.stderr}`);
    }
  });

  test('orders v2 keys by a locale-independent total JavaScript code-unit order', async () => {
    const keys = ['é', '😀', '_', 'A', 'e\u0301', '-', 'a', '😃', 'Z'];
    const forward = Object.fromEntries(keys.map((key, index) => [key, index]));
    const reverse = Object.fromEntries([...keys].reverse().map((key) => [key, forward[key]]));
    const expectedKeys = [...keys].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const canonical = canonicalArtifactJsonV2(forward);
    assert.equal(canonical, canonicalArtifactJsonV2(reverse));
    assert.deepEqual(Object.keys(JSON.parse(canonical) as Record<string, unknown>), expectedKeys);
    assert.equal(new Set(Object.keys(JSON.parse(canonical) as Record<string, unknown>)).size, keys.length);
    assert.equal(await sha256ArtifactDigestV2(forward), await sha256ArtifactDigestV2(reverse));
  });

  test('does not consult localeCompare and is stable across locale subprocesses', () => {
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = function forbiddenLocaleCompare(): never {
      throw new Error('localeCompare must not be used by sorted-json-v2');
    };
    try {
      assert.equal(canonicalArtifactJsonV2({ z: 1, A: 2, é: 3, 'e\u0301': 4 }), '{"A":2,"é":4,"z":1,"é":3}');
    } finally {
      String.prototype.localeCompare = original;
    }

    const moduleUrl = new URL('../frontend/src/lib/analysis/artifact-integrity.ts', import.meta.url).href;
    const source = `import { canonicalArtifactJsonV2 } from ${JSON.stringify(moduleUrl)}; process.stdout.write(canonicalArtifactJsonV2({z:1,A:2,é:3,'e\\u0301':4,'😀':5}));`;
    const outputs = ['C', 'en_US.UTF-8', 'sv_SE.UTF-8', 'tr_TR.UTF-8'].map((locale) => {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        encoding: 'utf8', env: { ...process.env, LANG: locale, LC_ALL: locale },
      });
      assert.equal(child.status, 0, child.stderr);
      return child.stdout;
    });
    assert.equal(new Set(outputs).size, 1);
  });

  test('rejects mixed, missing, and unknown version-canonicalization pairs', async () => {
    const current = structuredClone((await currentManifest()).document) as unknown as Record<string, unknown>;
    const currentIntegrity = current.integrity as Record<string, unknown>;
    for (const canonicalization of [undefined, 'sorted-json-v1', 'sorted-json-v3']) {
      const changed = structuredClone(current);
      const integrity = changed.integrity as Record<string, unknown>;
      if (canonicalization === undefined) delete integrity.canonicalization;
      else integrity.canonicalization = canonicalization;
      await assert.rejects(verifyOfflineArtifact(JSON.stringify(changed)), /unsupported or malformed structure/iu);
    }

    current.version = 999;
    currentIntegrity.canonicalization = 'sorted-json-v2';
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(current)), /not supported/iu);
  });
});
