import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  buildCliCasePack,
  MAX_CASE_PACK_CASES,
  verifyCliCasePack,
} from '../cli/case-pack.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { CASE_REPORT_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { CASE_SCHEMA_VERSION, createCase, updateCase, normalizeCaseStore, caseAudienceExclusions, projectCaseForAudience } from '../frontend/src/lib/analysis/case-model.ts';
import {
  canonicalArtifactJsonV2,
} from '../frontend/src/lib/analysis/artifact-integrity.ts';

const NOW = '2026-08-05T03:00:00.000Z';

function exportedCases() {
  const migrated = normalizeCaseStore({
    version: CASE_SCHEMA_VERSION,
    cases: [{
      id: 'case-1', domain: 'example.test', status: 'reviewing', disposition: 'unreviewed', reviewReasonCode: null, tags: [],
      brandProfileIds: ['Profile_A', 'profile-b'],
      notes: [{ id: 'note-1', body: 'private analyst note', createdAt: NOW }], source: 'lookup', evidenceHistory: [], evidencePins: [], decisions: [],
      actions: [{ id: 'action-1', type: 'network_hosting_report', recipient: 'private recipient', contactSource: 'manual', routeObservedAt: null, routeReviewAfter: null, contactLimitations: [], dueAt: null, state: 'planned', reference: null, followUpAt: null, outcome: null, createdAt: NOW, updatedAt: NOW }],
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
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v2',
      digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex')}`,
    },
  } as unknown as T;
}

describe('CLI case pack', () => {
  test('requires deliberate review and applies the public audience boundary', () => {
    assert.throws(() => buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: false }, NOW), /requires --reviewed/iu);
    const pack = buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW);
    assert.equal(pack.version, CASE_SCHEMA_VERSION);
    assert.equal(pack.cases.length, 1);
    assert.equal(pack.packet.reports[0]?.schema, 'whoisleuth.case-report');
    assert.equal(pack.packet.reports[0]?.schemaVersion, CASE_REPORT_SCHEMA_VERSION);
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

  test('retains exact submitted hostnames in the Case collection without adding them to the report projection', () => {
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

  test('accepts the latest public export and preserves published pack validation independently of the current writer', () => {
    const bytes = readFileSync(new URL('./fixtures/case-lifecycle/case-export-v15.json', import.meta.url), 'utf8');
    const pack = buildCliCasePack(bytes, { audience: 'internal', reviewed: true }, NOW);
    assert.equal(pack.version, CASE_SCHEMA_VERSION);
    assert.equal(pack.packet.reports[0]?.schemaVersion, CASE_REPORT_SCHEMA_VERSION);
    assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
    const published = JSON.parse(readFileSync(new URL('./fixtures/case-lifecycle/cli-case-pack-v2-case-v15-current.json', import.meta.url), 'utf8'));
    assert.equal(published.version, 15);
    assert.equal(published.packet.reports[0].schemaVersion, 11);
    assert.deepEqual(verifyCliCasePack(published), { caseCount: 1 });
    const retainedPin = createCase({ domain: 'undated.invalid', evidencePin: {
      label: 'Retained observation', value: 'Source fact', source: 'Fixture', observedAt: null,
    } }, NOW).evidencePins[0]!;
    published.cases[0].evidencePins = [retainedPin];
    assert.throws(() => verifyCliCasePack(resign(published)), /published Case 15.*known observation time/iu);
    const invalidInput = JSON.parse(bytes);
    invalidInput.cases[0].evidencePins = [retainedPin];
    assert.throws(() => buildCliCasePack(JSON.stringify(invalidInput), { audience: 'internal', reviewed: true }, NOW), /published Case 15.*known observation time/iu);
  });

  test('preserves published observation ordering while migrating all sightings to the current recorded-order writer', () => {
    let record = createCase({ domain: 'ordering.invalid', sighting: {
      state: 'reported_by_provider', source: 'Fixture report', observedAt: '2026-08-04T00:00:00.000Z',
    } }, NOW);
    record = updateCase([record], record.id, { sighting: {
      state: 'reported_by_provider', source: 'Earlier fixture observation', observedAt: '2026-08-03T00:00:00.000Z',
    } }, '2026-08-05T04:00:00.000Z').record;
    const current = buildCliCasePack(JSON.stringify({ version: CASE_SCHEMA_VERSION, cases: [record] }), { audience: 'internal', reviewed: true }, NOW);
    const published = JSON.parse(JSON.stringify(current));
    published.version = 15;
    published.packet.reports[0].schemaVersion = 11;
    published.packet.reports[0].limitations = JSON.parse(readFileSync(new URL('./fixtures/case-lifecycle/case-report-v11.json', import.meta.url), 'utf8')).limitations;
    published.cases[0].sightings.reverse();
    published.packet.reports[0].analystResponse.sightings.reverse();
    assert.deepEqual(verifyCliCasePack(resign(published)), { caseCount: 1 });
    const repackaged = buildCliCasePack(JSON.stringify({ version: 15, cases: published.cases }), { audience: 'internal', reviewed: true }, NOW);
    assert.equal(repackaged.version, CASE_SCHEMA_VERSION);
    assert.deepEqual(repackaged.cases[0]!.sightings, record.sightings);
    assert.deepEqual(verifyCliCasePack(repackaged), { caseCount: 1 });
  });

  test('packages unknown current observation times without inventing source timestamps', () => {
    const source = exportedCases();
    const undated = createCase({ domain: 'undated.invalid', evidencePin: {
      label: 'Undated observation', value: 'Retained fact', source: 'Fixture', observedAt: null,
    } }, NOW);
    source.cases = [undated];
    const pack = buildCliCasePack(JSON.stringify(source), { audience: 'internal', reviewed: true }, NOW);
    assert.equal(pack.cases[0]!.evidencePins[0]!.observedAt, null);
    assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
  });

  test('verifies the complete browser hand-off and rejects changed content', () => {
    const pack = buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW);
    assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
    const changed = structuredClone(pack);
    changed.cases[0]!.status = 'escalated';
    assert.throws(() => verifyCliCasePack(changed), /mismatched Case report projection|failed its SHA-256/iu);
  });

  test('rejects retired, future, accessor-bearing, sparse, and deep Case-pack inputs without invoking accessors', () => {
    assert.throws(
      () => verifyCliCasePack({ version: 12, cases: [], packet: { schema: 'whoisleuth.cli.case-pack', version: 1 } }),
      /case-pack version 1 is retired.*no data was changed/iu,
    );
    assert.throws(
      () => verifyCliCasePack({ version: 15, cases: [], packet: { schema: 'whoisleuth.cli.case-pack', version: 3 } }),
      /newer than the supported version 2.*no data was changed/iu,
    );
    let invoked = false;
    const accessor = { version: CASE_SCHEMA_VERSION } as Record<string, unknown>;
    Object.defineProperty(accessor, 'packet', { enumerable: true, get() { invoked = true; return {}; } });
    assert.throws(() => verifyCliCasePack(accessor), /accessor property/iu);
    assert.equal(invoked, false);
    assert.throws(() => verifyCliCasePack({ version: CASE_SCHEMA_VERSION, cases: new Array(1) }), /sparse/iu);
    let deep: Record<string, unknown> = {};
    for (let depth = 0; depth < 50; depth += 1) deep = { nested: deep };
    assert.throws(() => verifyCliCasePack(deep), /nesting limit/iu);
  });

  test('preserves references for internal and trusted audiences only', () => {
    for (const audience of ['internal', 'trusted'] as const) {
      const pack = buildCliCasePack(JSON.stringify(exportedCases()), { audience, reviewed: true }, NOW);
      assert.deepEqual(pack.cases[0]?.brandProfileIds, ['Profile_A', 'profile-b']);
      assert.equal(pack.packet.redactionManifest.brandProfileReferencesOmitted, 0);
      assert.deepEqual(verifyCliCasePack(pack), { caseCount: 1 });
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
    assert.throws(() => verifyCliCasePack(resign(leaked)), /brandProfileIds excluded by its audience|invalid Brand Profile redaction manifest|mismatched Case report projection/iu);

    const reportLeak = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    const reportPacket = reportLeak.packet as Record<string, unknown>;
    const report = (reportPacket.reports as Array<Record<string, unknown>>)[0]!;
    (report.case as Record<string, unknown>).brandProfileIds = ['Profile_A'];
    assert.throws(() => verifyCliCasePack(resign(reportLeak)), /invalid Brand Profile redaction manifest|mismatched Case report projection/iu);

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

    const futureReportVersion = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    ((futureReportVersion.packet as Record<string, unknown>).reports as Array<Record<string, unknown>>)[0]!.schemaVersion = Number.MAX_SAFE_INTEGER;
    assert.throws(() => verifyCliCasePack(resign(futureReportVersion)), /invalid or mismatched Case report/iu);

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
    assert.throws(() => verifyCliCasePack(resign(coerciveAudience)), /non-JSON value|invalid/iu);
    assert.equal(audienceConversionCalls, 0);

    const overCount = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (((overCount.packet as Record<string, unknown>).redactionManifest) as Record<string, unknown>).brandProfileReferencesOmitted = 201;
    assert.throws(() => verifyCliCasePack(resign(overCount)), /invalid Brand Profile redaction manifest/iu);

    const trustedCount = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (((trustedCount.packet as Record<string, unknown>).redactionManifest) as Record<string, unknown>).brandProfileReferencesOmitted = 1;
    assert.throws(() => verifyCliCasePack(resign(trustedCount)), /inconsistent Brand Profile references/iu);

  });

  test('rejects malformed current builder references before normalisation', () => {
    for (const value of [undefined, 'profile-a', ['profile-a', 'profile-a'], [' profile-a'], Array.from({ length: 9 }, (_, index) => `profile-${index}`)]) {
      const source = structuredClone(exportedCases()) as unknown as { version: number; cases: Array<Record<string, unknown>> };
      if (value === undefined) delete source.cases[0]!.brandProfileIds;
      else source.cases[0]!.brandProfileIds = value;
      assert.throws(
        () => buildCliCasePack(JSON.stringify(source), { audience: 'trusted', reviewed: true }, NOW),
        /input requires exact canonical Case identities and an exact, unique, bounded brandProfileIds array/iu,
      );
    }

  });

  test('keeps direct verification cycle-safe', () => {
    const cyclic = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    const extra: Record<string, unknown> = {};
    extra.self = extra;
    (cyclic.packet as Record<string, unknown>).cycle = extra;
    assert.throws(() => verifyCliCasePack(cyclic), /cyclic object reference/iu);
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
    assert.throws(() => verifyCliCasePack(resign(trustedRecipient)), /actions excluded by its audience|unredacted action recipient/iu);

    const trustedTarget = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'trusted', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    ((trustedTarget.cases as Array<Record<string, unknown>>)[0]!.manualTrail as Array<Record<string, unknown>>)[0]!.target = 'leak';
    assert.throws(() => verifyCliCasePack(resign(trustedTarget)), /manualTrail excluded by its audience|manual-trail target excluded/iu);

    const nested = structuredClone(buildCliCasePack(JSON.stringify(exportedCases()), { audience: 'public', reviewed: true }, NOW)) as unknown as Record<string, unknown>;
    (nested.packet as Record<string, unknown>).unexpected = { actions: [{ recipient: 'leak' }], notes: ['leak'] };
    assert.throws(() => verifyCliCasePack(resign(nested)), /audience-sensitive data outside|unexpected packet envelope field/iu);
  });

  test('verifies immutable legacy packs and independently rejects hidden report audience leaks', () => {
    for (const version of [12, 13, 14]) {
      const name = version === 12 ? 'cli-case-pack-v2-case-v12-public.json' : `cli-case-pack-v2-case-v${version}.json`;
      const bytes = readFileSync(new URL(`./fixtures/case-lifecycle/${name}`, import.meta.url), 'utf8');
      const original = JSON.parse(bytes);
      assert.deepEqual(verifyCliCasePack(original), { caseCount: 1 });
      for (const audience of ['public', 'trusted'] as const) {
        const pack = structuredClone(original);
        const item = pack.cases[0];
        const report = pack.packet.reports[0];
        const response = report.analystResponse;
        // Construct a valid historical-shaped input without altering the fixture.
        // Negative expectations below use independent known-sensitive values.
        const projection = projectCaseForAudience(normalizeCaseStore(pack).cases[0]!, audience);
        for (const key of ['notes', 'actions', 'assertions', 'branches', 'observedEffects', 'closures', 'manualTrail', 'brandProfileIds'] as const) {
          if (Object.hasOwn(item, key)) item[key] = structuredClone(projection[key]);
          if (Object.hasOwn(response, key)) response[key] = structuredClone(projection[key]);
          if (Object.hasOwn(report.case, key)) report.case[key] = structuredClone(projection[key]);
        }
        pack.packet.audience = audience;
        pack.packet.redactionManifest.excluded = caseAudienceExclusions(audience, version);
        assert.deepEqual(verifyCliCasePack(resign(pack)), { caseCount: 1 });

        const mutations: Array<(value: typeof pack) => void> = [
          (value) => { value.packet.reports[0].case.notes = [{ id: 'private-note', body: 'Private report note', createdAt: NOW }]; },
          (value) => { value.packet.reports[0].analystResponse.manualTrail = [{ id: 'trail-leak', target: 'Private target', kind: 'pivot', summary: 'Reviewed', createdAt: NOW }]; },
          (value) => { value.packet.reports[0].analystResponse.actions = [{ ...original.cases[0].actions[0], recipient: 'Private complaint recipient' }]; },
        ];
        if (audience === 'public') {
          mutations.push((value) => { value.packet.reports[0].analystResponse.assertions = [{ statement: 'Private assessment' }]; });
          mutations.push((value) => { value.packet.reports[0].analystResponse.branches = [{ name: 'Private branch' }]; });
        }
        for (const mutate of mutations) {
          const leaked = structuredClone(pack);
          mutate(leaked);
          assert.throws(() => verifyCliCasePack(resign(leaked)), /excluded by its audience|unredacted action recipient/u);
        }
      }
      assert.equal(readFileSync(new URL(`./fixtures/case-lifecycle/${name}`, import.meta.url), 'utf8'), bytes);
    }
  });

});
