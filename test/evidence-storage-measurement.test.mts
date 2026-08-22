import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  EVIDENCE_STORAGE_MEASUREMENT_FIXTURE_PATH,
  EVIDENCE_STORAGE_STARTING_REVISION,
  buildEvidenceStorageMeasurementProfile,
  buildSyntheticEvidenceStorageCases,
  checkEvidenceStorageMeasurementProfile,
  loadEvidenceStorageMeasurementFixture,
  validateEvidenceStorageMeasurementFixture,
} from '../tools/evidence-storage-measurement.mts';

describe('evidence-storage architecture measurement', () => {
  test('is deterministic and bound to the reviewed revision and fixture identities', async () => {
    const fixture = loadEvidenceStorageMeasurementFixture();
    const first = await buildEvidenceStorageMeasurementProfile(fixture);
    const second = await buildEvidenceStorageMeasurementProfile(fixture);

    assert.deepEqual(first, second);
    assert.equal(first.startingRevision, EVIDENCE_STORAGE_STARTING_REVISION);
    assert.equal(first.fixtureIdentity.corpus, EVIDENCE_STORAGE_MEASUREMENT_FIXTURE_PATH);
    assert.match(first.fixtureIdentity.corpusSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(first.fixtureIdentity.startingCurrentFixtures.length, 9);
    assert.equal(first.fixtureIdentity.startingCurrentFixtures.every((item) => item.bytes > 0), true);
    assert.equal(first.fixtureIdentity.startingCurrentFixtures.every((item) => /^sha256:[a-f0-9]{64}$/u.test(item.sha256)), true);
    await checkEvidenceStorageMeasurementProfile();
  });

  test('keeps the no-build decision on representative evidence while exposing the synthetic boundary', async () => {
    const profile = await buildEvidenceStorageMeasurementProfile();
    const low = profile.scenarios.find((scenario) => scenario.classification === 'representative_low');
    const representative = profile.scenarios.find((scenario) => scenario.classification === 'representative_mixed');
    const boundary = profile.scenarios.find((scenario) => scenario.classification === 'synthetic_worst_case');
    assert.ok(low);
    assert.ok(representative);
    assert.ok(boundary);

    assert.equal(profile.decision.outcome, 'no_build');
    assert.equal(profile.decision.representativeScenario, representative.id);
    assert.equal(low.duplication.exactDuplicateGroupCount, 0);
    assert.equal(low.duplication.deduplicableBytesAfterAllOverhead, 0);
    assert.equal(representative.duplication.canonicalOnlyGroupCount, 0);
    assert.equal(representative.duplication.deduplicableBytesAfterAllOverhead, 0);
    assert.ok(representative.duplication.architectureDeltaBytes > 0);
    assert.ok(boundary.duplication.deduplicableBytesAfterAllOverhead > 0);
    assert.ok(boundary.browserLocal.currentQuotaRatio < profile.decision.threshold.minimumQuotaPressureRatio);
    assert.match(profile.decision.reconsiderWhen.evidence, /representative corpus.*both savings thresholds/iu);
  });

  test('measures storage families and preserves provenance, state, time, and privacy limits', async () => {
    const fixture = loadEvidenceStorageMeasurementFixture();
    const representativeFixture = fixture.scenarios.find((scenario) => scenario.classification === 'representative_mixed');
    assert.ok(representativeFixture);
    const cases = buildSyntheticEvidenceStorageCases(fixture, representativeFixture);
    const snapshot = cases[0]?.evidenceHistory[0];
    const pin = cases[0]?.evidencePins[0];
    assert.ok(snapshot);
    assert.ok(pin);
    assert.equal(snapshot.source, 'bulk');
    assert.equal(snapshot.scanDepth, 'deep');
    assert.equal(snapshot.inputHostname, null);
    assert.equal(pin.sourceState, 'complete');
    assert.equal(pin.completeness, 'complete');
    assert.match(pin.limitations.join(' '), /does not establish ownership or safety/iu);

    const profile = await buildEvidenceStorageMeasurementProfile(fixture);
    for (const scenario of profile.scenarios) {
      assert.ok(scenario.browserLocal.retainedEvidenceBytes > 0);
      assert.ok(scenario.browserLocal.evidenceHistoryBytes > 0);
      assert.ok(scenario.browserLocal.evidencePinBytes > 0);
      assert.ok(scenario.browserLocal.decisionHistoryBytes > 0);
      assert.ok(scenario.browserLocal.responseActionHistoryBytes > 0);
      assert.ok(scenario.portable.workspaceArchive.retainedEvidenceBytes > 0);
      assert.ok(scenario.portable.cliCasePack.retainedEvidenceBytes > 0);
    }
    assert.deepEqual(profile.boundaries, {
      networkRequests: 0,
      browserRecordsRead: 0,
      userDataRead: false,
      productionStorageChanged: false,
      liveTargets: false,
      eligibleFields: ['evidenceHistory', 'evidencePins', 'decisions', 'actions'],
      browserDatabase: 'whoisleuth-browser-data-v1',
      browserDatabaseVersion: 1,
      browserObjectStores: ['records', 'manifests'],
      browserCodec: 'json-v1',
      browserCollectionCount: 12,
    });
  });

  test('rejects accessor-bearing, sparse, deep, oversized, and future fixtures without invoking accessors', () => {
    const fixture = loadEvidenceStorageMeasurementFixture();
    let getterCalls = 0;
    const accessor = structuredClone(fixture) as Record<string, unknown>;
    Object.defineProperty(accessor, 'startingRevision', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return EVIDENCE_STORAGE_STARTING_REVISION;
      },
    });
    assert.throws(() => validateEvidenceStorageMeasurementFixture(accessor), /accessor property/iu);
    assert.equal(getterCalls, 0);

    const sparse = structuredClone(fixture) as unknown as { scenarios: unknown[] };
    sparse.scenarios = new Array(3);
    assert.throws(() => validateEvidenceStorageMeasurementFixture(sparse), /sparse, extended, or non-enumerable array/iu);

    const deep = structuredClone(fixture) as Record<string, unknown>;
    let nested: unknown = 'leaf';
    for (let index = 0; index < 9; index += 1) nested = { nested };
    deep.unexpected = nested;
    assert.throws(() => validateEvidenceStorageMeasurementFixture(deep), /nesting limit/iu);

    const oversized = structuredClone(fixture) as unknown as { scenarios: Array<Record<string, unknown>> };
    oversized.scenarios[0]!.caseCount = 501;
    assert.throws(() => validateEvidenceStorageMeasurementFixture(oversized), /between 1 and 500/iu);

    const future = structuredClone(fixture) as { version: number };
    future.version = 2;
    assert.throws(() => validateEvidenceStorageMeasurementFixture(future), /unsupported contract/iu);
  });
});
