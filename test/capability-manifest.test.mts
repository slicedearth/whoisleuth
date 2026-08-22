import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { CLI_COMMANDS, parseCliArguments } from '../cli/arguments.mts';
import { COMMAND_COLLECTION, commandHelp } from '../cli/command-reference.mts';
import { capabilityReport } from '../lib/capabilities.mts';
import { classifyQuery } from '../lib/classify.mts';
import { NETWORK_FEATURE_DEFINITIONS, featureDecision } from '../lib/feature-policy.mts';
import { OPERATION_FEATURE_CLASSES } from '../lib/operation-budget.mts';
import {
  DEFAULT_LEASE_TTL_MS,
  MAX_LEASE_TTL_MS,
  MAX_RESPONSE_BYTES as MAX_DISTRIBUTED_RESPONSE_BYTES,
  MAX_USAGE_LIMIT,
  MIN_LEASE_TTL_MS,
  PROVIDER_RETRY_AFTER_SECONDS,
  REQUEST_TIMEOUT_MS,
} from '../lib/distributed-operation-budget.mts';
import { plannedLookupProgressSources } from '../lib/lookup-source-progress.mts';
import { computeOpportunityScore } from '../lib/opportunity-scoring.mts';
import { computeRiskScore } from '../lib/risk-scoring.mts';
import {
  MAX_CYCLE_DELIVERIES,
  MAX_CYCLE_LOOKUPS,
  MAX_CYCLE_MS,
  MIN_LOOKUP_WINDOW_MS,
} from '../lib/scheduled-monitor-cycle.mts';
import {
  MAX_CAPTURE_HOSTS,
  MAX_CAPTURE_REQUESTS,
  MAX_CAPTURE_RESPONSE_BYTES,
  MAX_CAPTURE_TIMEOUT_MS,
  MAX_CAPTURE_TRANSFER_BYTES,
  MAX_CAPTURE_URL_LENGTH,
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  MAX_WEB_CAPTURE_DOM_ELEMENTS,
  MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS,
  MAX_WEB_CAPTURE_MANIFEST_BYTES,
  MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
  MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES,
} from '../packages/web-capture/capture.mts';
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_SCHEMA,
  CAPABILITY_MANIFEST_VERSION,
  CAPABILITY_OUTCOME_STATES,
  CLI_CAPABILITY_BINDINGS,
  EXECUTION_PLANES,
  MAX_CAPABILITY_MANIFEST_BYTES,
  capabilityDefinition,
  capabilityForSourceId,
  cliOperationForCommand,
} from '../packages/contracts/capability-manifest.mts';
import { buildBulkCollectionPreflight, buildLookupCollectionPreflight } from '../frontend/src/lib/analysis/collection-preflight.ts';
import { renderCapabilityManifestMarkdown } from '../tools/capability-manifest-renderer.mts';
import { OUTPUT_PATH, retainedDocument } from '../tools/capability-manifest.mts';

const EXPECTED_CAPABILITY_IDS = [
  'lookup',
  'rdap',
  'rdap_nameserver_search',
  'whois',
  'availability',
  'domain_evidence',
  'dns_intelligence',
  'website_probe',
  'tls_intelligence',
  'certificate_transparency',
  'security_txt',
  'external_intelligence',
  'urlscan_search',
  'urlhaus_host',
  'threatfox_domain_ioc',
  'registrar_rdap',
  'network_context',
  'reverse_dns',
  'domain_posture',
  'dnssec_validation',
  'mail_transport_review',
  'rendered_web_capture',
  'rendered_capture_comparison',
  'idn_confusables',
  'analyst_cases',
  'watchlists',
  'offline_review',
  'portable_evidence',
  'runtime_diagnostics',
  'workflow_execution',
  'scheduled_monitoring',
  'distributed_budgets',
] as const;

