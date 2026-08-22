import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_SCHEMA,
  CAPABILITY_MANIFEST_VERSION,
  MAX_CAPABILITY_MANIFEST_BYTES,
} from '../packages/contracts/capability-manifest.mts';
import {
  RISK_CALIBRATION_DATASET_COMPATIBILITY,
  RISK_CALIBRATION_REPORT_COMPATIBILITY,
} from '../packages/contracts/risk-calibration.mts';

import {
  buildSchemaCompatibilityInventory,
  formatSchemaCompatibilityInventory,
  MAX_SCHEMA_COMPATIBILITY_ENTRIES,
  SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA,
  SCHEMA_COMPATIBILITY_INVENTORY_VERSION,
  validateInterchangeSchemaCompatibility,
  validateSchemaCompatibilityEntries,
  validateSchemaLifecycleRegistryCompatibility,
  type SchemaCompatibilityEntry,
  type SchemaCompatibilityInventory,
} from '../tools/schema-compatibility.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import {
  discoverSchemaSources,
  validateSchemaSourceCoverage,
} from '../tools/schema-source-coverage.mts';
import { INTERCHANGE_ARTIFACT_CONTRACTS } from '../lib/interchange-fidelity-registry.mts';
import {
  buildBrandProfileExport,
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
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
  MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES,
  MAX_WEBSITE_SNAPSHOT_STORE_BYTES,
  WEBSITE_SNAPSHOT_SCHEMA,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
  SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS,
  buildWebsiteSnapshotExport,
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
  MAX_CASE_IMPORT_BYTES,
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
} from '../frontend/src/lib/analysis/shortlist-model.ts';
import {
  buildWatchlistExport,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
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
import {
  CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
  CRYPTOGRAPHIC_ASSURANCE_INPUT_VERSION,
  CRYPTOGRAPHIC_ASSURANCE_REVIEW_VERSION,
  CRYPTOGRAPHIC_ASSURANCE_SCHEMA,
} from '../lib/cryptographic-assurance.mts';
import {
  DNSSEC_CHAIN_SCHEMA,
  DNSSEC_CHAIN_VERSION,
  DNSSEC_TRUST_ANCHOR_SCHEMA,
  DNSSEC_TRUST_ANCHOR_VERSION,
  MAX_DNSSEC_TRUST_ANCHOR_BYTES,
} from '../lib/dnssec-chain-validation.mts';
import {
  MAIL_TRANSPORT_INPUT_SCHEMA,
  MAIL_TRANSPORT_INPUT_VERSION,
  MAIL_TRANSPORT_REVIEW_SCHEMA,
  MAIL_TRANSPORT_REVIEW_VERSION,
  MAX_MAIL_TRANSPORT_INPUT_BYTES,
} from '../lib/smtp-transport-review.mts';
import { DOCTOR_SCHEMA, DOCTOR_VERSION } from '../cli/doctor.mts';
import { CLI_COMMAND_CATALOGUE_SCHEMA, CLI_COMMAND_CATALOGUE_VERSION } from '../cli/command-catalogue.mts';
import { CLI_LOOKUP_PLAN_SCHEMA, CLI_LOOKUP_PLAN_VERSION } from '../cli/lookup-plan.mts';
import {
  CLI_WORKFLOW_RECIPE_CATALOGUE_SCHEMA,
  CLI_WORKFLOW_RECIPE_CATALOGUE_VERSION,
} from '../cli/investigation-plan.mts';
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
  BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
  BRAND_PROTECTION_OPERATIONS_REPORT_VERSION,
  MAX_OPERATIONS_REPORT_BYTES,
} from '../frontend/src/lib/analysis/brand-protection-operations-report.ts';
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
    assert.equal(new Set(inventory.entries.map((entry) => entry.id)).size, inventory.entries.length);
    assert.deepEqual(new Set(inventory.entries.map((entry) => entry.kind)), new Set([
      'browser_store', 'tab_store', 'hosted_store', 'export', 'cli_document', 'derived',
    ]));
    assert.ok(inventory.entries.length <= MAX_SCHEMA_COMPATIBILITY_ENTRIES);
    const lifecycleDescriptors = SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => family.compatibility);
    const markdown = formatSchemaCompatibilityInventory(inventory);
    for (const descriptor of lifecycleDescriptors) {
      assert.deepEqual(
        inventory.entries.filter((entry) => entry.id === descriptor.id),
        [{ ...descriptor, supportedVersions: [...descriptor.supportedVersions] }],
      );
      assert.equal(markdown.split(`| ${descriptor.id} |`).length - 1, 1);
      assert.equal(markdown.split(`**${descriptor.id}:**`).length - 1, 1);
    }
    assert.doesNotThrow(() => validateSchemaLifecycleRegistryCompatibility(inventory.entries));
    const missing = inventory.entries.filter((entry) => entry.id !== lifecycleDescriptors[0]?.id);
    assert.throws(
      () => validateSchemaLifecycleRegistryCompatibility(missing),
      /must exactly match the generated inventory row/u,
    );
    const changed = inventory.entries.map((entry) => entry.id === lifecycleDescriptors[0]?.id
      ? { ...entry, note: `${entry.note} changed` }
      : entry);
    assert.throws(
      () => validateSchemaLifecycleRegistryCompatibility(changed),
      /must exactly match the generated inventory row/u,
    );
    assert.equal(byId(inventory, 'browser.cases').currentVersion, CASE_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'export.lookup-evidence').schema, LOOKUP_EVIDENCE_SCHEMA);
    assert.equal(byId(inventory, 'export.lookup-evidence').currentVersion, LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'cli.bulk-checkpoint').schema, 'whoisleuth.cli.bulk-checkpoint');
    assert.equal(byId(inventory, 'cli.progress-event').schema, 'whoisleuth.cli.progress');
    assert.equal(byId(inventory, 'cli.lookup-diff').schema, 'whoisleuth.cli.lookup-diff');
    assert.equal(byId(inventory, 'cli.comparison-ledger').schema, 'whoisleuth.cli.comparison-ledger');
    assert.deepEqual(
      {
        futureVersionBehavior: byId(inventory, 'export.mail-report-review').futureVersionBehavior,
        migration: byId(inventory, 'export.mail-report-review').migration,
        byteBudget: byId(inventory, 'export.mail-report-review').byteBudget,
      },
      { futureVersionBehavior: 'not_applicable', migration: 'read_only', byteBudget: null },
    );
    assert.equal(inventory.entries.some((entry) => entry.id === 'export.case-review-calendar'), false);
    assert.deepEqual(byId(inventory, 'derived.capability-manifest'), {
      id: 'derived.capability-manifest',
      tier: 'internal',
      kind: 'derived',
      schema: CAPABILITY_MANIFEST_SCHEMA,
      currentVersion: CAPABILITY_MANIFEST_VERSION,
      supportedVersions: [1],
      acceptsUnversionedLegacy: false,
      futureVersionBehavior: 'reject',
      migration: 'exact_current_only',
      writeSemantics: 'read_only',
      byteBudget: MAX_CAPABILITY_MANIFEST_BYTES,
      owner: 'packages/contracts/capability-manifest.mts',
      note: 'Read-only fixed product boundary metadata; it enables no capability, request, credential, retention, score, or authorisation.',
    });
    assert.ok(Buffer.byteLength(JSON.stringify(CAPABILITY_MANIFEST), 'utf8') <= MAX_CAPABILITY_MANIFEST_BYTES);
    for (const [id, schema, version] of [
      ['cli.doctor', DOCTOR_SCHEMA, DOCTOR_VERSION],
      ['cli.command-catalogue', CLI_COMMAND_CATALOGUE_SCHEMA, CLI_COMMAND_CATALOGUE_VERSION],
      ['cli.workflow-recipe-catalogue', CLI_WORKFLOW_RECIPE_CATALOGUE_SCHEMA, CLI_WORKFLOW_RECIPE_CATALOGUE_VERSION],
      ['cli.lookup-plan', CLI_LOOKUP_PLAN_SCHEMA, CLI_LOOKUP_PLAN_VERSION],
      ['cli.lookup-timeline', CLI_LOOKUP_TIMELINE_SCHEMA, CLI_LOOKUP_TIMELINE_VERSION],
      ['cli.mail-review', CLI_MAIL_REVIEW_SCHEMA, CLI_MAIL_REVIEW_VERSION],
      ['cli.page-compare', CLI_PAGE_COMPARE_SCHEMA, CLI_PAGE_COMPARE_VERSION],
    ] as const) {
      assert.equal(byId(inventory, id).schema, schema);
      assert.equal(byId(inventory, id).currentVersion, version);
    }
    assert.deepEqual(byId(inventory, 'cli.page-compare').supportedVersions, [4]);
    assert.deepEqual(byId(inventory, 'cli.mail-review').supportedVersions, [3]);
    assert.equal(byId(inventory, 'cli.lookup-reconciliation').schema, 'whoisleuth.cli.lookup-reconciliation');
    assert.equal(byId(inventory, 'cli.registry-doctor').schema, 'whoisleuth.cli.registry-doctor');
    assert.equal(byId(inventory, 'cli.sharing-review').schema, 'whoisleuth.cli.sharing-review');
    assert.equal(byId(inventory, 'cli.sharing-review').currentVersion, 2);
    assert.equal(byId(inventory, 'cli.offline-artifact-verification').currentVersion, 3);
    assert.deepEqual(byId(inventory, 'cli.offline-artifact-verification').supportedVersions, [3]);
    assert.equal(byId(inventory, 'cli.evidence-signature-verification').currentVersion, 2);
    assert.equal(byId(inventory, 'cli.interchange-fidelity-report').currentVersion, 2);
    assert.equal(byId(inventory, 'cli.signed-evidence-package').currentVersion, 2);
    assert.deepEqual(byId(inventory, 'cli.signed-evidence-package').supportedVersions, [2]);
    assert.equal(byId(inventory, 'export.acquisition-decision').schema, 'whoisleuth.acquisition-decision');
    assert.equal(byId(inventory, 'export.lookup-claim-passport').schema, 'whoisleuth.lookup-claim-passport');
    assert.equal(byId(inventory, 'export.lookup-claim-passport').byteBudget, 64 * 1024);
    assert.equal(byId(inventory, 'export.domain-comparison').schema, 'whoisleuth.domain-comparison');
    assert.equal(byId(inventory, 'export.bulk-mail-exposure').schema, 'whoisleuth.bulk-mail-exposure');
    assert.equal(byId(inventory, 'export.bulk-review-manifest').schema, 'whoisleuth.bulk-review-manifest');
    assert.equal(byId(inventory, 'export.investigation-capsule').schema, 'whoisleuth.investigation-capsule');
    assert.equal(byId(inventory, 'derived.lookup-asset-graph').currentVersion, 2);
    assert.equal(byId(inventory, 'derived.case-analyst-records').currentVersion, 1);
    assert.equal(byId(inventory, 'cli.lookalike-calibration-input').schema, 'whoisleuth.lookalike-calibration-input');
    assert.equal(byId(inventory, 'cli.lookalike-calibration').schema, 'whoisleuth.lookalike-calibration');
    assert.equal(byId(inventory, 'cli.risk-calibration-report').currentVersion, 3);
    assert.deepEqual(byId(inventory, 'cli.risk-calibration-report').supportedVersions, [3]);
    assert.deepEqual(byId(inventory, 'cli.risk-calibration-dataset'), {
      ...RISK_CALIBRATION_DATASET_COMPATIBILITY,
      supportedVersions: [...RISK_CALIBRATION_DATASET_COMPATIBILITY.supportedVersions],
    });
    assert.deepEqual(byId(inventory, 'cli.risk-calibration-report'), {
      ...RISK_CALIBRATION_REPORT_COMPATIBILITY,
      supportedVersions: [...RISK_CALIBRATION_REPORT_COMPATIBILITY.supportedVersions],
    });
    assert.equal(byId(inventory, 'cli.maintainer-duplication-report').schema, 'whoisleuth.maintainer-duplication-report');
    assert.equal(byId(inventory, 'maintainer.local-codeql-temporary-reservation').schema, 'whoisleuth.local-codeql-temporary-reservation');
    assert.equal(byId(inventory, 'maintainer.local-codeql-temporary-reservation').byteBudget, 512);
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
    assert.equal(byId(inventory, 'export.cli-case-pack').futureVersionBehavior, 'reject');
    assert.equal(byId(inventory, 'export.cli-case-pack').byteBudget, MAX_CASE_IMPORT_BYTES);
    assert.equal(byId(inventory, 'cli.interchange-fidelity-report').schema, 'whoisleuth.interchange-fidelity-report');
    assert.equal(byId(inventory, 'cli.domain-control-review-input').schema, 'whoisleuth.cli.domain-control-review-input');
    assert.equal(byId(inventory, 'cli.domain-control-observation-review').schema, 'whoisleuth.cli.domain-control-review');
    assert.equal(byId(inventory, 'cli.domain-control-monitor').schema, 'whoisleuth.cli.domain-control-monitor');
    assert.deepEqual(byId(inventory, 'cli.lookup-brief').supportedVersions, [2]);
    assert.equal(byId(inventory, 'cli.registry-cohort').schema, 'whoisleuth.cli.registry-cohort');
    assert.deepEqual(byId(inventory, 'cli.registry-cohort').supportedVersions, [2]);
    assert.equal(byId(inventory, 'cli.domain-control-flight-recorder-input').schema, 'whoisleuth.domain-control-flight-recorder.input');
    assert.equal(byId(inventory, 'cli.domain-control-flight-recorder').schema, 'whoisleuth.domain-control-flight-recorder');
    assert.deepEqual(byId(inventory, 'tab.candidate-handoff').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'cli.bulk').supportedVersions, [3]);
    assert.deepEqual(byId(inventory, 'cli.bulk-item').supportedVersions, [3]);
    assert.deepEqual(byId(inventory, 'cli.bulk-checkpoint').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'cli.lookup').supportedVersions, [1, 2]);
    assert.equal(byId(inventory, 'cli.lookup').migration, 'read_only');
    assert.deepEqual(byId(inventory, 'cli.http').supportedVersions, [3]);
    assert.equal(byId(inventory, 'cli.discovery-scan').schema, CLI_DISCOVERY_SCAN_SCHEMA);
    assert.equal(byId(inventory, 'cli.discovery-scan-item').schema, CLI_DISCOVERY_SCAN_ITEM_SCHEMA);
    assert.equal(byId(inventory, 'cli.discovery-scan').currentVersion, CLI_DISCOVERY_SCAN_VERSION);
    assert.equal(byId(inventory, 'cli.discovery-snapshot').schema, CLI_DISCOVERY_SNAPSHOT_SCHEMA);
    assert.equal(byId(inventory, 'cli.discovery-snapshot').byteBudget, MAX_DISCOVERY_SNAPSHOT_BYTES);
    assert.equal(byId(inventory, 'cli.discovery-observation-snapshot').schema, CLI_DISCOVERY_OBSERVATION_SCHEMA);
    assert.equal(byId(inventory, 'cli.discovery-observation-snapshot').currentVersion, CLI_DISCOVERY_OBSERVATION_VERSION);
    assert.deepEqual(byId(inventory, 'cli.discovery-observation-snapshot').supportedVersions, [2]);
    assert.equal(byId(inventory, 'cli.discovery-observation-snapshot').byteBudget, MAX_DISCOVERY_OBSERVATION_BYTES);
    assert.equal(byId(inventory, 'cli.ct-event-batch').schema, 'whoisleuth.ct-event-batch');
    assert.equal(byId(inventory, 'cli.investigation-manifest').schema, 'whoisleuth.investigation-manifest');
    assert.equal(byId(inventory, 'cli.external-observation-mapping').schema, 'whoisleuth.external-observation-mapping');
    assert.equal(byId(inventory, 'cli.open-asset-model-bridge').schema, 'whoisleuth.open-asset-model-bridge');
    assert.equal(byId(inventory, 'cli.source-reliability-report').schema, 'whoisleuth.source-reliability-report');
    assert.equal(byId(inventory, 'cli.offline-evidence-review').schema, 'whoisleuth.cli.offline-evidence-review');
    for (const [id, schema, version] of [
      ['cli.cryptographic-assurance-input', CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA, CRYPTOGRAPHIC_ASSURANCE_INPUT_VERSION],
      ['cli.cryptographic-assurance-review', CRYPTOGRAPHIC_ASSURANCE_SCHEMA, CRYPTOGRAPHIC_ASSURANCE_REVIEW_VERSION],
      ['cli.dnssec-trust-anchor-input', DNSSEC_TRUST_ANCHOR_SCHEMA, DNSSEC_TRUST_ANCHOR_VERSION],
      ['cli.dnssec-chain-validation', DNSSEC_CHAIN_SCHEMA, DNSSEC_CHAIN_VERSION],
      ['cli.mail-transport-input', MAIL_TRANSPORT_INPUT_SCHEMA, MAIL_TRANSPORT_INPUT_VERSION],
      ['cli.mail-transport-review', MAIL_TRANSPORT_REVIEW_SCHEMA, MAIL_TRANSPORT_REVIEW_VERSION],
    ] as const) {
      assert.equal(byId(inventory, id).schema, schema);
      assert.equal(byId(inventory, id).currentVersion, version);
    }
    assert.deepEqual(byId(inventory, 'cli.cryptographic-assurance-input').supportedVersions, [1]);
    assert.deepEqual(byId(inventory, 'cli.cryptographic-assurance-review').supportedVersions, [2]);
    assert.equal(byId(inventory, 'cli.dnssec-trust-anchor-input').byteBudget, MAX_DNSSEC_TRUST_ANCHOR_BYTES);
    assert.equal(byId(inventory, 'cli.mail-transport-input').byteBudget, MAX_MAIL_TRANSPORT_INPUT_BYTES);
    assert.equal(byId(inventory, 'export.web-capture-summary').schema, WEB_CAPTURE_SUMMARY_SCHEMA);
    assert.equal(byId(inventory, 'export.web-capture-summary').currentVersion, WEB_CAPTURE_SUMMARY_VERSION);
    assert.equal(byId(inventory, 'export.web-capture-manifest').schema, WEB_CAPTURE_MANIFEST_SCHEMA);
    assert.equal(byId(inventory, 'export.web-capture-manifest').currentVersion, WEB_CAPTURE_MANIFEST_VERSION);
    assert.deepEqual(byId(inventory, 'export.web-capture-manifest').supportedVersions, [2]);
    assert.equal(byId(inventory, 'export.web-capture-manifest').byteBudget, MAX_MANIFEST_BYTES);
    assert.equal(byId(inventory, 'export.web-capture-dom-digest').schema, WEB_CAPTURE_DOM_DIGEST_SCHEMA);
    assert.equal(byId(inventory, 'export.web-capture-dom-digest').byteBudget, MAX_WEB_CAPTURE_DOM_DIGEST_BYTES);
    assert.equal(byId(inventory, 'cli.web-capture-comparison').schema, WEB_CAPTURE_COMPARISON_SCHEMA);
    assert.equal(byId(inventory, 'cli.web-capture-comparison').currentVersion, WEB_CAPTURE_COMPARISON_VERSION);
    assert.deepEqual(byId(inventory, 'cli.web-capture-comparison').supportedVersions, [3]);
    assert.deepEqual(byId(inventory, 'export.lookup-evidence').supportedVersions, [26, 27]);
    assert.deepEqual(byId(inventory, 'export.synthetic-demo').supportedVersions, [5]);
    assert.deepEqual(byId(inventory, 'export.external-findings').supportedVersions, [4]);
    assert.equal(byId(inventory, 'import.external-finding-rows').schema, 'whoisleuth.external-finding-rows');
    assert.equal(byId(inventory, 'import.domain-observation-rows').schema, 'whoisleuth.domain-observation-rows');
    assert.equal(byId(inventory, 'import.dns-observation-rows').schema, 'whoisleuth.dns-observation-rows');
    assert.equal(byId(inventory, 'import.certificate-observation-rows').schema, 'whoisleuth.certificate-observation-rows');
    assert.equal(byId(inventory, 'export.relationship-graph').schema, RELATIONSHIP_GRAPH_EXPORT_SCHEMA);
    assert.equal(byId(inventory, 'export.relationship-graph').currentVersion, RELATIONSHIP_GRAPH_EXPORT_VERSION);
    assert.deepEqual(byId(inventory, 'export.relationship-graph').supportedVersions, [3]);
    assert.equal(byId(inventory, 'export.relationship-graph').byteBudget, MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES);
    assert.equal(byId(inventory, 'browser.relationship-observations').schema, null);
    assert.equal(byId(inventory, 'browser.relationship-observations').currentVersion, RELATIONSHIP_OBSERVATION_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'browser.website-snapshots').schema, null);
    assert.equal(byId(inventory, 'browser.website-snapshots').currentVersion, WEBSITE_SNAPSHOT_SCHEMA_VERSION);
    assert.deepEqual(byId(inventory, 'browser.website-snapshots').supportedVersions, [4]);
    assert.equal(byId(inventory, 'browser.website-snapshots').byteBudget, MAX_WEBSITE_SNAPSHOT_STORE_BYTES);
    assert.deepEqual(byId(inventory, 'browser.bulk-sessions').supportedVersions, [4]);
    assert.equal(byId(inventory, 'browser.bulk-sessions').migration, 'exact_current_only');
    assert.equal(byId(inventory, 'browser.bulk-sessions').acceptsUnversionedLegacy, false);
    assert.deepEqual(byId(inventory, 'export.bulk-sessions').supportedVersions, [4]);
    assert.equal(byId(inventory, 'export.bulk-sessions').migration, 'exact_current_only');
    assert.equal(byId(inventory, 'export.bulk-sessions').acceptsUnversionedLegacy, false);
    assert.equal(byId(inventory, 'browser.investigation-templates').schema, null);
    assert.equal(byId(inventory, 'browser.investigation-templates').currentVersion, INVESTIGATION_TEMPLATE_VERSION);
    assert.deepEqual(byId(inventory, 'browser.investigation-templates').supportedVersions, [2]);
    assert.equal(byId(inventory, 'browser.investigation-templates').byteBudget, MAX_INVESTIGATION_TEMPLATE_STORE_BYTES);
    assert.equal(byId(inventory, 'browser.bulk-review').schema, null);
    assert.equal(byId(inventory, 'browser.bulk-review').currentVersion, BULK_REVIEW_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'browser.bulk-review').byteBudget, MAX_BULK_REVIEW_STORE_BYTES);
    assert.equal(byId(inventory, 'export.workspace-archive').schema, WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(byId(inventory, 'export.workspace-archive').currentVersion, WORKSPACE_ARCHIVE_VERSION);
    assert.deepEqual(byId(inventory, 'export.workspace-archive').supportedVersions, [5, 6]);
    assert.equal(byId(inventory, 'export.workspace-archive').byteBudget, MAX_WORKSPACE_ARCHIVE_BYTES);
    assert.deepEqual(byId(inventory, 'export.case-response-packet').supportedVersions, [6, 7]);
    assert.deepEqual(byId(inventory, 'derived.case-response-review-inputs').supportedVersions, [1]);
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
    assert.deepEqual(byId(inventory, 'tab.investigation-guide').supportedVersions, [5]);
    assert.equal(byId(inventory, 'tab.investigation-guide').byteBudget, MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES);
    assert.equal(byId(inventory, 'export.investigation-recipe-summary').schema, INVESTIGATION_GUIDE_EXPORT_SCHEMA);
    assert.equal(byId(inventory, 'export.investigation-recipe-summary').currentVersion, INVESTIGATION_GUIDE_EXPORT_VERSION);
    assert.deepEqual(byId(inventory, 'export.investigation-recipe-summary').supportedVersions, [4]);
    assert.equal(byId(inventory, 'export.investigation-recipe-summary').byteBudget, MAX_INVESTIGATION_GUIDE_EXPORT_BYTES);
    assert.equal(byId(inventory, 'export.investigation-templates').schema, INVESTIGATION_TEMPLATE_SCHEMA);
    assert.equal(byId(inventory, 'export.investigation-templates').currentVersion, INVESTIGATION_TEMPLATE_VERSION);
    assert.equal(byId(inventory, 'export.investigation-templates').byteBudget, MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES);
    assert.equal(byId(inventory, 'export.investigation-cacao-profile').schema, INVESTIGATION_CACAO_SPEC_VERSION);
    assert.equal(byId(inventory, 'export.investigation-cacao-profile').currentVersion, INVESTIGATION_CACAO_PROFILE_VERSION);
    assert.equal(byId(inventory, 'export.investigation-cacao-profile').byteBudget, MAX_INVESTIGATION_CACAO_IMPORT_BYTES);
    assert.deepEqual(byId(inventory, 'export.investigation-cacao-profile').supportedVersions, [2]);
    assert.equal(byId(inventory, 'export.brand-protection-operations-report').schema, BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA);
    assert.equal(byId(inventory, 'export.brand-protection-operations-report').currentVersion, BRAND_PROTECTION_OPERATIONS_REPORT_VERSION);
    assert.equal(byId(inventory, 'export.brand-protection-operations-report').byteBudget, MAX_OPERATIONS_REPORT_BYTES);
    assert.deepEqual(byId(inventory, 'export.brand-protection-operations-report').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'export.case-report').supportedVersions, [9]);
    assert.equal(byId(inventory, 'export.bulk-review').schema, BULK_REVIEW_SCHEMA);
    assert.equal(byId(inventory, 'export.bulk-review').currentVersion, BULK_REVIEW_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'export.bulk-review').byteBudget, MAX_BULK_REVIEW_STORE_BYTES);
    assert.equal(byId(inventory, 'export.website-snapshots').schema, WEBSITE_SNAPSHOT_SCHEMA);
    assert.equal(byId(inventory, 'export.website-snapshots').currentVersion, WEBSITE_SNAPSHOT_SCHEMA_VERSION);
    assert.equal(byId(inventory, 'export.website-snapshots').byteBudget, MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES);
  });

  test('accounts for every production schema-like identifier and canonical owner', async () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const discovery = await discoverSchemaSources();
    const coverage = await validateSchemaSourceCoverage(inventory.entries, discovery);
    assert.ok(coverage.files > 700);
    assert.equal(coverage.identifiers, coverage.inventoriedIdentifiers + coverage.classifiedIdentifiers);
    assert.match(coverage.digestSha256, /^[a-f0-9]{64}$/u);
  });

  test('returns a fresh non-mutating document for each report build', () => {
    const first = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    requiredValue(first.entries[0]).supportedVersions.push(999);
    requiredValue(first.entries[0]).note = 'changed';
    const second = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.ok(!requiredValue(second.entries[0]).supportedVersions.includes(999));
    assert.notEqual(requiredValue(second.entries[0]).note, 'changed');
  });

  test('requires interchange readers and the compatibility inventory to expose the exact same versions', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.doesNotThrow(() => validateInterchangeSchemaCompatibility(inventory.entries));
    const lookup = requiredValue(INTERCHANGE_ARTIFACT_CONTRACTS.find((item) => item.id === 'lookup_evidence'));
    const missingLegacy = INTERCHANGE_ARTIFACT_CONTRACTS.map((item) => item === lookup
      ? { ...item, versions: [LOOKUP_EVIDENCE_SCHEMA_VERSION] }
      : item);
    assert.throws(
      () => validateInterchangeSchemaCompatibility(inventory.entries, missingLegacy),
      /must exactly match/iu,
    );
    const wrongEntry = INTERCHANGE_ARTIFACT_CONTRACTS.map((item) => item === lookup
      ? { ...item, compatibilityEntryId: 'export.workspace-archive' }
      : item);
    assert.throws(
      () => validateInterchangeSchemaCompatibility(inventory.entries, wrongEntry),
      /must exactly match/iu,
    );
    const futureMismatch = structuredClone(inventory.entries);
    requiredValue(futureMismatch.find((entry) => entry.id === 'export.cli-case-pack')).futureVersionBehavior = 'not_applicable';
    assert.throws(
      () => validateInterchangeSchemaCompatibility(futureMismatch),
      /future-version behaviour/iu,
    );
    assert.doesNotThrow(() => validateInterchangeSchemaCompatibility([...inventory.entries].reverse()));
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

    const colonSchema = structuredClone(inventory.entries);
    requiredValue(colonSchema[0]).schema = 'whoisleuth.valid:profile';
    assert.throws(() => validateSchemaCompatibilityEntries(colonSchema), /schema identifier/i);

    const malformedLocalSchema = structuredClone(inventory.entries);
    requiredValue(malformedLocalSchema[0]).schema = 'whoisleuth.bad..profile';
    assert.throws(() => validateSchemaCompatibilityEntries(malformedLocalSchema), /schema identifier/i);

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

    const undeclaredProfile = structuredClone(inventory.entries);
    undeclaredProfile.push({
      ...requiredValue(undeclaredProfile.find((entry) => entry.id === 'export.lookup-evidence')),
      id: 'export.lookup-evidence-shadow',
    });
    assert.throws(() => validateSchemaCompatibilityEntries(undeclaredProfile), /undeclared profiles/iu);

    const inheritedProfile = structuredClone(inventory.entries);
    const inheritedSeed = requiredValue(inheritedProfile.find((entry) => entry.id === 'cli.lookup-plan'));
    inheritedSeed.schema = 'constructor';
    inheritedProfile.push({ ...inheritedSeed, id: 'cli.lookup-plan-shadow' });
    assert.throws(() => validateSchemaCompatibilityEntries(inheritedProfile), /undeclared profiles/iu);

    const incompleteProfile = structuredClone(inventory.entries)
      .filter((entry) => entry.id !== 'export.watchlists');
    assert.throws(() => validateSchemaCompatibilityEntries(incompleteProfile), /must exactly match/iu);
  });

  test('snapshots exact compatibility rows without invoking caller-owned accessors or collection methods', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });

    const withExtraField = structuredClone(inventory.entries) as Array<Record<string, unknown>>;
    withExtraField[0]!.unexpected = true;
    assert.throws(
      () => validateSchemaCompatibilityEntries(withExtraField as unknown as SchemaCompatibilityEntry[]),
      /exact registered fields/iu,
    );

    let noteReads = 0;
    const accessorRows = structuredClone(inventory.entries);
    Object.defineProperty(requiredValue(accessorRows[0]), 'note', {
      enumerable: true,
      configurable: true,
      get() {
        noteReads += 1;
        return 'must not be read';
      },
    });
    assert.throws(
      () => formatSchemaCompatibilityInventory({ ...inventory, entries: accessorRows }),
      /ordinary enumerable data fields/iu,
    );
    assert.equal(noteReads, 0);

    let customMethodCalls = 0;
    const customFilter = structuredClone(inventory.entries) as typeof inventory.entries & {
      filter: typeof inventory.entries.filter;
    };
    Object.defineProperty(customFilter, 'filter', {
      enumerable: true,
      configurable: true,
      value() {
        customMethodCalls += 1;
        return [];
      },
    });
    assert.throws(
      () => validateSchemaLifecycleRegistryCompatibility(customFilter),
      /without custom fields/iu,
    );
    const customIterator = structuredClone(inventory.entries);
    Object.defineProperty(customIterator, Symbol.iterator, {
      enumerable: false,
      configurable: true,
      value() {
        customMethodCalls += 1;
        return [][Symbol.iterator]();
      },
    });
    assert.throws(
      () => validateSchemaCompatibilityEntries(customIterator),
      /without custom fields/iu,
    );
    assert.equal(customMethodCalls, 0);

    let lengthDescriptorReads = 0;
    const stableProxy = new Proxy(structuredClone(inventory.entries), {
      get() {
        throw new Error('Compatibility arrays must not be read through property access.');
      },
      getOwnPropertyDescriptor(target, property) {
        if (property === 'length') lengthDescriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    assert.doesNotThrow(() => validateSchemaCompatibilityEntries(stableProxy));
    assert.equal(lengthDescriptorReads, 1);

    const revoked = Proxy.revocable(structuredClone(inventory.entries), {});
    revoked.revoke();
    assert.throws(() => validateSchemaCompatibilityEntries(revoked.proxy));

    let overLimitGetterCalls = 0;
    const overLimit = Array(MAX_SCHEMA_COMPATIBILITY_ENTRIES + 1).fill(requiredValue(inventory.entries[0]));
    Object.defineProperty(overLimit, '0', {
      enumerable: true,
      configurable: true,
      get() {
        overLimitGetterCalls += 1;
        return requiredValue(inventory.entries[0]);
      },
    });
    assert.throws(
      () => validateSchemaCompatibilityEntries(overLimit),
      /must contain 1-224 entries/iu,
    );
    assert.equal(overLimitGetterCalls, 0);
  });

  test('snapshots the exact report wrapper and limitations without invoking caller-owned values', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });

    const extraField = { ...structuredClone(inventory), unexpected: true };
    assert.throws(
      () => formatSchemaCompatibilityInventory(extraField as unknown as SchemaCompatibilityInventory),
      /exact registered fields/iu,
    );

    let schemaReads = 0;
    const schemaAccessor = structuredClone(inventory);
    Object.defineProperty(schemaAccessor, 'schema', {
      enumerable: true,
      configurable: true,
      get() {
        schemaReads += 1;
        return SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA;
      },
    });
    assert.throws(
      () => formatSchemaCompatibilityInventory(schemaAccessor),
      /ordinary enumerable data fields/iu,
    );
    assert.equal(schemaReads, 0);

    let customMethodCalls = 0;
    const customLimitations = structuredClone(inventory);
    Object.defineProperty(customLimitations.limitations, 'some', {
      enumerable: true,
      configurable: true,
      value() {
        customMethodCalls += 1;
        return false;
      },
    });
    assert.throws(
      () => formatSchemaCompatibilityInventory(customLimitations),
      /without custom fields/iu,
    );
    assert.equal(customMethodCalls, 0);

    const revoked = Proxy.revocable(structuredClone(inventory), {});
    revoked.revoke();
    assert.throws(
      () => formatSchemaCompatibilityInventory(revoked.proxy),
    );

    let overLimitGetterCalls = 0;
    const overLimit = structuredClone(inventory);
    overLimit.limitations = Array(9).fill('bounded limitation');
    Object.defineProperty(overLimit.limitations, '0', {
      enumerable: true,
      configurable: true,
      get() {
        overLimitGetterCalls += 1;
        return 'must not be read';
      },
    });
    assert.throws(
      () => formatSchemaCompatibilityInventory(overLimit),
      /must contain 0-8 entries/iu,
    );
    assert.equal(overLimitGetterCalls, 0);
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
      ['export.website-snapshots', buildWebsiteSnapshotExport([], NOW), WEBSITE_SNAPSHOT_SCHEMA, WEBSITE_SNAPSHOT_SCHEMA_VERSION],
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
      id: 'case-fixture', domain: 'schema.invalid', status: 'new', disposition: 'unreviewed', brandProfileIds: [],
      tags: [], notes: [], source: 'manual', evidenceHistory: [], evidencePins: [], decisions: [], actions: [], assertions: [], manualTrail: [], sightings: [],
      observedEffects: { reviews: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
      closures: { records: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
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
      }, { diagnostics: { rdap: { status: 'unsupported' }, whois: { status: 'skipped' } } }, NOW)],
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

  test('records the exact public-to-v2 durable boundary separately from output-only and internal contracts', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    assert.equal(byId(inventory, 'browser.cases').tier, 'durable_interchange');
    assert.equal(byId(inventory, 'export.case-report').tier, 'published_output');
    assert.equal(byId(inventory, 'derived.case-response-review-inputs').tier, 'internal');
    assert.deepEqual(byId(inventory, 'browser.cases').supportedVersions, [12, 13]);
    assert.deepEqual(byId(inventory, 'browser.brand-profiles').supportedVersions, [6, 7]);
    assert.deepEqual(byId(inventory, 'browser.watchlists').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'browser.shortlist').supportedVersions, [3]);
    assert.deepEqual(byId(inventory, 'browser.ct-history').supportedVersions, [3]);
    assert.deepEqual(byId(inventory, 'export.brand-profiles').supportedVersions, [6, 7]);
    assert.deepEqual(byId(inventory, 'export.watchlists').supportedVersions, [2]);
    assert.deepEqual(byId(inventory, 'export.shortlist').supportedVersions, [3]);
    assert.deepEqual(byId(inventory, 'export.cases').supportedVersions, [...CASE_IMPORT_VERSIONS]);
    assert.deepEqual(byId(inventory, 'export.brand-profiles').supportedVersions, [...SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS]);
    assert.deepEqual(byId(inventory, 'browser.website-snapshots').supportedVersions, [...SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS]);
    assert.deepEqual(byId(inventory, 'export.investigation-capsule').supportedVersions, [2, 3]);
    assert.deepEqual(byId(inventory, 'derived.lookup-investigation-brief').supportedVersions, [1, 2]);
    assert.deepEqual(byId(inventory, 'export.lookup-readable-report').supportedVersions, [3]);
    assert.equal(byId(inventory, 'export.investigation-capsule').currentVersion, 3);
    assert.equal(byId(inventory, 'derived.lookup-investigation-brief').currentVersion, 2);
    assert.equal(byId(inventory, 'export.lookup-readable-report').currentVersion, 3);
  });

  test('formats a deterministic maintainer report without absolute paths or user data', () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const report = formatSchemaCompatibilityInventory(inventory);
    assert.match(report, /^# WHOISleuth schema compatibility inventory/m);
    assert.match(report, /\| browser\.cases \| durable_interchange \| browser_store \|/);
    assert.match(report, /\| cli\.compare \| published_output \| cli_document \|/);
    assert.match(report, /\| browser\.cases \| durable_interchange \| browser_store \|[^\n]+\| normalized_rewrite \|/);
    assert.match(report, /\| export\.cases \| durable_interchange \| export \|[^\n]+\| non_destructive_merge \|/);
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
