import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  buildCliCasePack,
  MAX_CASE_PACK_CASES,
  verifyCliCasePack,
} from '../cli/case-pack.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { CASE_SCHEMA_VERSION, createCase, normalizeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import {
  canonicalArtifactJson,
  canonicalArtifactJsonV2,
} from '../frontend/src/lib/analysis/artifact-integrity.ts';
import { historicalCasePackFixture } from './historical-case-pack-fixtures.mts';

const NOW = '2026-08-05T03:00:00.000Z';

function exportedCases() {
  const migrated = normalizeCaseStore({
    version: 12,
    cases: [{
      id: 'case-1', domain: 'example.test', status: 'reviewing', disposition: 'unreviewed', reviewReasonCode: null, tags: [],
      brandProfileIds: ['Profile_A', 'profile-b'],
      notes: [{ id: 'note-1', body: 'private analyst note', createdAt: NOW }], source: 'lookup', evidenceHistory: [], evidencePins: [], decisions: [],
      actions: [{ id: 'action-1', type: 'network_hosting_report', recipient: 'private recipient', contactSource: 'manual', contactLimitations: [], dueAt: null, state: 'planned', reference: null, followUpAt: null, outcome: null, createdAt: NOW, updatedAt: NOW }],
      assertions: [{ id: 'assertion-1', kind: 'hypothesis', statement: 'Needs review', rationale: null, evidencePinIds: [], evidenceRelations: [], state: 'open', createdAt: NOW, updatedAt: NOW }],
      manualTrail: [{ id: 'trail-1', kind: 'pivot', summary: 'Reviewed related host', target: 'private target', createdAt: NOW }], sightings: [],
      branches: [{ id: 'branch-1', name: 'Private branch name', state: 'active', evidencePinIds: [], checkpointIds: [], assertionIds: ['assertion-1'], actionIds: ['action-1'], createdAt: NOW, updatedAt: NOW }],
      createdAt: NOW, updatedAt: NOW,
    }],
  });
  return { version: CASE_SCHEMA_VERSION, cases: migrated.cases };
}

function resign<T extends Record<string, unknown>>(value: T): T {
  const { integrity: _integrity, ...unsigned } = value;
  const current = (value.packet as Record<string, unknown> | undefined)?.version === 2;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: current ? 'sorted-json-v2' : 'sorted-json-v1',
      digestSha256: `sha256:${createHash('sha256').update(current ? canonicalArtifactJsonV2(unsigned) : canonicalArtifactJson(unsigned)).digest('hex')}`,
    },
  } as unknown as T;
}

function legacyCasePack(audience: 'internal' | 'public' | 'trusted' = 'public'): Record<string, unknown> {
  return historicalCasePackFixture(11, audience);
}

function schema10CasePack(audience: 'internal' | 'public' | 'trusted' = 'public'): Record<string, unknown> {
  return historicalCasePackFixture(10, audience);
}

function historicalCasePack(
  version: number,
  audience: 'internal' | 'public' | 'trusted',
): Record<string, unknown> {
  return historicalCasePackFixture(version, audience);
}

function historicalRequiredCaseKeys(version: number): string[] {
  return [
    'id', 'domain', 'status', 'disposition', 'tags', 'notes', 'source', 'evidenceHistory', 'createdAt', 'updatedAt',
    ...(version >= 3 ? ['evidencePins', 'decisions', 'actions'] : []),
    ...(version >= 4 ? ['assertions', 'manualTrail'] : []),
    ...(version >= 9 ? ['sightings'] : []),
    ...(version >= 12 ? ['brandProfileIds'] : []),
  ];
}

