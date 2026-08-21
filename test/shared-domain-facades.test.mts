import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const FACADES = Object.freeze([
  ['../frontend/src/lib/analysis/scheduled-monitor-model.ts', '../packages/monitoring/scheduled-monitor-model.mts'],
  ['../frontend/src/lib/analysis/scheduled-monitor-dispatcher.ts', '../packages/monitoring/scheduled-monitor-dispatcher.mts'],
  ['../frontend/src/lib/analysis/observation-envelope.ts', '../packages/investigation/observation-envelope.mts'],
  ['../frontend/src/lib/analysis/investigation-projection.ts', '../packages/investigation/investigation-projection.mts'],
  ['../frontend/src/lib/analysis/investigation-projection-reader.ts', '../packages/investigation/investigation-projection-reader.mts'],
  ['../frontend/src/lib/analysis/investigation-projection-collections.ts', '../packages/investigation/investigation-projection-collections.mts'],
  ['../frontend/src/lib/analysis/investigation-search.ts', '../packages/investigation/investigation-search.mts'],
  ['../frontend/src/lib/analysis/investigation-lineage.ts', '../packages/investigation/investigation-lineage.mts'],
  ['../frontend/src/lib/analysis/case-decision-quality.ts', '../packages/investigation/case-decision-quality.mts'],
  ['../frontend/src/lib/analysis/campaign-temporal-review.ts', '../packages/investigation/campaign-temporal-review.mts'],
  ['../frontend/src/lib/analysis/ct-results.ts', '../packages/investigation/ct-results.mts'],
  ['../frontend/src/lib/analysis/service-dependency-review.ts', '../packages/investigation/service-dependency-review.mts'],
  ['../frontend/src/lib/analysis/risk-calibration-dashboard.ts', '../packages/investigation/risk-calibration-dashboard.mts'],
  ['../frontend/src/lib/analysis/risk-calibration-export.ts', '../packages/investigation/risk-calibration-export.mts'],
  ['../frontend/src/lib/analysis/case-relationships.ts', '../packages/relationships/case-relationships.mts'],
  ['../frontend/src/lib/analysis/case-relationship-graph.ts', '../packages/relationships/case-relationship-graph.mts'],
  ['../frontend/src/lib/analysis/case-relationship-graph-export.ts', '../packages/relationships/case-relationship-graph-export.mts'],
  ['../frontend/src/lib/analysis/case-relationship-clusters.ts', '../packages/relationships/case-relationship-clusters.mts'],
  ['../frontend/src/lib/analysis/common-infrastructure.ts', '../packages/relationships/common-infrastructure.mts'],
  ['../frontend/src/lib/analysis/defensive-indicator-export.ts', '../packages/interchange/defensive-indicator-export.mts'],
  ['../frontend/src/lib/analysis/stix-indicator-export.ts', '../packages/interchange/stix-indicator-export.mts'],
  ['../frontend/src/lib/analysis/case-sighting-stix-export.ts', '../packages/interchange/case-sighting-stix-export.mts'],
  ['../frontend/src/lib/analysis/misp-indicator-export.ts', '../packages/interchange/misp-indicator-export.mts'],
  ['../frontend/src/lib/analysis/investigation-playbook-interchange.ts', '../packages/interchange/investigation-playbook-interchange.mts'],
  ['../frontend/src/lib/analysis/brand-protection-operations-report.ts', '../packages/interchange/brand-protection-operations-report.mts'],
  ['../frontend/src/lib/analysis/dns-change-rehearsal.ts', '../packages/interchange/dns-change-rehearsal.mts'],
  ['../frontend/src/lib/analysis/mail-report-workbench.ts', '../packages/interchange/mail-report-workbench.mts'],
  ['../frontend/src/lib/analysis/registration-disclosure-plan.ts', '../packages/interchange/registration-disclosure-plan.mts'],
  ['../frontend/src/lib/analysis/static-page-pattern-packs.ts', '../packages/interchange/static-page-pattern-packs.mts'],
  ['../frontend/src/lib/analysis/web-capture-import.ts', '../packages/interchange/web-capture-import.mts'],
  ['../frontend/src/lib/analysis/domain-control-passport.ts', '../packages/workspace/domain-control-passport.mts'],
  ['../frontend/src/lib/candidate-handoff-core.ts', '../packages/investigation/candidate-handoff.mts'],
  ['../lib/bounded-local-search.mts', '../packages/investigation/bounded-local-search.mts'],
  ['../lib/bounded-relationship-graph.mts', '../packages/relationships/bounded-relationship-graph.mts'],
  ['../lib/web-capture-contract.mts', '../packages/contracts/web-capture.mts'],
] as const);

describe('shared domain compatibility facades', () => {
  test('re-export the exact canonical module identities', async () => {
    for (const [facadePath, ownerPath] of FACADES) {
      const [facade, owner] = await Promise.all([import(facadePath), import(ownerPath)]);
      assert.deepEqual(Object.keys(facade).sort(), Object.keys(owner).sort(), facadePath);
      for (const key of Object.keys(owner)) {
        assert.strictEqual(facade[key], owner[key], `${facadePath}#${key}`);
      }
    }
  });

  test('keeps browser adapters on the shared contract identities', async () => {
    const [demo, tabContracts, localDefinitions, localManifest] = await Promise.all([
      import('../frontend/src/lib/analysis/demo-model.ts'),
      import('../packages/contracts/tab-portability.mts'),
      import('../frontend/src/lib/browser-local-data-definitions.ts'),
      import('../packages/contracts/browser-local-collection-manifest.mts'),
    ]);
    assert.strictEqual(demo.SYNTHETIC_DEMO_VERSION, tabContracts.SYNTHETIC_DEMO_VERSION);
    assert.strictEqual(demo.SYNTHETIC_DEMO_EXPORT_SCHEMA, tabContracts.SYNTHETIC_DEMO_EXPORT_SCHEMA);
    assert.deepEqual(
      localDefinitions.BROWSER_LOCAL_COLLECTIONS.map(({ id, label, schemaVersion, maximumBytes, maximumRecords }) => (
        { id, label, schemaVersion, maximumBytes, maximumRecords }
      )),
      localManifest.BROWSER_LOCAL_COLLECTION_MANIFEST,
    );
  });
});
