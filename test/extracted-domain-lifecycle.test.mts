import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { parseSerializedHandoff } from '../packages/investigation/candidate-handoff.mts';
import { parseCacaoInvestigationPlaybook } from '../packages/interchange/investigation-playbook-interchange.mts';
import { validateStaticPagePatternPack } from '../packages/interchange/static-page-pattern-packs.mts';
import {
  parseWebCaptureManifest,
  parseWebCaptureSummary,
} from '../packages/interchange/web-capture-import.mts';
import { normalizeScheduledMonitorDelivery } from '../packages/monitoring/scheduled-monitor-dispatcher.mts';
import { normalizeScheduledMonitorState } from '../packages/monitoring/scheduled-monitor-model.mts';

const EXTRACTED_FAMILY_IDS = new Set([
  'tab-portability',
  'monitoring-portability',
  'investigation-projections',
  'relationship-portability',
  'analyst-interchange',
]);
const FIXTURE_ROOT = 'test/fixtures/extracted-domain-lifecycle/';

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('extracted domain lifecycle contracts', () => {
  test('bind every newly claimed epoch to exact immutable repository bytes', async () => {
    const families = SCHEMA_LIFECYCLE_REGISTRY.filter((family) => EXTRACTED_FAMILY_IDS.has(family.id));
    assert.deepEqual(new Set(families.map((family) => family.id)), EXTRACTED_FAMILY_IDS);
    for (const family of families) {
      for (const contract of family.contracts) assert.equal(contract.fixtureIds.length, 1);
      for (const registered of family.fixtures) {
        const bytes = await readFile(registered.path);
        assert.equal(bytes.byteLength, registered.bytes, registered.id);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), registered.sha256, registered.id);
      }
      for (const descriptor of family.compatibility.filter((item) => item.futureVersionBehavior === 'not_applicable')) {
        const contracts = family.contracts.filter((contract) => contract.compatibilityId === descriptor.id);
        assert.ok(contracts.length > 0);
        assert.ok(contracts.every((contract) => contract.readable === false));
        assert.ok(contracts.every((contract) => contract.migrationTarget === null));
        assert.equal(contracts.filter((contract) => contract.emitted).length, 1);
      }
    }
  });

  test('admits every readable compatibility fixture through its canonical validator', async () => {
    assert.ok(parseSerializedHandoff(await readFile(`${FIXTURE_ROOT}candidate-handoff-v2.json`, 'utf8')));
    assert.equal(
      normalizeScheduledMonitorState(await fixture(`${FIXTURE_ROOT}scheduled-monitor-v1.json`)).version,
      1,
    );
    assert.ok(normalizeScheduledMonitorDelivery(await fixture(`${FIXTURE_ROOT}scheduled-monitor-delivery-v1.json`)));
    assert.ok(parseCacaoInvestigationPlaybook(await fixture(`${FIXTURE_ROOT}investigation-cacao-profile-v2.json`)));
    assert.ok(parseWebCaptureSummary(await fixture(`${FIXTURE_ROOT}web-capture-summary-v1.json`)));
    assert.ok(parseWebCaptureManifest(await fixture(`${FIXTURE_ROOT}web-capture-manifest-v2.json`)));
    assert.ok(validateStaticPagePatternPack(await fixture(`${FIXTURE_ROOT}static-page-pattern-pack-v2.json`)));
  });

  test('rejects unsupported future input before returning a partial normalisation', async () => {
    const candidate = await fixture(`${FIXTURE_ROOT}candidate-handoff-v2.json`) as Record<string, unknown>;
    assert.equal(parseSerializedHandoff(JSON.stringify({ ...candidate, version: 3 })), null);

    const monitor = await fixture(`${FIXTURE_ROOT}scheduled-monitor-v1.json`) as Record<string, unknown>;
    assert.throws(() => normalizeScheduledMonitorState({ ...monitor, version: 2 }), /unsupported schema version/u);

    const cacao = structuredClone(await fixture(`${FIXTURE_ROOT}investigation-cacao-profile-v2.json`)) as Record<string, unknown>;
    const extensions = cacao.playbook_extensions as Record<string, Record<string, unknown>>;
    const profile = Object.values(extensions)[0];
    assert.ok(profile);
    profile.profile_version = 3;
    assert.throws(() => parseCacaoInvestigationPlaybook(cacao), /profile metadata is missing or invalid/u);

    const summary = await fixture(`${FIXTURE_ROOT}web-capture-summary-v1.json`) as Record<string, unknown>;
    assert.throws(() => parseWebCaptureSummary({ ...summary, schemaVersion: 2 }), /schema version 1/u);
    const manifest = await fixture(`${FIXTURE_ROOT}web-capture-manifest-v2.json`) as Record<string, unknown>;
    assert.throws(() => parseWebCaptureManifest({ ...manifest, schemaVersion: 1 }), /schema version 2/u);
    assert.throws(() => parseWebCaptureManifest({ ...manifest, schemaVersion: 3 }), /schema version 2/u);
    const pattern = await fixture(`${FIXTURE_ROOT}static-page-pattern-pack-v2.json`) as Record<string, unknown>;
    assert.throws(() => validateStaticPagePatternPack({ ...pattern, version: 3 }), /requires schema 2/u);
  });

  test('keeps internal lifecycle identities out of formats without a public schema member', async () => {
    const families = SCHEMA_LIFECYCLE_REGISTRY.filter((family) => EXTRACTED_FAMILY_IDS.has(family.id));
    for (const family of families) {
      const schemaLessIds = new Set(family.compatibility.filter((entry) => entry.schema === null).map((entry) => entry.id));
      for (const contract of family.contracts.filter((entry) => schemaLessIds.has(entry.compatibilityId))) {
        for (const fixtureId of contract.fixtureIds) {
          const registered = family.fixtures.find((entry) => entry.id === fixtureId);
          assert.ok(registered);
          const root = await fixture(registered.path) as Record<string, unknown>;
          assert.equal(Object.hasOwn(root, 'schema'), false, fixtureId);
        }
      }
    }
  });
});