const EXPECTED_LEGACY_CAPABILITY_IDS = [
  'lookup',
  'rdap',
  'rdap_nameserver_search',
  'whois',
  'availability',
  'dns_intelligence',
  'website_probe',
  'tls_intelligence',
  'certificate_transparency',
  'urlscan_search',
  'urlhaus_host',
  'threatfox_domain_ioc',
  'domain_posture',
  'idn_confusables',
  'analyst_cases',
  'watchlists',
  'scheduled_monitoring',
  'distributed_budgets',
] as const;

const EXPECTED_LEGACY_CAPABILITIES = [
  { id: 'lookup', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  { id: 'rdap', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  { id: 'rdap_nameserver_search', status: 'supported', execution: 'hosted', scanModes: [] },
  { id: 'whois', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'availability', status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  { id: 'dns_intelligence', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'website_probe', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'tls_intelligence', status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  { id: 'certificate_transparency', status: 'supported', execution: 'hosted', scanModes: [] },
  {
    id: 'urlscan_search', status: 'disabled', execution: 'hosted', scanModes: ['deep'],
    reason: 'Archived URLscan verdict search is not enabled for this deployment.',
  },
  {
    id: 'urlhaus_host', status: 'disabled', execution: 'hosted', scanModes: ['deep'],
    reason: 'Malware-host intelligence is not enabled for this deployment.',
  },
  {
    id: 'threatfox_domain_ioc', status: 'disabled', execution: 'hosted', scanModes: ['deep'],
    reason: 'Malware-IOC intelligence is not enabled for this deployment.',
  },
  { id: 'domain_posture', status: 'supported', execution: 'hosted', scanModes: [] },
  { id: 'idn_confusables', status: 'local_only', execution: 'browser', scanModes: ['fast', 'deep'] },
  { id: 'analyst_cases', status: 'local_only', execution: 'browser', scanModes: [] },
  { id: 'watchlists', status: 'local_only', execution: 'browser', scanModes: ['fast', 'deep'] },
  {
    id: 'scheduled_monitoring', status: 'disabled', execution: 'worker', scanModes: ['fast'],
    reason: 'Scheduled monitoring is not enabled in this deployment.',
  },
  {
    id: 'distributed_budgets', status: 'unavailable', execution: 'hosted', scanModes: [],
    reason: 'Distributed counters are not configured.',
  },
] as const;

const CAPABILITY_KEYS = new Set([
  'id', 'title', 'job', 'planes', 'trigger', 'networkMode', 'scanModes',
  'disclosedData', 'recipients', 'requestBudget', 'responseBudget', 'concurrency',
  'credentialModel', 'retention', 'export', 'scoringEffect', 'authorisation',
  'cancellation', 'partialResults', 'outcomes', 'documentStates', 'privacyLimitations',
  'featurePolicyId', 'featurePolicyDependencies', 'operationBudgetVariants',
  'workerCycleBudget', 'renderedCaptureBudget', 'legacyCapability',
  'distributedControlBudget',
]);

const CLI_OPERATION_KEYS = new Set([
  'recordId', 'command', 'capabilityFamilyId', 'collectionMode', 'planes', 'trigger',
  'networkMode', 'disclosedData', 'recipients', 'requestBudget', 'responseBudget',
  'concurrency', 'credentialModel', 'retention', 'export', 'scoringEffect',
  'authorisation', 'cancellation', 'partialResults', 'outcomes',
  'documentStates', 'privacyLimitations', 'variants',
]);

const CLI_VARIANT_KEYS = new Set([
  'id', 'planes', 'trigger', 'networkMode', 'disclosedData', 'recipients',
  'requestBudget', 'responseBudget', 'concurrency', 'credentialModel',
  'retention', 'export', 'scoringEffect', 'authorisation', 'cancellation',
  'partialResults', 'outcomes', 'documentStates',
]);

function assertDeeplyFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    assertDeeplyFrozen(child);
  }
}

function visit(value: unknown, visitor: (key: string | null, value: unknown) => void, key: string | null = null): void {
  visitor(key, value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, visitor);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    visit(child, visitor, childKey);
  }
}

describe('canonical capability manifest', () => {
  test('freezes a bounded versioned exact-key catalogue', () => {
    assert.equal(CAPABILITY_MANIFEST.schema, CAPABILITY_MANIFEST_SCHEMA);
    assert.equal(CAPABILITY_MANIFEST.version, CAPABILITY_MANIFEST_VERSION);
    assert.deepEqual(CAPABILITY_MANIFEST.capabilities.map((item) => item.id), EXPECTED_CAPABILITY_IDS);
    assert.equal(new Set(EXPECTED_CAPABILITY_IDS).size, EXPECTED_CAPABILITY_IDS.length);
    assert.equal(Buffer.byteLength(JSON.stringify(CAPABILITY_MANIFEST), 'utf8') <= MAX_CAPABILITY_MANIFEST_BYTES, true);
    assertDeeplyFrozen(CAPABILITY_MANIFEST);

    for (const capability of CAPABILITY_MANIFEST.capabilities) {
      assert.deepEqual(Object.keys(capability).filter((key) => !CAPABILITY_KEYS.has(key)), []);
      assert.match(capability.id, /^[a-z][a-z0-9_]{1,63}$/u);
      assert.ok(capability.planes.length > 0 && capability.planes.length <= EXECUTION_PLANES.length);
      assert.ok(capability.outcomes.length > 0 && capability.outcomes.length <= CAPABILITY_OUTCOME_STATES.length);
      assert.equal(new Set(capability.outcomes).size, capability.outcomes.length);
      assert.ok(capability.outcomes.every((state) => CAPABILITY_OUTCOME_STATES.includes(state)));
      assert.ok((capability.documentStates ?? []).every((state) => state.length > 0 && state.length <= 64));
      assert.ok(capability.privacyLimitations.length > 0 && capability.privacyLimitations.length <= 4);
      assert.ok(capabilityDefinition(capability.id));
      if (capability.disclosedData.includes('none')) assert.deepEqual(capability.disclosedData, ['none']);
      if (capability.recipients.includes('none')) assert.deepEqual(capability.recipients, ['none']);
      if (capability.networkMode === 'none') {
        assert.deepEqual(capability.disclosedData, ['none']);
        assert.deepEqual(capability.recipients, ['none']);
        assert.equal(capability.requestBudget, 'none');
      }
    }
    for (const operation of CAPABILITY_MANIFEST.cliOperations) {
      assert.deepEqual(Object.keys(operation).filter((key) => !CLI_OPERATION_KEYS.has(key)), []);
      assert.match(operation.recordId, /^command\.cli\.[a-z][a-z0-9-]{1,63}$/u);
      assert.ok(capabilityDefinition(operation.capabilityFamilyId));
      assert.equal(new Set(operation.outcomes).size, operation.outcomes.length);
      assert.ok(operation.outcomes.every((state) => CAPABILITY_OUTCOME_STATES.includes(state)));
      for (const variant of operation.variants ?? []) {
        assert.deepEqual(Object.keys(variant).filter((key) => !CLI_VARIANT_KEYS.has(key)), []);
        assert.match(variant.id, /^[a-z][a-z0-9_]{1,63}$/u);
        assert.equal(new Set(variant.outcomes).size, variant.outcomes.length);
        assert.ok(variant.outcomes.every((state) => CAPABILITY_OUTCOME_STATES.includes(state)));
        if (variant.networkMode === 'none') {
          assert.deepEqual(variant.disclosedData, ['none']);
          assert.deepEqual(variant.recipients, ['none']);
          assert.equal(variant.requestBudget, 'none');
        }
      }
    }

    visit(CAPABILITY_MANIFEST, (key, value) => {
      if (typeof value === 'string') assert.ok(value.length <= 1024);
      if (key) assert.doesNotMatch(key, /^(?:target|password|token|secret|apiKey|credentialValue)$/iu);
    });
  });

  test('preserves every public CLI command while adding exact operation boundaries', () => {
    assert.deepEqual(Object.keys(CLI_CAPABILITY_BINDINGS), [...CLI_COMMANDS]);
    assert.deepEqual(CAPABILITY_MANIFEST.cliOperations.map((item) => item.command), [...CLI_COMMANDS]);
    assert.equal(CAPABILITY_MANIFEST.cliOperations.length, CLI_COMMANDS.length);

    for (const command of CLI_COMMANDS) {
      const operation = cliOperationForCommand(command);
      assert.ok(operation);
      assert.equal(operation.command, command);
      assert.equal(operation.collectionMode, COMMAND_COLLECTION[command].mode);
      assert.equal(operation.capabilityFamilyId, CLI_CAPABILITY_BINDINGS[command]);
      assert.match(
        commandHelp(command),
        operation.collectionMode === 'offline' ? /Collection:\n  Offline:/u : /Collection:\n  Network:/u,
      );
      if (operation.collectionMode === 'offline') {
        assert.equal(operation.networkMode, 'none');
        assert.deepEqual(operation.planes, ['local_cli_offline']);
      } else {
        assert.notEqual(operation.networkMode, 'none');
      }
    }

    const active = CAPABILITY_MANIFEST.cliOperations
      .filter((item) => item.planes.includes('local_cli_authorised_active'))
      .map((item) => item.command);
    assert.deepEqual(active, ['dnssec-validate', 'mail-transport']);

    for (const command of ['lookup', 'bulk', 'discover-scan'] as const) {
      const operation = cliOperationForCommand(command);
      assert.ok(operation);
      assert.deepEqual(
        operation.variants?.map((variant) => variant.id),
        ['plan_fast', 'plan_deep', 'collect_fast', 'collect_deep'],
      );
      const plan = operation.variants?.[0];
      assert.ok(plan);
      assert.equal(plan.networkMode, 'none');
      assert.deepEqual(plan.disclosedData, ['none']);
      assert.deepEqual(plan.recipients, ['none']);
      assert.equal(plan.scoringEffect, 'none');
      assert.equal(plan.cancellation, 'bounded_atomic');
      assert.equal(plan.partialResults, 'all_or_nothing');
      assert.deepEqual(plan.outcomes, ['complete']);
      const collection = operation.variants?.[2];
      assert.ok(collection);
      assert.equal(collection.cancellation, command === 'lookup' ? 'client_stops_waiting' : 'queue_stops_admission');
      assert.equal(collection.partialResults, command === 'lookup' ? 'explicit_per_source' : 'explicit_per_item');
      assert.deepEqual(collection.outcomes, ['complete', 'partial']);
    }
    const lookupPlan = parseCliArguments(['lookup', 'example.test', '--plan']);
    const bulkPlan = parseCliArguments(['bulk', 'domains.txt', '--plan']);
    const discoveryPlan = parseCliArguments(['discover-scan', 'Example', '--plan']);
    assert.ok(lookupPlan.action === 'lookup' && lookupPlan.plan);
    assert.ok(bulkPlan.action === 'bulk' && bulkPlan.plan);
    assert.ok(discoveryPlan.action === 'discover-scan' && discoveryPlan.plan);

    for (const command of ['verify-artifact', 'interchange-report', 'inspect-archive'] as const) {
      assert.equal(cliOperationForCommand(command)?.credentialModel, 'optional_secret_passphrase_file');
    }
    assert.equal(cliOperationForCommand('verify-signature')?.credentialModel, 'optional_public_key_file');
    assert.equal(cliOperationForCommand('sign-artifact')?.credentialModel, 'required_secret_private_key_file');
    assert.equal(cliOperationForCommand('dnssec-validate')?.credentialModel, 'required_public_trust_file');
    assert.equal(cliOperationForCommand('mail-transport')?.credentialModel, 'required_public_trust_file');
    assert.equal(cliOperationForCommand('monitor-once')?.scoringEffect, 'none');
    assert.equal(cliOperationForCommand('monitor-once')?.partialResults, 'explicit_per_item');
    assert.deepEqual(cliOperationForCommand('doctor')?.variants?.map((variant) => variant.id), ['default_local', 'network_opt_in']);
    const doctor = cliOperationForCommand('doctor');
    assert.equal(doctor?.responseBudget, 'bounded_runtime_report');
    assert.equal(doctor?.export, 'metadata_only');
    for (const operation of CAPABILITY_MANIFEST.cliOperations) {
      if (!operation.variants?.length) continue;
      for (const key of ['responseBudget', 'export'] as const) {
        const values = new Set(operation.variants.map((variant) => variant[key]));
        if (values.size === 1) assert.equal(operation[key], operation.variants[0]?.[key], `${operation.command}.${key}`);
      }
    }
    assert.deepEqual(cliOperationForCommand('workflow-run')?.outcomes, ['complete', 'partial', 'blocked']);
    assert.deepEqual(
      cliOperationForCommand('workflow-run')?.documentStates,
      ['complete', 'awaiting_network_approval', 'awaiting_analyst_selection', 'step_failed'],
    );
  });

  test('matches feature-policy dependencies and operation-budget identities exactly', () => {
    const policyCapabilities = CAPABILITY_MANIFEST.capabilities.filter((item) => item.featurePolicyId);
    assert.deepEqual(policyCapabilities.map((item) => item.featurePolicyId), Object.keys(NETWORK_FEATURE_DEFINITIONS));

    const enabledPolicy = Object.fromEntries(Object.keys(NETWORK_FEATURE_DEFINITIONS).map((id) => [id, true]));
    for (const capability of policyCapabilities) {
      assert.equal(featureDecision(capability.featurePolicyId ?? '', enabledPolicy).enabled, true);
      for (const dependency of capability.featurePolicyDependencies ?? []) {
        const decision = featureDecision(capability.featurePolicyId ?? '', { ...enabledPolicy, [dependency]: false });
        assert.equal(decision.enabled, false);
        if (!decision.enabled) assert.equal(decision.disabledBy, dependency);
      }
    }

    const manifestBudgetMap = Object.fromEntries(CAPABILITY_MANIFEST.capabilities.flatMap((item) => (
      (item.operationBudgetVariants ?? []).map((variant) => [variant.featureId, variant.classId])
    )));
    assert.deepEqual(manifestBudgetMap, OPERATION_FEATURE_CLASSES);
    for (const capability of CAPABILITY_MANIFEST.capabilities) {
      const variants = capability.operationBudgetVariants ?? [];
      if (variants.length > 1) assert.equal(capability.requestBudget, 'variant_specific');
      if (variants.length === 1) assert.equal(capability.requestBudget, variants[0]?.classId);
    }
  });

  test('preserves the deployed capability-report v1 identity and order', () => {
    const projected = CAPABILITY_MANIFEST.capabilities
      .filter((item) => item.legacyCapability)
      .map((item) => item.id);
    const report = capabilityReport('express', {});
    assert.deepEqual(projected, EXPECTED_LEGACY_CAPABILITY_IDS);
    assert.deepEqual(report.features.map((item) => item.id), EXPECTED_LEGACY_CAPABILITY_IDS);
    assert.deepEqual(report.features, EXPECTED_LEGACY_CAPABILITIES);
    assert.equal(report.version, 1);
  });

  test('describes conditional diagnostic, worker-store, and distributed-control flows truthfully', () => {
    const diagnostics = capabilityDefinition('runtime_diagnostics');
    const worker = capabilityDefinition('scheduled_monitoring');
    const budgets = capabilityDefinition('distributed_budgets');
    assert.ok(diagnostics && worker && budgets);
    assert.deepEqual(diagnostics.disclosedData, ['fixed_diagnostic_probe']);
    assert.deepEqual(cliOperationForCommand('doctor')?.disclosedData, ['fixed_diagnostic_probe']);
    assert.ok(worker.disclosedData.includes('encrypted_compact_watchlist'));
    assert.doesNotMatch(JSON.stringify(worker), /bounded_compact_watchlist/u);
    assert.equal(budgets.networkMode, 'conditional_bounded_passive');
    assert.deepEqual(budgets.disclosedData, ['operation_control_metadata']);
    assert.deepEqual(budgets.recipients, ['configured_control_provider']);
    assert.equal(budgets.authorisation, 'deployment_configuration');
    assert.deepEqual(worker.workerCycleBudget, {
      maxLookups: MAX_CYCLE_LOOKUPS,
      maxProcessedDeliveries: MAX_CYCLE_DELIVERIES,
      softCycleBudgetMs: MAX_CYCLE_MS,
      minLookupWindowMs: MIN_LOOKUP_WINDOW_MS,
    });
    assert.deepEqual(budgets.planes, ['hosted_bounded_passive']);
    assert.deepEqual(budgets.scanModes, []);
    assert.deepEqual(budgets.distributedControlBudget, {
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_DISTRIBUTED_RESPONSE_BYTES,
      providerUnavailableRetryAfterSeconds: PROVIDER_RETRY_AFTER_SECONDS,
      maxRequestAttempts: 1,
      automaticRetries: 0,
      defaultLeaseTtlMs: DEFAULT_LEASE_TTL_MS,
      minLeaseTtlMs: MIN_LEASE_TTL_MS,
      maxLeaseTtlMs: MAX_LEASE_TTL_MS,
      maxUsageCounter: MAX_USAGE_LIMIT,
    });
  });

  test('binds rendered-capture and worker bounds to their enforcement owners', () => {
    const capture = capabilityDefinition('rendered_web_capture');
    const comparison = capabilityDefinition('rendered_capture_comparison');
    assert.ok(capture && comparison);
    assert.deepEqual(capture.disclosedData, ['admitted_resource_request', 'dns_question']);
    assert.deepEqual(capture.recipients, ['target_public_service', 'dns_resolver']);
    assert.match(capture.privacyLimitations.join(' '), /exact URL.*path and query.*allowlisted request headers/u);
    assert.match(capture.privacyLimitations.join(' '), /page title and screenshot.*may reproduce a path or query/u);
    assert.deepEqual(capture.renderedCaptureBudget, {
      maxRequests: MAX_CAPTURE_REQUESTS,
      maxHosts: MAX_CAPTURE_HOSTS,
      maxUrlLength: MAX_CAPTURE_URL_LENGTH,
      maxTimeoutMs: MAX_CAPTURE_TIMEOUT_MS,
      maxResponseBytes: MAX_CAPTURE_RESPONSE_BYTES,
      maxTransferBytes: MAX_CAPTURE_TRANSFER_BYTES,
      maxManifestBytes: MAX_WEB_CAPTURE_MANIFEST_BYTES,
      maxDomDigestBytes: MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
      maxScreenshotBytes: MAX_WEB_CAPTURE_SCREENSHOT_BYTES,
      maxDomElements: MAX_WEB_CAPTURE_DOM_ELEMENTS,
      maxDomProjectionCharacters: MAX_WEB_CAPTURE_DOM_PROJECTION_CHARACTERS,
      maxVisibleTextBytes: MAX_WEB_CAPTURE_VISIBLE_TEXT_BYTES,
    });
    assert.deepEqual(comparison.planes, ['local_tool_offline']);
    assert.equal(comparison.networkMode, 'none');
    assert.equal(comparison.retention, 'transient');
  });

  test('uses a variant-specific trigger for mixed browser and CLI capability families', () => {
    const portableEvidence = capabilityDefinition('portable_evidence');
    assert.ok(portableEvidence);
    assert.deepEqual(portableEvidence.planes, ['browser_local', 'local_cli_offline']);
    assert.equal(portableEvidence.trigger, 'variant_specific');
    assert.match(portableEvidence.privacyLimitations.join(' '), /explicit browser action.*explicit CLI command/u);
  });

  test('binds scoring effects to the score owners instead of family labels', () => {
    const expected = {
      lookup: 'bounded_risk_and_acquisition_input',
      rdap: 'bounded_risk_and_acquisition_input',
      whois: 'bounded_risk_and_acquisition_input',
      availability: 'bounded_risk_and_acquisition_input',
      domain_evidence: 'bounded_risk_and_acquisition_input',
      website_probe: 'bounded_risk_and_acquisition_input',
      dns_intelligence: 'bounded_risk_input',
      external_intelligence: 'bounded_risk_input',
      urlscan_search: 'bounded_risk_input',
      urlhaus_host: 'bounded_risk_input',
      threatfox_domain_ioc: 'bounded_risk_input',
      idn_confusables: 'bounded_risk_input',
      tls_intelligence: 'none',
    } as const;
    for (const [id, effect] of Object.entries(expected)) {
      assert.equal(capabilityDefinition(id)?.scoringEffect, effect, id);
    }

    const baseline = { availability: 'registered' } as const;
    assert.ok(computeRiskScore({ ...baseline, idnReferenceMatch: true }) !== computeRiskScore(baseline));
    assert.equal(computeOpportunityScore({ ...baseline, idnReferenceMatch: true }), computeOpportunityScore(baseline));
    assert.ok(computeOpportunityScore({ ...baseline, activityStatus: 'active' }) !== computeOpportunityScore(baseline));
    assert.ok(computeRiskScore({ ...baseline, idnReferenceMatch: true, activityStatus: 'active' })
      !== computeRiskScore({ ...baseline, idnReferenceMatch: true }));
    const tlsContext = { ...baseline, tls: { status: 'success' } };
    assert.equal(computeRiskScore(tlsContext), computeRiskScore(baseline));
    assert.equal(computeOpportunityScore(tlsContext), computeOpportunityScore(baseline));

    for (const capability of CAPABILITY_MANIFEST.capabilities) {
      if (!Object.hasOwn(expected, capability.id)) assert.equal(capability.scoringEffect, 'none', capability.id);
    }
  });

  test('describes automatic IDN derivation and exact source aliases', () => {
    const idn = capabilityDefinition('idn_confusables');
    assert.ok(idn);
    assert.equal(idn.trigger, 'derived_from_current_evidence');
    assert.equal(idn.authorisation, 'inherited_parent_action');
    assert.equal(capabilityForSourceId('malware_host_intelligence')?.id, 'urlhaus_host');
    assert.equal(capabilityForSourceId('malware_ioc_intelligence')?.id, 'threatfox_domain_ioc');
    assert.equal(capabilityForSourceId('rdap')?.id, 'rdap');
  });

  test('covers browser preflights and CLI progress sources without changing their contracts', () => {
    const browserPreflights = [
      buildLookupCollectionPreflight({ mode: 'fast', targetCount: 1 }),
      buildLookupCollectionPreflight({ mode: 'deep', targetCount: 1, includeSecurityTxt: true, includeExternalIntelligence: true }),
      buildBulkCollectionPreflight({ mode: 'deep', targetCount: 4, concurrency: 3, pacingLabel: 'Bounded pacing' }),
    ];
    for (const preflight of browserPreflights) {
      for (const source of preflight.sources) assert.ok(capabilityForSourceId(source.id), source.id);
    }

    const classified = [
      classifyQuery('example.test'),
      classifyQuery('192.0.2.1'),
      classifyQuery('AS64500'),
    ];
    for (const target of classified) {
      for (const source of plannedLookupProgressSources(target, {
        securityTxt: true,
        externalIntelligence: true,
        malwareHostIntelligence: true,
        malwareIocIntelligence: true,
      })) {
        assert.ok(capabilityForSourceId(source), source);
      }
    }
  });

  test('keeps the generated contract byte-identical to its canonical renderer', () => {
    const expected = renderCapabilityManifestMarkdown();
    assert.equal(retainedDocument(), expected);
    assert.equal(readFileSync(OUTPUT_PATH, 'utf8'), expected);
    assert.match(expected, new RegExp(`${CLI_COMMANDS.length} installed CLI operations`, 'u'));
    assert.match(expected, /budget-exhausted document outcomes remain explicit/u);
  });
});