function coordinateHistoricalCaseOmission(pack: Record<string, unknown>, key: string): void {
  const rawCase = (pack.cases as Array<Record<string, unknown>>)[0]!;
  const report = (((pack.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
  const reportCase = report.case as Record<string, unknown>;
  const response = report.analystResponse as Record<string, unknown> | undefined;
  delete rawCase[key];
  switch (key) {
    case 'id': delete reportCase.id; break;
    case 'domain': delete reportCase.domain; break;
    case 'status': reportCase.status = 'new'; break;
    case 'disposition': reportCase.disposition = 'unreviewed'; break;
    case 'tags': reportCase.tags = []; break;
    case 'notes': reportCase.notesIncluded = false; delete reportCase.notes; break;
    case 'source': reportCase.source = 'unknown'; break;
    case 'evidenceHistory': report.currentAssessment = null; report.evidenceTimeline = []; break;
    case 'createdAt': reportCase.openedAt = report.generatedAt; break;
    case 'updatedAt': reportCase.updatedAt = report.generatedAt; break;
    case 'evidencePins':
    case 'decisions':
    case 'actions':
    case 'assertions':
    case 'manualTrail':
    case 'sightings':
      if (response) response[key] = [];
      break;
    case 'brandProfileIds': reportCase.brandProfileIds = []; break;
  }
}

describe('CLI case pack', () => {
  test('requires deliberate review and applies the public audience boundary', () => {
    assert.throws(() => buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: false }, NOW), /requires --reviewed/iu);
    const pack = buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW);
    assert.equal(pack.version, CASE_SCHEMA_VERSION);
    assert.equal(pack.cases.length, 1);
    assert.equal(pack.packet.reports[0]?.schema, 'whoisleuth.case-report');
    assert.equal(pack.packet.reports[0]?.schemaVersion, 9);
    assert.deepEqual(pack.cases[0]?.notes, []);
    assert.deepEqual(pack.cases[0]?.brandProfileIds, []);
    assert.deepEqual(pack.cases[0]?.actions, []);
    assert.deepEqual(pack.cases[0]?.assertions, []);
    assert.deepEqual(pack.cases[0]?.observedEffects.reviews, []);
    assert.deepEqual(pack.cases[0]?.closures.records, []);
    assert.deepEqual(pack.cases[0]?.branches, []);
    assert.equal(pack.cases[0]?.manualTrail[0]?.target, null);
    assert.equal(pack.packet.redactionManifest.brandProfileReferencesOmitted, 2);
    assert.ok(pack.packet.redactionManifest.excluded.includes('Brand Profile references'));
    assert.match(pack.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(pack), /private analyst note|private recipient|private target|Private branch name/u);
  });

  test('retains exact submitted hostnames in the Case collection without adding them to report v9', () => {
    const record = createCase({
      domain: 'example.test',
      source: 'lookup',
      evidence: {
        inputHostname: 'login.example.test',
        scanDepth: 'deep',
        availability: 'registered',
      },
    }, NOW);
    const pack = buildCliCasePack(
      JSON.stringify({ version: CASE_SCHEMA_VERSION, exportedAt: NOW, cases: [record] }),
      { audience: 'internal', reviewed: true },
      NOW,
    );
    assert.equal(pack.cases[0]?.evidenceHistory[0]?.inputHostname, 'login.example.test');
    assert.equal(JSON.stringify(pack.packet.reports).includes('login.example.test'), false);
    assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
  });

  test('redacts current closure histories conservatively and rejects smuggled public history limitations', () => {
    const record = createCase({
      domain: 'public-closure.example',
      closure: { reason: 'risk_accepted', summary: 'Private closure rationale.' },
    }, NOW);
    const pack = buildCliCasePack(JSON.stringify({ version: CASE_SCHEMA_VERSION, exportedAt: NOW, cases: [record] }), {
      audience: 'public', reviewed: true,
    }, NOW);
    assert.equal(pack.cases[0]?.status, 'reviewing');
    assert.deepEqual(pack.cases[0]?.closures.records, []);
    assert.deepEqual(pack.cases[0]?.observedEffects.reviews, []);
    assert.doesNotMatch(JSON.stringify(pack), /Private closure rationale/u);
    assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });

    const smuggled = structuredClone(pack) as unknown as Record<string, unknown>;
    const rawCase = (smuggled.cases as Array<Record<string, unknown>>)[0]!;
    (rawCase.observedEffects as Record<string, unknown>).limitations = [
      ...((rawCase.observedEffects as Record<string, unknown>).limitations as string[]),
      'Private review detail.',
    ];
    assert.throws(() => verifyCliCasePack(resign(smuggled)), /observedEffects excluded by its audience/iu);
  });

  test('emits a browser-importable top-level case collection', async () => {
    let stdout = '';
    const code = await runCli(['case-pack', '--audience', 'trusted', '--reviewed', '--json'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write() {} }, now: () => NOW,
      readArtifactInput: async () => JSON.stringify(exportedCases()),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    const output = JSON.parse(stdout);
    assert.equal(output.version, CASE_SCHEMA_VERSION);
    assert.equal(output.packet.schema, 'whoisleuth.cli.case-pack');
    assert.equal(output.cases.length, 1);
    assert.equal(output.cases[0].actions[0].recipient, '[redacted]');
    assert.deepEqual(output.cases[0].brandProfileIds, ['Profile_A', 'profile-b']);
    assert.equal(output.cases[0].branches[0].name, 'Private branch name');
    assert.doesNotMatch(JSON.stringify(output), /private recipient/u);
  });

  test('requires the review acknowledgement before reading a case artefact', async () => {
    let reads = 0;
    let stderr = '';
    const code = await runCli(['case-pack', 'cases.json', '--audience', 'trusted'], {
      stdout: { write() {} },
      stderr: { write(value) { stderr += value; } },
      readArtifactInput: async () => {
        reads += 1;
        return JSON.stringify(exportedCases());
      },
    });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.equal(reads, 0);
    assert.match(stderr, /case-pack requires --reviewed/iu);
  });

  test('verifies the complete browser hand-off and rejects changed content', () => {
    const pack = buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW);
    assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
    const changed = structuredClone(pack);
    changed.cases[0]!.status = 'escalated';
    assert.throws(() => verifyCliCasePack(changed), /mismatched Case report projection|failed its SHA-256/iu);
  });

  test('preserves references for internal and trusted audiences only', () => {
    for (const audience of ['internal', 'trusted'] as const) {
      const pack = buildCliCasePack(JSON.stringify(exportedCases()), { audience, reviewed: true }, NOW);
      assert.deepEqual(pack.cases[0]?.brandProfileIds, ['Profile_A', 'profile-b']);
      assert.equal(pack.packet.redactionManifest.brandProfileReferencesOmitted, 0);
      assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
    }
  });

  test('keeps case-pack v1 compatibility through the frozen v12 and report-v8 contracts', () => {
    for (const audience of ['public', 'trusted'] as const) {
      const legacy = legacyCasePack(audience);
      assert.equal((legacy.packet as Record<string, unknown>).version, 1);
      assert.deepEqual(verifyCliCasePack(legacy), { caseCount: 1 });
    }
    assert.deepEqual(verifyCliCasePack(schema10CasePack('public')), { caseCount: 1 });
    for (const audience of ['public', 'trusted', 'internal'] as const) {
      const frozenV12 = historicalCasePack(12, audience);
      assert.equal((frozenV12.packet as Record<string, unknown>).version, 1);
      assert.equal((((frozenV12.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!).schemaVersion, 8);
      assert.deepEqual(verifyCliCasePack(frozenV12), { caseCount: 1 });
    }
  });

  test('verifies authentic historical evidence identities and rejects re-signed identity changes in every epoch and audience', () => {
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      for (const audience of ['public', 'trusted', 'internal'] as const) {
        const authentic = historicalCasePack(version, audience);
        assert.deepEqual(verifyCliCasePack(authentic), { caseCount: 1 });

        for (const field of ['id', 'fingerprint'] as const) {
          const changed = structuredClone(authentic);
          const item = (changed.cases as Array<Record<string, unknown>>)[0]!;
          const snapshot = (item.evidenceHistory as Array<Record<string, unknown>>)[0]!;
          snapshot[field] = field === 'id' ? 'ev-forged' : 'forged';
          assert.throws(
            () => verifyCliCasePack(resign(changed)),
            /invalid historical evidence identity|changed or unbounded historical evidenceHistory/iu,
          );
        }
      }
    }
  });

  test('requires every historical Case own key before defaults can validate a coordinated report rewrite', () => {
    const schema3Internal = historicalCasePack(3, 'internal');
    const schema3Case = (schema3Internal.cases as Array<Record<string, unknown>>)[0]!;
    const schema3Report = (((schema3Internal.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
    assert.equal((schema3Case.actions as unknown[]).length, 1);
    assert.equal(((schema3Report.analystResponse as Record<string, unknown>).actions as unknown[]).length, 1);

    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      for (const audience of ['public', 'trusted', 'internal'] as const) {
        for (const key of historicalRequiredCaseKeys(version)) {
          const changed = historicalCasePack(version, audience);
          coordinateHistoricalCaseOmission(changed, key);
          if (key === 'status') {
            const report = (((changed.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
            assert.equal((report.case as Record<string, unknown>).status, 'new');
          }
          assert.throws(
            () => verifyCliCasePack(resign(changed)),
            new RegExp(`missing required historical Case field cases\\[0\\]\\.${key}`, 'iu'),
            `schema ${version} ${audience} ${key}`,
          );
        }
      }
    }
  });

  test('requires exact historical report roots, Case fields, snapshots, timeline cardinality, and epoch response shape', () => {
    const epochs: Array<[number, number]> = [[2, 1], [3, 2], [4, 3], [9, 4], [10, 5], [10, 6], [11, 7], [12, 8]];
    for (const [caseVersion, reportVersion] of epochs) {
      for (const audience of ['public', 'trusted', 'internal'] as const) {
        const fixture = () => historicalCasePackFixture(caseVersion, audience, { reportVersion });
        assert.deepEqual(verifyCliCasePack(fixture()), { caseCount: 1 });
        const mutations: Array<(report: Record<string, unknown>) => void> = [
          (report) => { delete report.generatedAt; },
          (report) => { delete report.application; },
          (report) => { delete report.currentAssessment; },
          (report) => { delete report.evidenceTimeline; },
          (report) => { (report.evidenceTimeline as unknown[]).pop(); },
          (report) => {
            const timeline = report.evidenceTimeline as Array<Record<string, unknown>>;
            (timeline[1]!.changes as unknown[]).pop();
          },
          (report) => {
            const timeline = report.evidenceTimeline as Array<Record<string, unknown>>;
            ((timeline[1]!.changes as Array<Record<string, unknown>>)[0]!).after = 31;
          },
          (report) => { delete (report.case as Record<string, unknown>).status; },
          (report) => {
            const reportCase = report.case as Record<string, unknown>;
            report.case = {
              id: reportCase.id,
              domain: reportCase.domain,
              ...(reportVersion >= 8 ? { brandProfileIds: reportCase.brandProfileIds } : {}),
            };
          },
          (report) => {
            if (reportVersion === 1) report.analystResponse = { evidencePins: [], decisions: [], actions: [] };
            else delete report.analystResponse;
          },
        ];
        for (const mutate of mutations) {
          const changed = fixture();
          const report = (((changed.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
          mutate(report);
          assert.throws(
            () => verifyCliCasePack(resign(changed)),
            /invalid or mismatched historical (?:Case report|report generation time)/iu,
          );
        }
      }
    }
  });

  test('rejects adversarial current reference and public-redaction manifests after integrity is recomputed', () => {
    const publicPack = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    const packet = publicPack.packet as Record<string, unknown>;
    const manifest = packet.redactionManifest as Record<string, unknown>;
    delete manifest.brandProfileReferencesOmitted;
    assert.throws(() => verifyCliCasePack(resign(publicPack)), /invalid Brand Profile redaction manifest/iu);

    const leaked = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (leaked.cases as Array<Record<string, unknown>>)[0]!.brandProfileIds = ['Profile_A'];
    assert.throws(() => verifyCliCasePack(resign(leaked)), /invalid Brand Profile redaction manifest|mismatched Case report projection/iu);

    const reportLeak = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    const reportPacket = reportLeak.packet as Record<string, unknown>;
    const report = (reportPacket.reports as Array<Record<string, unknown>>)[0]!;
    (report.case as Record<string, unknown>).brandProfileIds = ['Profile_A'];
    assert.throws(() => verifyCliCasePack(resign(reportLeak)), /invalid Brand Profile redaction manifest|mismatched Case report projection/iu);

    const legacyReportLeak = structuredClone(legacyCasePack('public'));
    const legacyPacket = legacyReportLeak.packet as Record<string, unknown>;
    const legacyReport = (legacyPacket.reports as Array<Record<string, unknown>>)[0]!;
    (legacyReport.case as Record<string, unknown>).brandProfileIds = ['Profile_A'];
    assert.throws(() => verifyCliCasePack(resign(legacyReportLeak)), /outside its versioned case or report fields/iu);

    const mismatched = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    const mismatchPacket = mismatched.packet as Record<string, unknown>;
    const mismatchReport = (mismatchPacket.reports as Array<Record<string, unknown>>)[0]!;
    (mismatchReport.case as Record<string, unknown>).brandProfileIds = ['profile-b', 'Profile_A'];
    assert.throws(() => verifyCliCasePack(resign(mismatched)), /inconsistent Brand Profile references|mismatched Case report projection/iu);

    const malformed = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (malformed.cases as Array<Record<string, unknown>>)[0]!.brandProfileIds = [' profile-a'];
    assert.throws(() => verifyCliCasePack(resign(malformed)), /invalid Brand Profile references|would be repaired, truncated/iu);
  });

  test('rejects nested reference smuggling, mismatched reports, and malformed manifests after resigning', () => {
    const nested = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (nested.packet as Record<string, unknown>).unexpected = { brandProfileIds: ['Profile_A'] };
    assert.throws(() => verifyCliCasePack(resign(nested)), /outside its versioned case or report fields|unexpected packet envelope field/iu);

    const disguisedPath = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    disguisedPath['cases[0]'] = { brandProfileIds: ['Profile_A'] };
    assert.throws(() => verifyCliCasePack(resign(disguisedPath)), /outside its versioned case or report fields|unexpected root envelope field/iu);

    const mismatchedId = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    const mismatchedPacket = mismatchedId.packet as Record<string, unknown>;
    const mismatchedReport = (mismatchedPacket.reports as Array<Record<string, unknown>>)[0]!;
    (mismatchedReport.case as Record<string, unknown>).id = 'different-case';
    assert.throws(() => verifyCliCasePack(resign(mismatchedId)), /invalid or mismatched Case report/iu);

    const wrongReportVersion = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    ((wrongReportVersion.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!.schemaVersion = 7;
    assert.throws(() => verifyCliCasePack(resign(wrongReportVersion)), /invalid or mismatched Case report/iu);

    const wrongSourceCount = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (((wrongSourceCount.packet as Record<string, unknown>).redactionManifest) as Record<string, unknown>).sourceCaseCount = 2;
    assert.throws(() => verifyCliCasePack(resign(wrongSourceCount)), /invalid audience redaction manifest/iu);

    const wrongExclusions = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    const exclusionsManifest = ((wrongExclusions.packet as Record<string, unknown>).redactionManifest) as Record<string, unknown>;
    exclusionsManifest.excluded = [...exclusionsManifest.excluded as string[], 'Unexpected field'];
    assert.throws(() => verifyCliCasePack(resign(wrongExclusions)), /invalid audience redaction manifest/iu);

    let audienceConversionCalls = 0;
    const coerciveAudience = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (coerciveAudience.packet as Record<string, unknown>).audience = {
      toString() {
        audienceConversionCalls += 1;
        return 'public';
      },
    };
    assert.throws(() => verifyCliCasePack(resign(coerciveAudience)), /invalid/iu);
    assert.equal(audienceConversionCalls, 0);

    const overCount = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (((overCount.packet as Record<string, unknown>).redactionManifest) as Record<string, unknown>).brandProfileReferencesOmitted = 201;
    assert.throws(() => verifyCliCasePack(resign(overCount)), /invalid Brand Profile redaction manifest/iu);

    const trustedCount = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (((trustedCount.packet as Record<string, unknown>).redactionManifest) as Record<string, unknown>).brandProfileReferencesOmitted = 1;
    assert.throws(() => verifyCliCasePack(resign(trustedCount)), /inconsistent Brand Profile references/iu);

    const legacyCount = structuredClone(legacyCasePack('trusted'));
    (((legacyCount.packet as Record<string, unknown>).redactionManifest) as Record<string, unknown>).brandProfileReferencesOmitted = 0;
    assert.throws(() => verifyCliCasePack(resign(legacyCount)), /legacy CLI case pack.*redaction manifest|unexpected redaction manifest field/iu);
  });

  test('rejects malformed schema 14 builder references before normalisation while keeping legacy input lenient', () => {
    for (const value of [undefined, 'profile-a', ['profile-a', 'profile-a'], [' profile-a'], Array.from({ length: 9 }, (_, index) => `profile-${index}`)]) {
      const source = structuredClone(exportedCases()) as unknown as { version: number; cases: Array<Record<string, unknown>> };
      if (value === undefined) delete source.cases[0]!.brandProfileIds;
      else source.cases[0]!.brandProfileIds = value;
      assert.throws(
        () => buildCliCasePack(JSON.stringify(source), { audience: 'trusted', reviewed: true }, NOW),
        /schema 14 input requires exact canonical Case identities and an exact, unique, bounded brandProfileIds array/iu,
      );
    }

    const legacy = structuredClone(exportedCases()) as unknown as { version: number; cases: Array<Record<string, unknown>> };
    legacy.version = 11;
    legacy.cases[0]!.brandProfileIds = [' smuggled'];
    const built = buildCliCasePack(JSON.stringify(legacy), { audience: 'trusted', reviewed: true }, NOW);
    assert.deepEqual(built.cases[0]?.brandProfileIds, []);
  });

  test('keeps direct verification cycle-safe', () => {
    const cyclic = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    const extra: Record<string, unknown> = {};
    extra.self = extra;
    (cyclic.packet as Record<string, unknown>).cycle = extra;
    assert.throws(() => verifyCliCasePack(cyclic), /not serializable/iu);
  });

  test('refuses a case set that cannot be transferred without omission', () => {
    const source = exportedCases();
    source.cases = Array.from({ length: MAX_CASE_PACK_CASES + 1 }, (_, index) => ({
      ...source.cases[0]!,
      id: `case-${index}`,
      domain: `case-${index}.invalid`,
    }));
    assert.throws(
      () => buildCliCasePack(JSON.stringify(source), { audience: 'trusted', reviewed: true }, NOW),
      /limited to 25 reviewed cases.*no case is silently omitted/iu,
    );
  });

  test('refuses malformed records instead of silently dropping them', () => {
    const original = exportedCases();
    const source: { version: number; cases: unknown[] } = {
      version: original.version,
      cases: [...original.cases],
    };
    source.cases = [...source.cases, { id: 'invalid-case', brandProfileIds: [] }];
    assert.throws(
      () => buildCliCasePack(JSON.stringify(source), { audience: 'trusted', reviewed: true }, NOW),
      /missing, unsafe, non-canonical, or duplicate Case identity/iu,
    );
  });

  test('keeps generated packages within the browser import byte boundary', () => {
    const source = exportedCases();
    source.cases = Array.from({ length: MAX_CASE_PACK_CASES }, (_, caseIndex) => ({
      ...source.cases[0]!,
      id: `case-${caseIndex}`,
      domain: `case-${caseIndex}.invalid`,
      notes: Array.from({ length: 50 }, (_, noteIndex) => ({
        id: `note-${caseIndex}-${noteIndex}`,
        body: 'x'.repeat(2000),
        createdAt: NOW,
      })),
    }));
    assert.throws(
      () => buildCliCasePack(JSON.stringify(source), { audience: 'internal', reviewed: true }, NOW),
      /exceeds the browser 2 MiB import limit.*no evidence is silently omitted/iu,
    );
    const trusted = buildCliCasePack(JSON.stringify(source), { audience: 'trusted', reviewed: true }, NOW);
    assert.equal(trusted.cases.length, MAX_CASE_PACK_CASES);
    assert.deepEqual(verifyCliCasePack(trusted), { caseCount: MAX_CASE_PACK_CASES });
  });

  test('rejects current builder inputs that normalisation would repair or truncate', () => {
    const mutations: Array<(item: Record<string, unknown>) => void> = [
      (item) => { item.id = ' case-1'; },
      (item) => { item.domain = 'EXAMPLE.test'; },
      (item) => { item.unexpected = true; },
      (item) => { delete item.reviewReasonCode; },
      (item) => { item.notes = Array.from({ length: 51 }, (_, index) => ({ id: `note-${index}`, body: 'bounded', createdAt: NOW })); },
      (item) => { item.actions = Array.from({ length: 51 }, (_, index) => ({ ...(exportedCases().cases[0]!.actions[0]!), id: `action-${index}` })); },
    ];
    for (const mutate of mutations) {
      const source = structuredClone(exportedCases()) as unknown as { version: number; cases: Array<Record<string, unknown>> };
      mutate(source.cases[0]!);
      assert.throws(
        () => buildCliCasePack(JSON.stringify(source), { audience: 'internal', reviewed: true }, NOW),
        /Case identity|would be repaired, truncated, or otherwise changed/iu,
      );
    }

    const duplicates = structuredClone(exportedCases());
    duplicates.cases.push({ ...structuredClone(duplicates.cases[0]!), id: 'case-2' });
    assert.throws(
      () => buildCliCasePack(JSON.stringify(duplicates), { audience: 'internal', reviewed: true }, NOW),
      /duplicate Case identity/iu,
    );
  });

  test('rejects re-signed public and trusted audience leaks in both cases and reports', () => {
    const publicMutations: Array<(pack: Record<string, unknown>) => void> = [
      (pack) => { (pack.cases as Array<Record<string, unknown>>)[0]!.notes = [{ id: 'note-leak', body: 'leak', createdAt: NOW }]; },
      (pack) => { (pack.cases as Array<Record<string, unknown>>)[0]!.actions = structuredClone(exportedCases().cases[0]!.actions); },
      (pack) => { (pack.cases as Array<Record<string, unknown>>)[0]!.assertions = structuredClone(exportedCases().cases[0]!.assertions); },
      (pack) => { (pack.cases as Array<Record<string, unknown>>)[0]!.branches = structuredClone(exportedCases().cases[0]!.branches); },
      (pack) => { ((pack.cases as Array<Record<string, unknown>>)[0]!.manualTrail as Array<Record<string, unknown>>)[0]!.target = 'leak'; },
      (pack) => {
        const report = (((pack.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
        (report.analystResponse as Record<string, unknown>).actions = structuredClone(exportedCases().cases[0]!.actions);
      },
    ];
    for (const mutate of publicMutations) {
      const pack = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
      mutate(pack);
      assert.throws(() => verifyCliCasePack(resign(pack)), /excluded by its audience|mismatched Case report projection|would be repaired, truncated/iu);
    }

    const trustedRecipient = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    ((trustedRecipient.cases as Array<Record<string, unknown>>)[0]!.actions as Array<Record<string, unknown>>)[0]!.recipient = 'leak';
    assert.throws(() => verifyCliCasePack(resign(trustedRecipient)), /unredacted action recipient/iu);

    const trustedTarget = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    ((trustedTarget.cases as Array<Record<string, unknown>>)[0]!.manualTrail as Array<Record<string, unknown>>)[0]!.target = 'leak';
    assert.throws(() => verifyCliCasePack(resign(trustedTarget)), /manual-trail target excluded/iu);

    const nested = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (nested.packet as Record<string, unknown>).unexpected = { actions: [{ recipient: 'leak' }], notes: ['leak'] };
    assert.throws(() => verifyCliCasePack(resign(nested)), /audience-sensitive data outside|unexpected packet envelope field/iu);
  });

  test('closes every envelope and every historical audience projection against scalar and nested private fields', () => {
    const attacks: Array<(pack: Record<string, unknown>) => void> = [
      (pack) => { pack.unexpected = { rawWhoisPayload: 'private material' }; },
      (pack) => { (pack.packet as Record<string, unknown>).unexpected = { credential: 'private material', privateNotes: ['private'] }; },
      (pack) => { (((pack.packet as Record<string, unknown>).redactionManifest) as Record<string, unknown>).unexpected = 'private material'; },
      (pack) => { ((((pack.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!)).unexpected = { rawWhoisPayload: 'private material' }; },
    ];
    for (const mutate of attacks) {
      const pack = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
      mutate(pack);
      assert.throws(() => verifyCliCasePack(resign(pack)), /unexpected .*field/iu);
    }
    const integrityAttack = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (integrityAttack.integrity as Record<string, unknown>).unexpected = 'private material';
    assert.throws(() => verifyCliCasePack(integrityAttack), /unexpected integrity envelope field/iu);

    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      for (const audience of ['public', 'trusted', 'internal'] as const) {
        assert.deepEqual(verifyCliCasePack(historicalCasePack(version, audience)), { caseCount: 1 });

        const legacyCaseNested = historicalCasePack(version, audience);
        const legacyCase = (legacyCaseNested.cases as Array<Record<string, unknown>>)[0]!;
        ((legacyCase.evidenceHistory as Array<Record<string, unknown>>)[0]!).unexpected = { privateNotes: 'private material' };
        assert.throws(() => verifyCliCasePack(resign(legacyCaseNested)), /unexpected historical evidenceHistory\[0\]\.unexpected field/iu);

        const legacyReportNested = historicalCasePack(version, audience);
        const legacyReport = (((legacyReportNested.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
        (legacyReport.application as Record<string, unknown>).credential = 'private material';
        assert.throws(() => verifyCliCasePack(resign(legacyReportNested)), /invalid or mismatched historical Case report projection/iu);

        const scalarCase = historicalCasePack(version, audience);
        (scalarCase.cases as Array<Record<string, unknown>>)[0]!.evidenceHistory = 'private material';
        assert.throws(() => verifyCliCasePack(resign(scalarCase)), /invalid historical evidence collection/iu);

        const scalarReport = historicalCasePack(version, audience);
        (((scalarReport.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!).application = 'private material';
        assert.throws(() => verifyCliCasePack(resign(scalarReport)), /invalid or mismatched historical Case report projection/iu);

        const changedReportScalar = historicalCasePack(version, audience);
        const changedReport = (((changedReportScalar.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
        (changedReport.case as Record<string, unknown>).status = 'escalated';
        assert.throws(
          () => verifyCliCasePack(resign(changedReportScalar)),
          /invalid or mismatched historical Case report projection/iu,
        );
      }
    }

    const changedLimitation = schema10CasePack('public');
    (((changedLimitation.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!).limitations = 'private material';
    assert.throws(() => verifyCliCasePack(resign(changedLimitation)), /invalid or mismatched historical Case report projection/iu);
  });

  test('rejects re-signed identity rewrites and report-epoch smuggling', () => {
    for (const input of [
      structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>,
      structuredClone(legacyCasePack('trusted')),
    ]) {
      const item = (input.cases as Array<Record<string, unknown>>)[0]!;
      const report = (((input.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!);
      item.domain = 'EXAMPLE.test';
      (report.case as Record<string, unknown>).domain = 'EXAMPLE.test';
      assert.throws(() => verifyCliCasePack(resign(input)), /missing, unsafe, non-canonical, or duplicate Case identity/iu);
    }

    const old = schema10CasePack('public');
    (old.cases as Array<Record<string, unknown>>)[0]!.branches = [];
    assert.throws(() => verifyCliCasePack(resign(old)), /Investigation branch outside its versioned fields/iu);

    const wrongEpoch = schema10CasePack('public');
    (((wrongEpoch.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!).schemaVersion = 7;
    assert.throws(() => verifyCliCasePack(resign(wrongEpoch)), /invalid or mismatched Case report/iu);

    const wrongPackEpoch = schema10CasePack('public');
    (wrongPackEpoch.packet as Record<string, unknown>).version = 2;
    (wrongPackEpoch.integrity as Record<string, unknown>).canonicalization = 'sorted-json-v2';
    assert.throws(() => verifyCliCasePack(resign(wrongPackEpoch)), /structure or integrity envelope is invalid/iu);

    const internalReportLeak = schema10CasePack('internal');
    const internalReport = ((((internalReportLeak.packet as Record<string, unknown>).reports) as Array<Record<string, unknown>>)[0]!);
    (internalReport.case as Record<string, unknown>).notes = [{ body: 'report-only note' }];
    assert.throws(() => verifyCliCasePack(resign(internalReportLeak)), /invalid or mismatched historical Case report projection/iu);
  });

  test('rejects schema-12 profile-context fields smuggled into every historical Case and report epoch', () => {
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      for (const audience of ['public', 'trusted', 'internal'] as const) {
        const caseEvidence = historicalCasePack(version, audience);
        (caseEvidence.cases as Array<Record<string, unknown>>)[0]!.evidenceHistory = [{
          profileContextState: 'ready',
          profileContextLimitation: 'Smuggled current-only provenance.',
        }];
        assert.throws(
          () => verifyCliCasePack(resign(caseEvidence)),
          /schema-12 profile context fields outside the historical cases evidence snapshot 0 epoch/iu,
        );

        const currentAssessment = historicalCasePack(version, audience);
        const currentReport = ((currentAssessment.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!;
        currentReport.currentAssessment = {
          profileContextState: 'unavailable',
          profileContextLimitation: 'Smuggled report projection.',
        };
        assert.throws(
          () => verifyCliCasePack(resign(currentAssessment)),
          /schema-12 profile context fields outside the historical current assessment epoch/iu,
        );

        const timeline = historicalCasePack(version, audience);
        const timelineReport = ((timeline.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!;
        timelineReport.evidenceTimeline = [{
          snapshot: {
            profileContextState: 'loading',
            profileContextLimitation: 'Smuggled timeline projection.',
          },
        }];
        assert.throws(
          () => verifyCliCasePack(resign(timeline)),
          /schema-12 profile context fields outside the historical report timeline snapshot 0 epoch/iu,
        );

        for (const field of ['profileContextState', 'profileContextLimitation']) {
          const timelineChange = historicalCasePack(version, audience);
          const report = ((timelineChange.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!;
          report.evidenceTimeline = [{
            changes: [{
              field,
              label: 'Registrar',
              before: 'previous value',
              after: 'next value',
              tone: 'neutral',
            }],
          }];
          assert.throws(
            () => verifyCliCasePack(resign(timelineChange)),
            /schema-12 profile context fields outside the historical report timeline change 0\.0 epoch/iu,
          );
        }

        const forgedLabel = historicalCasePack(version, audience);
        const forgedLabelReport = ((forgedLabel.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!;
        forgedLabelReport.evidenceTimeline = [{
          changes: [{
            field: 'registrar',
            label: 'Profile context limitation',
            before: null,
            after: 'unavailable',
            tone: 'warn',
          }],
        }];
        assert.throws(
          () => verifyCliCasePack(resign(forgedLabel)),
          /schema-12 profile context fields outside the historical report timeline change 0\.0 epoch/iu,
        );
      }
    }
  });

  test('requires every retained historical scalar and bounded array item to match browser normalisation', () => {
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const maximum = historicalCasePack(version, 'internal');
      (maximum.cases as Array<Record<string, unknown>>)[0]!.notes = Array.from({ length: 50 }, (_, index) => ({
        id: `note-${index}`,
        body: 'x'.repeat(2000),
        createdAt: NOW,
      }));
      assert.deepEqual(verifyCliCasePack(resign(maximum)), { caseCount: 1 });

      const overCount = structuredClone(maximum);
      ((overCount.cases as Array<Record<string, unknown>>)[0]!.notes as Array<Record<string, unknown>>).push({
        id: 'note-over-bound',
        body: 'bounded note',
        createdAt: NOW,
      });
      assert.throws(
        () => verifyCliCasePack(resign(overCount)),
        /data outside its normalised cases\[0\]\.notes projection/iu,
      );

      const overlong = historicalCasePack(version, 'internal');
      (overlong.cases as Array<Record<string, unknown>>)[0]!.notes = [{
        id: 'note-overlong',
        body: 'x'.repeat(3000),
        createdAt: NOW,
      }];
      assert.throws(
        () => verifyCliCasePack(resign(overlong)),
        /changed or unbounded cases\[0\]\.notes\[0\]\.body projection value/iu,
      );
    }
  });
});
