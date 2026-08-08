import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  buildSchemaCompatibilityInventory,
  formatSchemaCompatibilityInventory,
  MAX_SCHEMA_COMPATIBILITY_ENTRIES,
  SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA,
  SCHEMA_COMPATIBILITY_INVENTORY_VERSION,
  validateSchemaCompatibilityEntries,
  type SchemaCompatibilityEntry,
  type SchemaCompatibilityInventory,
} from '../tools/schema-compatibility.mts';
import {
  buildBrandProfileExport,
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  brandProfileStoreVersion,
  SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS,
} from '../frontend/src/lib/analysis/brand-profile-model.ts';
import {
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
  MAX_BULK_REVIEW_STORE_BYTES,
} from '../frontend/src/lib/analysis/bulk-review-model.ts';
import {
  buildCampaignExport,
  CAMPAIGN_SCHEMA,
  CAMPAIGN_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/campaign-model.ts';
import {
  buildCampaignTemporalExport,
  buildCampaignTemporalReview,
  CAMPAIGN_TEMPORAL_REVIEW_SCHEMA,
  CAMPAIGN_TEMPORAL_REVIEW_VERSION,
} from '../frontend/src/lib/analysis/campaign-temporal-review.ts';
import {
  buildCaseReport,
  CASE_REPORT_SCHEMA,
  CASE_REPORT_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/case-report.ts';
import {
  MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES,
  RELATIONSHIP_GRAPH_EXPORT_SCHEMA,
  RELATIONSHIP_GRAPH_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/case-relationship-graph-export.ts';
import {
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  buildRelationshipObservationExport,
} from '../frontend/src/lib/analysis/relationship-observation-model.ts';
import {
  MAX_WEBSITE_SNAPSHOT_STORE_BYTES,
  WEBSITE_SNAPSHOT_SCHEMA,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
  SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS,
} from '../frontend/src/lib/analysis/website-snapshot-model.ts';
import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_SETTINGS_SCHEMA,
  WORKSPACE_SETTINGS_VERSION,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import {
  ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import {
  buildCaseExport,
  CASE_IMPORT_VERSIONS,
  CASE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/case-model.ts';
import {
  buildDetectionRuleExport,
  DETECTION_RULE_SCHEMA,
  DETECTION_RULE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/detection-rule-model.ts';
import {
  buildShortlistExport,
  SHORTLIST_SCHEMA,
  SHORTLIST_SCHEMA_VERSION,
  shortlistStoreVersion,
} from '../frontend/src/lib/analysis/shortlist-model.ts';
import {
  buildWatchlistExport,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
  watchlistStoreVersion,
} from '../frontend/src/lib/analysis/watchlist-store.ts';
import {
  buildCliBulkDocument,
  buildCliCompareDocument,
  buildCliCtSearchDocument,
  buildCliDiscoverDocument,
  buildCliHttpDocument,
  buildCliLookupDocument,
  buildCliPostureDocument,
  buildCliTlsDocument,
} from '../cli/formatters/json.mts';
import { DOCTOR_SCHEMA, DOCTOR_VERSION } from '../cli/doctor.mts';
import { CLI_COMMAND_CATALOGUE_SCHEMA, CLI_COMMAND_CATALOGUE_VERSION } from '../cli/command-catalogue.mts';
import { CLI_LOOKUP_PLAN_SCHEMA, CLI_LOOKUP_PLAN_VERSION } from '../cli/lookup-plan.mts';
import { CLI_LOOKUP_TIMELINE_SCHEMA, CLI_LOOKUP_TIMELINE_VERSION } from '../cli/lookup-timeline.mts';
import { CLI_MAIL_REVIEW_SCHEMA, CLI_MAIL_REVIEW_VERSION } from '../cli/mail-review.mts';
import { CLI_PAGE_COMPARE_SCHEMA, CLI_PAGE_COMPARE_VERSION } from '../cli/page-compare.mts';
import {
  CLI_DISCOVERY_SCAN_ITEM_SCHEMA,
  CLI_DISCOVERY_SCAN_SCHEMA,
  CLI_DISCOVERY_SCAN_VERSION,
} from '../cli/discovery-scan.mts';
import {
  CLI_DISCOVERY_SNAPSHOT_SCHEMA,
  MAX_DISCOVERY_SNAPSHOT_BYTES,
} from '../cli/discovery-snapshot.mts';
import {
  CLI_DISCOVERY_OBSERVATION_SCHEMA,
  CLI_DISCOVERY_OBSERVATION_VERSION,
  MAX_DISCOVERY_OBSERVATION_BYTES,
} from '../cli/discovery-observation-snapshot.mts';
import {
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  buildLookupEvidence,
} from '../lib/evidence-export.mts';
import {
  DEPLOYMENT_SELF_CHECK_SCHEMA,
  DEPLOYMENT_SELF_CHECK_VERSION,
} from '../tools/deployment-self-check.mts';
import {
  REGISTRY_DRIFT_AUDIT_SCHEMA,
  REGISTRY_DRIFT_AUDIT_VERSION,
} from '../tools/registry-drift-audit.mts';
import {
  RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA,
  RDAP_EXTENSION_DRIFT_AUDIT_VERSION,
} from '../tools/rdap-extension-drift-audit.mts';
import {
  SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA,
  SPECIALIST_WORKFLOW_BENCHMARK_VERSION,
} from '../tools/specialist-workflow-benchmark.mts';
import {
  SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA,
  SERVICE_DEPENDENCY_SIGNATURE_AUDIT_VERSION,
} from '../tools/service-dependency-signature-audit.mts';
import {
  CURATED_CONNECTOR_CONTRACT_VERSION,
  CURATED_CONNECTOR_RESULT_SCHEMA,
} from '../lib/threat-intelligence-contract.mts';
import {
  INVESTIGATION_GUIDE_EXPORT_SCHEMA,
  INVESTIGATION_GUIDE_EXPORT_VERSION,
  INVESTIGATION_GUIDE_VERSION,
  MAX_INVESTIGATION_GUIDE_EXPORT_BYTES,
  MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES,
} from '../frontend/src/lib/analysis/investigation-guide.ts';
import {
  INVESTIGATION_TEMPLATE_SCHEMA,
  INVESTIGATION_TEMPLATE_VERSION,
  MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES,
  MAX_INVESTIGATION_TEMPLATE_STORE_BYTES,
} from '../frontend/src/lib/analysis/investigation-template-model.ts';
import {
  INVESTIGATION_CACAO_PROFILE_VERSION,
  INVESTIGATION_CACAO_SPEC_VERSION,
  MAX_INVESTIGATION_CACAO_IMPORT_BYTES,
} from '../frontend/src/lib/analysis/investigation-playbook-interchange.ts';
import {
  MAX_ENVELOPE_BYTES as MAX_OBSERVATION_ENVELOPE_BYTES,
  OBSERVATION_ENVELOPE_SCHEMA,
  OBSERVATION_ENVELOPE_VERSION,
} from '../frontend/src/lib/analysis/observation-envelope.ts';
import {
  WEB_CAPTURE_SUMMARY_SCHEMA,
  WEB_CAPTURE_SUMMARY_VERSION,
} from '../frontend/src/lib/analysis/web-capture-import.ts';
import {
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  WEB_CAPTURE_DOM_DIGEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
} from '../packages/web-capture/capture.mts';
import {
  MAX_MANIFEST_BYTES,
  WEB_CAPTURE_COMPARISON_SCHEMA,
  WEB_CAPTURE_COMPARISON_VERSION,
} from '../packages/web-capture/compare.mts';

const NOW = '2026-07-19T00:00:00.000Z';

function recordValue(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function byId(inventory: SchemaCompatibilityInventory, id: string): SchemaCompatibilityEntry {
  const value = inventory.entries.find((entry) => entry.id === id);
  assert.ok(value, `Missing schema compatibility entry ${id}`);
  return value;
}

describe('schema compatibility inventory', () => {
  test('enumerates the reviewed persisted, exported, CLI, and derived contracts', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.equal(inventory.schema, SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA);
    assert.equal(inventory.version, SCHEMA_COMPATIBILITY_INVENTORY_VERSION);
    assert.equal(inventory.generatedAt, NOW);
    assert.equal(inventory.entries.length, 140);
    assert.deepEqual(new Set(inventory.entries.map((entry) => entry.kind)), new Set([
      'browser_store', 'tab_store', 'hosted_store', 'export', 'cli_document', 'derived',
    ]));
    assert.ok(inventory.entries.length <= MAX_SCHEMA_COMPATIBILITY_ENTRIES);
    assert.equal(byId(inventory, 'browser.cases').currentVersion, CASE_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'export.lookup-evidence').schema, LOOKUP_EVIDENCE_SCHEMA);
    assert.equal(byId(inventory, 'export.lookup-evidence').currentVersion, LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'cli.bulk-checkpoint').schema, 'whoisleuth.cli.bulk-checkpoint');
    assert.equal(byId(inventory, 'cli.progress-event').schema, 'whoisleuth.cli.progress');
    assert.equal(byId(inventory, 'cli.lookup-diff').schema, 'whoisleuth.cli.lookup-diff');
    for (const [id, schema, version] of [
      ['cli.doctor', DOCTOR_SCHEMA, DOCTOR_VERSION],
      ['cli.command-catalogue', CLI_COMMAND_CATALOGUE_SCHEMA, CLI_COMMAND_CATALOGUE_VERSION],
      ['cli.lookup-plan', CLI_LOOKUP_PLAN_SCHEMA, CLI_LOOKUP_PLAN_VERSION],
      ['cli.lookup-timeline', CLI_LOOKUP_TIMELINE_SCHEMA, CLI_LOOKUP_TIMELINE_VERSION],
      ['cli.mail-review', CLI_MAIL_REVIEW_SCHEMA, CLI_MAIL_REVIEW_VERSION],
      ['cli.page-compare', CLI_PAGE_COMPARE_SCHEMA, CLI_PAGE_COMPARE_VERSION],
    ] as const) {
      assert.equal(byId(inventory, id).schema, schema);
      assert.equal(byId(inventory, id).currentVersion, version);
    }
    assert.equal(byId(inventory, 'cli.lookup-reconciliation').schema, 'whoisleuth.cli.lookup-reconciliation');
    assert.equal(byId(inventory, 'cli.registry-doctor').schema, 'whoisleuth.cli.registry-doctor');
    assert.equal(byId(inventory, 'cli.sharing-review').schema, 'whoisleuth.cli.sharing-review');
    assert.equal(byId(inventory, 'cli.lookalike-calibration-input').schema, 'whoisleuth.lookalike-calibration-input');
    assert.equal(byId(inventory, 'cli.lookalike-calibration').schema, 'whoisleuth.lookalike-calibration');
    assert.equal(byId(inventory, 'cli.domain-assurance-input').schema, 'whoisleuth.domain-assurance.input');
    assert.equal(byId(inventory, 'cli.domain-assurance').schema, 'whoisleuth.domain-assurance');
    assert.equal(byId(inventory, 'cli.zone-intent-input').schema, 'whoisleuth.zone-intent.input');
    assert.equal(byId(inventory, 'cli.domain-portfolio-review').schema, 'whoisleuth.domain-portfolio.review');
    assert.equal(byId(inventory, 'cli.domain-change-review').schema, 'whoisleuth.domain-change.review');
    assert.equal(byId(inventory, 'cli.domain-change-packet').schema, 'whoisleuth.domain-change-packet');
    assert.equal(byId(inventory, 'cli.dns-convergence-review').schema, 'whoisleuth.dns-convergence.review');
    assert.equal(byId(inventory, 'cli.trust-store-comparison-review').schema, 'whoisleuth.trust-store-comparison.review');
    assert.equal(byId(inventory, 'cli.nameserver-preflight-review').schema, 'whoisleuth.nameserver-preflight.review');
    assert.equal(byId(inventory, 'cli.investigation-run').schema, 'whoisleuth.cli.investigation-run');
    assert.equal(byId(inventory, 'cli.collection-preflight').schema, 'whoisleuth.cli.collection-preflight');
    assert.equal(byId(inventory, 'cli.config').schema, 'whoisleuth.cli.config');
    assert.equal(byId(inventory, 'export.cli-case-pack').schema, 'whoisleuth.cli.case-pack');
    assert.equal(byId(inventory, 'cli.interchange-fidelity-report').schema, 'whoisleuth.interchange-fidelity-report');
    assert.equal(byId(inventory, 'cli.domain-control-review-input').schema, 'whoisleuth.cli.domain-control-review-input');
    assert.equal(byId(inventory, 'cli.domain-control-observation-review').schema, 'whoisleuth.cli.domain-control-review');
    assert.equal(byId(inventory, 'cli.domain-control-monitor').schema, 'whoisleuth.cli.domain-control-monitor');
    assert.deepEqual(byId(inventory, 'cli.lookup-brief').supportedVersions, [1, 2]);
    assert.equal(byId(inventory, 'cli.registry-cohort').schema, 'whoisleuth.cli.registry-cohort');
    assert.equal(byId(inventory, 'cli.domain-control-flight-recorder-input').schema, 'whoisleuth.domain-control-flight-recorder.input');
    assert.equal(byId(inventory, 'cli.domain-control-flight-recorder').schema, 'whoisleuth.domain-control-flight-recorder');
    assert.deepEqual(byId(inventory, 'tab.candidate-handoff').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'cli.bulk').supportedVersions, [1, 2, 3]);
    assert.deepEqual(byId(inventory, 'cli.bulk-item').supportedVersions, [1, 2, 3]);
    assert.deepEqual(byId(inventory, 'cli.bulk-checkpoint').supportedVersions, [1, 2]);
    assert.deepEqual(byId(inventory, 'cli.http').supportedVersions, [1, 2]);
    assert.equal(byId(inventory, 'cli.discovery-scan').schema, CLI_DISCOVERY_SCAN_SCHEMA);
    assert.equal(byId(inventory, 'cli.discovery-scan-item').schema, CLI_DISCOVERY_SCAN_ITEM_SCHEMA);
    assert.equal(byId(inventory, 'cli.discovery-scan').currentVersion, CLI_DISCOVERY_SCAN_VERSION);
    assert.equal(byId(inventory, 'cli.discovery-snapshot').schema, CLI_DISCOVERY_SNAPSHOT_SCHEMA);
    assert.equal(byId(inventory, 'cli.discovery-snapshot').byteBudget, MAX_DISCOVERY_SNAPSHOT_BYTES);
    assert.equal(byId(inventory, 'cli.discovery-observation-snapshot').schema, CLI_DISCOVERY_OBSERVATION_SCHEMA);
    assert.equal(byId(inventory, 'cli.discovery-observation-snapshot').currentVersion, CLI_DISCOVERY_OBSERVATION_VERSION);
    assert.deepEqual(byId(inventory, 'cli.discovery-observation-snapshot').supportedVersions, [1, 2]);
    assert.equal(byId(inventory, 'cli.discovery-observation-snapshot').byteBudget, MAX_DISCOVERY_OBSERVATION_BYTES);
    assert.equal(byId(inventory, 'cli.ct-event-batch').schema, 'whoisleuth.ct-event-batch');
    assert.equal(byId(inventory, 'cli.investigation-manifest').schema, 'whoisleuth.investigation-manifest');
    assert.equal(byId(inventory, 'cli.external-observation-mapping').schema, 'whoisleuth.external-observation-mapping');
    assert.equal(byId(inventory, 'cli.open-asset-model-bridge').schema, 'whoisleuth.open-asset-model-bridge');
    assert.equal(byId(inventory, 'cli.source-reliability-report').schema, 'whoisleuth.source-reliability-report');
    assert.equal(byId(inventory, 'cli.offline-evidence-review').schema, 'whoisleuth.cli.offline-evidence-review');
    assert.equal(byId(inventory, 'export.web-capture-summary').schema, WEB_CAPTURE_SUMMARY_SCHEMA);
    assert.equal(byId(inventory, 'export.web-capture-summary').currentVersion, WEB_CAPTURE_SUMMARY_VERSION);
    assert.equal(byId(inventory, 'export.web-capture-manifest').schema, WEB_CAPTURE_MANIFEST_SCHEMA);
    assert.equal(byId(inventory, 'export.web-capture-manifest').currentVersion, WEB_CAPTURE_MANIFEST_VERSION);
    assert.deepEqual(byId(inventory, 'export.web-capture-manifest').supportedVersions, [1, 2]);
    assert.equal(byId(inventory, 'export.web-capture-manifest').byteBudget, MAX_MANIFEST_BYTES);
    assert.equal(byId(inventory, 'export.web-capture-dom-digest').schema, WEB_CAPTURE_DOM_DIGEST_SCHEMA);
    assert.equal(byId(inventory, 'export.web-capture-dom-digest').byteBudget, MAX_WEB_CAPTURE_DOM_DIGEST_BYTES);
    assert.equal(byId(inventory, 'cli.web-capture-comparison').schema, WEB_CAPTURE_COMPARISON_SCHEMA);
    assert.equal(byId(inventory, 'cli.web-capture-comparison').currentVersion, WEB_CAPTURE_COMPARISON_VERSION);
    assert.deepEqual(byId(inventory, 'export.lookup-evidence').supportedVersions, [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    assert.deepEqual(byId(inventory, 'export.synthetic-demo').supportedVersions, [2, 3, 4, 5]);
    assert.deepEqual(byId(inventory, 'export.external-findings').supportedVersions, [1, 2, 3, 4]);
    assert.equal(byId(inventory, 'import.external-finding-rows').schema, 'whoisleuth.external-finding-rows');
    assert.equal(byId(inventory, 'import.domain-observation-rows').schema, 'whoisleuth.domain-observation-rows');
    assert.equal(byId(inventory, 'import.dns-observation-rows').schema, 'whoisleuth.dns-observation-rows');
    assert.equal(byId(inventory, 'import.certificate-observation-rows').schema, 'whoisleuth.certificate-observation-rows');
    assert.equal(byId(inventory, 'export.relationship-graph').schema, RELATIONSHIP_GRAPH_EXPORT_SCHEMA);
    assert.equal(byId(inventory, 'export.relationship-graph').currentVersion, RELATIONSHIP_GRAPH_EXPORT_VERSION);
    assert.deepEqual(byId(inventory, 'export.relationship-graph').supportedVersions, [1, 2, 3]);
    assert.equal(byId(inventory, 'export.relationship-graph').byteBudget, MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES);
    assert.equal(byId(inventory, 'browser.relationship-observations').schema, RELATIONSHIP_OBSERVATION_SCHEMA);
    assert.equal(byId(inventory, 'browser.relationship-observations').currentVersion, RELATIONSHIP_OBSERVATION_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'browser.website-snapshots').schema, WEBSITE_SNAPSHOT_SCHEMA);
    assert.equal(byId(inventory, 'browser.website-snapshots').currentVersion, WEBSITE_SNAPSHOT_SCHEMA_VERSION);
    assert.deepEqual(byId(inventory, 'browser.website-snapshots').supportedVersions, [1, 2, 3, 4]);
    assert.equal(byId(inventory, 'browser.website-snapshots').byteBudget, MAX_WEBSITE_SNAPSHOT_STORE_BYTES);
    assert.deepEqual(byId(inventory, 'browser.bulk-sessions').supportedVersions, [1, 2, 3]);
    assert.equal(byId(inventory, 'browser.bulk-sessions').migration, 'normalize_to_current');
    assert.deepEqual(byId(inventory, 'export.bulk-sessions').supportedVersions, [1, 2, 3]);
    assert.equal(byId(inventory, 'export.bulk-sessions').migration, 'normalize_to_current');
    assert.equal(byId(inventory, 'browser.investigation-templates').schema, INVESTIGATION_TEMPLATE_SCHEMA);
    assert.equal(byId(inventory, 'browser.investigation-templates').currentVersion, INVESTIGATION_TEMPLATE_VERSION);
    assert.equal(byId(inventory, 'browser.investigation-templates').byteBudget, MAX_INVESTIGATION_TEMPLATE_STORE_BYTES);
    assert.equal(byId(inventory, 'browser.bulk-review').schema, BULK_REVIEW_SCHEMA);
    assert.equal(byId(inventory, 'browser.bulk-review').currentVersion, BULK_REVIEW_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'browser.bulk-review').byteBudget, MAX_BULK_REVIEW_STORE_BYTES);
    assert.equal(byId(inventory, 'export.workspace-archive').schema, WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(byId(inventory, 'export.workspace-archive').currentVersion, WORKSPACE_ARCHIVE_VERSION);
    assert.deepEqual(byId(inventory, 'export.workspace-archive').supportedVersions, [1, 2, 3, 4, 5]);
    assert.equal(byId(inventory, 'export.workspace-archive').byteBudget, MAX_WORKSPACE_ARCHIVE_BYTES);
    assert.deepEqual(byId(inventory, 'export.case-response-packet').supportedVersions, [1, 2, 3, 4, 5]);
    assert.equal(byId(inventory, 'export.encrypted-workspace-archive').schema, ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(byId(inventory, 'export.encrypted-workspace-archive').currentVersion, ENCRYPTED_WORKSPACE_ARCHIVE_VERSION);
    assert.equal(byId(inventory, 'export.encrypted-workspace-archive').byteBudget, MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES);
    assert.equal(byId(inventory, 'export.workspace-settings-section').schema, WORKSPACE_SETTINGS_SCHEMA);
    assert.equal(byId(inventory, 'export.workspace-settings-section').currentVersion, WORKSPACE_SETTINGS_VERSION);
    assert.equal(byId(inventory, 'cli.deployment-self-check').schema, DEPLOYMENT_SELF_CHECK_SCHEMA);
    assert.equal(byId(inventory, 'cli.deployment-self-check').currentVersion, DEPLOYMENT_SELF_CHECK_VERSION);
    assert.equal(byId(inventory, 'cli.registry-drift-audit').schema, REGISTRY_DRIFT_AUDIT_SCHEMA);
    assert.equal(byId(inventory, 'cli.registry-drift-audit').currentVersion, REGISTRY_DRIFT_AUDIT_VERSION);
    assert.equal(byId(inventory, 'cli.rdap-extension-drift-audit').schema, RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA);
    assert.equal(byId(inventory, 'cli.rdap-extension-drift-audit').currentVersion, RDAP_EXTENSION_DRIFT_AUDIT_VERSION);
    assert.equal(byId(inventory, 'cli.specialist-workflow-benchmark').schema, SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA);
    assert.equal(byId(inventory, 'cli.specialist-workflow-benchmark').currentVersion, SPECIALIST_WORKFLOW_BENCHMARK_VERSION);
    assert.equal(byId(inventory, 'cli.service-dependency-signature-audit').schema, SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA);
    assert.equal(byId(inventory, 'cli.service-dependency-signature-audit').currentVersion, SERVICE_DEPENDENCY_SIGNATURE_AUDIT_VERSION);
    assert.equal(byId(inventory, 'derived.curated-connector-result').schema, CURATED_CONNECTOR_RESULT_SCHEMA);
    assert.equal(byId(inventory, 'derived.curated-connector-result').currentVersion, CURATED_CONNECTOR_CONTRACT_VERSION);
    assert.equal(byId(inventory, 'derived.observation-envelope').schema, OBSERVATION_ENVELOPE_SCHEMA);
    assert.equal(byId(inventory, 'derived.observation-envelope').currentVersion, OBSERVATION_ENVELOPE_VERSION);
    assert.equal(byId(inventory, 'derived.observation-envelope').byteBudget, MAX_OBSERVATION_ENVELOPE_BYTES);
    assert.equal(byId(inventory, 'tab.investigation-guide').currentVersion, INVESTIGATION_GUIDE_VERSION);
    assert.deepEqual(byId(inventory, 'tab.investigation-guide').supportedVersions, [1, 2, 3, 4]);
    assert.equal(byId(inventory, 'tab.investigation-guide').byteBudget, MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES);
    assert.equal(byId(inventory, 'export.investigation-recipe-summary').schema, INVESTIGATION_GUIDE_EXPORT_SCHEMA);
    assert.equal(byId(inventory, 'export.investigation-recipe-summary').currentVersion, INVESTIGATION_GUIDE_EXPORT_VERSION);
    assert.deepEqual(byId(inventory, 'export.investigation-recipe-summary').supportedVersions, [1, 2, 3]);
    assert.equal(byId(inventory, 'export.investigation-recipe-summary').byteBudget, MAX_INVESTIGATION_GUIDE_EXPORT_BYTES);
    assert.equal(byId(inventory, 'export.investigation-templates').schema, INVESTIGATION_TEMPLATE_SCHEMA);
    assert.equal(byId(inventory, 'export.investigation-templates').currentVersion, INVESTIGATION_TEMPLATE_VERSION);
    assert.equal(byId(inventory, 'export.investigation-templates').byteBudget, MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES);
    assert.equal(byId(inventory, 'export.investigation-cacao-profile').schema, INVESTIGATION_CACAO_SPEC_VERSION);
    assert.equal(byId(inventory, 'export.investigation-cacao-profile').currentVersion, INVESTIGATION_CACAO_PROFILE_VERSION);
    assert.equal(byId(inventory, 'export.investigation-cacao-profile').byteBudget, MAX_INVESTIGATION_CACAO_IMPORT_BYTES);
    assert.equal(byId(inventory, 'export.bulk-review').schema, BULK_REVIEW_SCHEMA);
    assert.equal(byId(inventory, 'export.bulk-review').currentVersion, BULK_REVIEW_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'export.bulk-review').byteBudget, MAX_BULK_REVIEW_STORE_BYTES);
  });

  test('accounts for every public CLI JSON schema literal', async () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const listed = new Set(inventory.entries.flatMap((entry) => entry.schema ? [entry.schema] : []));
    const filenames = (await readdir('cli', { recursive: true }))
      .filter((filename) => filename.endsWith('.mts'));
    const discovered = new Set<string>();
    for (const filename of filenames) {
      const source = await readFile(`cli/${filename}`, 'utf8');
      for (const match of source.matchAll(/['"](whoisleuth\.[a-z0-9.-]+)['"]/gu)) {
        const schema = match[1];
        if (schema && !['whoisleuth.mjs', 'whoisleuth.mts'].includes(schema)) discovered.add(schema);
      }
    }
    assert.deepEqual([...discovered].filter((schema) => !listed.has(schema)), []);
  });

  test('returns a fresh non-mutating document for each report build', () => {
    const first = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    requiredValue(first.entries[0]).supportedVersions.push(999);
    requiredValue(first.entries[0]).note = 'changed';
    const second = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.ok(!requiredValue(second.entries[0]).supportedVersions.includes(999));
    assert.notEqual(requiredValue(second.entries[0]).note, 'changed');
  });

  test('fails closed when a version changes without a supported-version decision', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const entries = structuredClone(inventory.entries);
    requiredValue(entries[0]).currentVersion += 1;
    assert.throws(
      () => validateSchemaCompatibilityEntries(entries),
      /must explicitly end its supported-version list at current version/i,
    );
  });

  test('rejects duplicate ids, unsorted versions, invalid schemas, paths, and budgets', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const duplicate = structuredClone(inventory.entries);
    requiredValue(duplicate[1]).id = requiredValue(duplicate[0]).id;
    assert.throws(() => validateSchemaCompatibilityEntries(duplicate), /invalid or duplicated/i);

    const unsorted = structuredClone(inventory.entries);
    requiredValue(unsorted[0]).supportedVersions = [2, 1, requiredValue(unsorted[0]).currentVersion];
    assert.throws(() => validateSchemaCompatibilityEntries(unsorted), /supported-version list/i);

    const schema = structuredClone(inventory.entries);
    requiredValue(schema[0]).schema = 'bad schema';
    assert.throws(() => validateSchemaCompatibilityEntries(schema), /schema identifier/i);

    const owner = structuredClone(inventory.entries);
    requiredValue(owner[0]).owner = '/private/source.mts';
    assert.throws(() => validateSchemaCompatibilityEntries(owner), /owner path/i);

    const budget = structuredClone(inventory.entries);
    requiredValue(budget[0]).byteBudget = -1;
    assert.throws(() => validateSchemaCompatibilityEntries(budget), /byte budget/i);

    const metadata = structuredClone(inventory.entries);
    Reflect.set(requiredValue(metadata[0]), 'futureVersionBehavior', 'guess');
    assert.throws(() => validateSchemaCompatibilityEntries(metadata), /compatibility metadata/i);

    const writeSemantics = structuredClone(inventory.entries);
    Reflect.set(requiredValue(writeSemantics[0]), 'writeSemantics', 'silent_overwrite');
    assert.throws(() => validateSchemaCompatibilityEntries(writeSemantics), /compatibility metadata/i);
  });

  test('binds browser export entries to the schemas emitted by their real builders', async () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const fixtures: Array<readonly [string, unknown, string | null, number]> = [
      ['export.cases', buildCaseExport([], NOW), null, CASE_SCHEMA_VERSION],
      ['export.brand-profiles', buildBrandProfileExport([], NOW), BRAND_PROFILE_SCHEMA, BRAND_PROFILE_SCHEMA_VERSION],
      ['export.campaigns', buildCampaignExport([], NOW), CAMPAIGN_SCHEMA, CAMPAIGN_SCHEMA_VERSION],
      ['export.campaign-temporal-review', await buildCampaignTemporalExport(
        { id: 'campaign-fixture', name: 'Schema fixture', domains: [] },
        buildCampaignTemporalReview([], []),
        NOW,
      ), CAMPAIGN_TEMPORAL_REVIEW_SCHEMA, CAMPAIGN_TEMPORAL_REVIEW_VERSION],
      ['export.watchlists', buildWatchlistExport({}, NOW), WATCHLIST_SCHEMA, WATCHLIST_SCHEMA_VERSION],
      ['export.shortlist', buildShortlistExport([], NOW), SHORTLIST_SCHEMA, SHORTLIST_SCHEMA_VERSION],
      ['export.detection-rules', buildDetectionRuleExport([], NOW), DETECTION_RULE_SCHEMA, DETECTION_RULE_SCHEMA_VERSION],
      ['export.relationship-observations', buildRelationshipObservationExport([], NOW), RELATIONSHIP_OBSERVATION_SCHEMA, RELATIONSHIP_OBSERVATION_SCHEMA_VERSION],
    ];
    for (const [id, document, schema, version] of fixtures) {
      const listed = byId(inventory, id);
      const normalizedDocument = recordValue(document);
      assert.equal(normalizedDocument.schema ?? null, schema);
      assert.equal(normalizedDocument.version, version);
      assert.equal(listed.schema, normalizedDocument.schema ?? null);
      assert.equal(listed.currentVersion, normalizedDocument.version);
    }

    const caseReport = buildCaseReport({
      id: 'case-fixture', domain: 'schema.invalid', status: 'new', disposition: 'unreviewed',
      tags: [], notes: [], source: 'manual', evidenceHistory: [], evidencePins: [], decisions: [], actions: [], assertions: [], manualTrail: [], sightings: [],
      createdAt: NOW, updatedAt: NOW,
    }, { generatedAt: NOW });
    assert.equal(byId(inventory, 'export.case-report').schema, caseReport.json.schema);
    assert.equal(byId(inventory, 'export.case-report').currentVersion, caseReport.json.schemaVersion);
    assert.equal(caseReport.json.schema, CASE_REPORT_SCHEMA);
    assert.equal(caseReport.json.schemaVersion, CASE_REPORT_SCHEMA_VERSION);
  });

  test('binds CLI entries to the schemas emitted by their real builders', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const fixtures: Array<readonly [string, unknown]> = [
      ['cli.lookup', buildCliLookupDocument('schema.invalid', {
        type: 'domain',
        value: 'schema.invalid',
        inputHostname: 'schema.invalid',
        registrableDomain: 'schema.invalid',
        isSubdomain: false,
      }, {}, NOW)],
      ['cli.bulk', buildCliBulkDocument([], { generatedAt: NOW })],
      ['cli.ct-search', buildCliCtSearchDocument('schema', {}, NOW)],
      ['cli.discover', buildCliDiscoverDocument('schema', {}, { generatedAt: NOW, seed: 'schema', preset: 'balanced', keyboardLayout: 'qwerty', tlds: [] })],
      ['cli.posture', buildCliPostureDocument('schema.invalid', {}, NOW)],
      ['cli.http', buildCliHttpDocument('schema.invalid', {}, NOW)],
      ['cli.tls', buildCliTlsDocument('schema.invalid', {}, NOW)],
      ['cli.compare', buildCliCompareDocument({}, NOW)],
    ];
    for (const [id, document] of fixtures) {
      const listed = byId(inventory, id);
      const normalizedDocument = recordValue(document);
      assert.equal(listed.schema, normalizedDocument.schema);
      assert.equal(listed.currentVersion, normalizedDocument.version);
    }
  });

  test('records deployed legacy readers separately from current-only import contracts', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.equal(brandProfileStoreVersion([]), 1);
    assert.equal(watchlistStoreVersion({ Legacy: { results: [] } }), 1);
    assert.equal(shortlistStoreVersion([]), 1);
    assert.deepEqual(byId(inventory, 'browser.brand-profiles').supportedVersions, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(byId(inventory, 'browser.watchlists').supportedVersions, [1, 2]);
    assert.deepEqual(byId(inventory, 'browser.shortlist').supportedVersions, [1, 2, 3]);
    assert.deepEqual(byId(inventory, 'export.brand-profiles').supportedVersions, [2, 3, 4, 5, 6]);
    assert.deepEqual(byId(inventory, 'export.watchlists').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'export.shortlist').supportedVersions, [2, 3]);
    assert.deepEqual(byId(inventory, 'export.cases').supportedVersions, [...CASE_IMPORT_VERSIONS]);
    assert.deepEqual(byId(inventory, 'export.brand-profiles').supportedVersions, [...SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS]);
    assert.deepEqual(byId(inventory, 'browser.website-snapshots').supportedVersions, [...SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS]);
  });

  test('formats a deterministic maintainer report without absolute paths or user data', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const report = formatSchemaCompatibilityInventory(inventory);
    assert.match(report, /^# WHOISleuth schema compatibility inventory/m);
    assert.match(report, /\| browser\.cases \| browser_store \|/);
    assert.match(report, /\| cli\.compare \| cli_document \|/);
    assert.match(report, /\| browser\.cases \| browser_store \|[^\n]+\| normalized_rewrite \|/);
    assert.match(report, /\| export\.cases \| export \|[^\n]+\| non_destructive_merge \|/);
    assert.match(report, /## Contract notes/);
    assert.match(report, /## Limitations/);
    assert.doesNotMatch(report, /\/Users\//);
    assert.doesNotMatch(report, /localStorage|sessionStorage/);

    const futureInventory = structuredClone(inventory);
    Reflect.set(futureInventory, 'version', 2);
    assert.throws(() => formatSchemaCompatibilityInventory(futureInventory), /current inventory contract/i);
    assert.throws(
      () => formatSchemaCompatibilityInventory({ ...inventory, limitations: ['bad\nvalue'] }),
      /limitations are invalid/i,
    );
  });

  test('escapes every Markdown table and code delimiter after existing backslashes', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    requiredValue(inventory.entries[0]).note = 'Literal \\| and ` marker';
    inventory.limitations = ['Literal \\| and ` marker'];
    const report = formatSchemaCompatibilityInventory(inventory);
    const slash = '\\';
    const escaped = `Literal ${slash}${slash}${slash}| and ${slash}\` marker`;
    assert.match(report, new RegExp(escaped.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.equal(report.split(escaped).length - 1, 2);
  });

  test('keeps the normalized lookup evidence export tied to its listed contract', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const evidence = buildLookupEvidence({ query: 'schema.invalid', type: 'domain' }, { generatedAt: NOW });
    assert.equal(evidence.schema, byId(inventory, 'export.lookup-evidence').schema);
    assert.equal(evidence.schemaVersion, byId(inventory, 'export.lookup-evidence').currentVersion);
  });
});
