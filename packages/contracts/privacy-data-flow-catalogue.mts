import {
  CAPABILITY_MANIFEST_SCHEMA,
  CAPABILITY_MANIFEST_VERSION,
  type CapabilityDefinition,
  type CapabilityId,
  type CapabilityManifest,
  type CliExecutionVariant,
  type CliOperationDefinition,
} from './capability-manifest.mts';
import {
  CLI_COMMAND_CATALOGUE_SCHEMA,
  CLI_COMMAND_CATALOGUE_VERSION,
} from './cli-command-catalogue.mts';
import { defineSchemaCompatibility } from './schema-compatibility.mts';
import {
  defineSchemaLifecycleFamily,
  type SchemaLifecycleConsumerDiscriminator,
  type SchemaLifecycleRegistry,
  type SchemaLifecycleVariantDiscriminator,
} from './schema-lifecycle.mts';

export const PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA = 'whoisleuth.privacy-data-flow-catalogue';
export const PRIVACY_DATA_FLOW_CATALOGUE_VERSION = 1 as const;
export const PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_SCHEMA = CLI_COMMAND_CATALOGUE_SCHEMA;
export const PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_VERSION = CLI_COMMAND_CATALOGUE_VERSION;
export const MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES = 1024 * 1024;
export const MAX_PRIVACY_CAPABILITIES = 128;
export const MAX_PRIVACY_CLI_OPERATIONS = 128;
export const MAX_PRIVACY_CLI_VARIANTS = 512;
export const MAX_PRIVACY_SCHEMA_FAMILIES = 64;
export const MAX_PRIVACY_SCHEMA_CONTRACTS = 512;
export const MAX_PRIVACY_SCHEMA_PROFILES = 256;
export const MAX_PRIVACY_SCHEMA_CONSUMER_FLOWS = 512;
const MAX_PRIVACY_LIST_ENTRIES = 128;
const MAX_PRIVACY_TEXT_LENGTH = 4_096;
const MAX_PRIVACY_IDENTIFIER_LENGTH = 160;
const MAX_PRIVACY_PRECOPY_NODES = 100_000;

export const PRIVACY_PROCESSING_CLASSES = Object.freeze([
  Object.freeze({
    id: 'transient_processing',
    title: 'Transient processing',
    description: 'Bounded data is processed in memory for the current operation without automatic durable retention.',
  }),
  Object.freeze({
    id: 'browser_local_retention',
    title: 'Browser-local retention',
    description: 'A deliberate browser action retains bounded state in the current browser profile or tab.',
  }),
  Object.freeze({
    id: 'deliberate_local_file_export',
    title: 'Deliberate local-file export',
    description: 'An explicit browser, CLI, or local-tool action creates output under the operator\'s file-retention control.',
  }),
  Object.freeze({
    id: 'hosted_bounded_processing',
    title: 'Hosted bounded processing',
    description: 'An authenticated hosted runtime processes a bounded request and response within the declared operation limits.',
  }),
  Object.freeze({
    id: 'configured_worker_storage',
    title: 'Configured worker storage',
    description: 'An optional configured worker retains only its bounded declared state under operator-controlled storage policy.',
  }),
  Object.freeze({
    id: 'third_party_disclosure',
    title: 'Third-party disclosure',
    description: 'A bounded request discloses only its declared data classes to the declared recipient classes.',
  }),
  Object.freeze({
    id: 'offline_processing_no_request',
    title: 'Offline processing with no request',
    description: 'Selected local input is processed without a DNS, registry, HTTP, TLS, mail, provider, or hosted-service request.',
  }),
] as const);

export type PrivacyProcessingClassId = typeof PRIVACY_PROCESSING_CLASSES[number]['id'];

export const PRIVACY_CATALOGUE_INVARIANTS = Object.freeze([
  'The catalogue contains fixed contract metadata only; it contains no target, evidence value, personal data, raw contact, credential, cookie, authorisation value, runtime secret, complete query-bearing URL, unnecessary path or local filesystem detail.',
  'Retention and export are independent: a transient projection can be deliberately exported, and retained state is not exported unless a separate deliberate path is declared.',
  'Offline operations make no request and do not inherit a capability family\'s possible network disclosure.',
  'Missing, unavailable, unsupported, stale, blocked, partial or unobserved evidence never establishes absence, safety, ownership, control, activity or maliciousness.',
  'A normalised outcome marked not_declared_for_boundary is outside that boundary\'s current output vocabulary; it is not evidence that the state cannot occur upstream or that evidence is absent.',
  'The catalogue describes current checked-in contracts. It does not enable a capability, make a request, grant authorisation, inspect a deployment or create a legal conclusion.',
] as const);

const NORMALISED_OUTCOME_STATES = Object.freeze([
  'unavailable',
  'blocked',
  'partial',
  'unsupported',
] as const);

type PrivacyNormalisedOutcomeProjection = Readonly<Record<
  typeof NORMALISED_OUTCOME_STATES[number],
  'explicit_outcome' | 'not_declared_for_boundary'
>>;

type CapabilityPrivacyDetail = Readonly<{
  requestPurpose: string;
  returnedDataCategories: readonly string[];
}>;

function capabilityPrivacyDetail(
  requestPurpose: string,
  returnedDataCategories: readonly string[],
): CapabilityPrivacyDetail {
  return Object.freeze({
    requestPurpose,
    returnedDataCategories: Object.freeze([...returnedDataCategories]),
  });
}

const CAPABILITY_PRIVACY_DETAILS = Object.freeze({
  lookup: capabilityPrivacyDetail('Coordinate the selected bounded Lookup or multi-target collection mode.', ['source_attributed_lookup_evidence', 'source_health', 'bounded_assessments']),
  rdap: capabilityPrivacyDetail('Retrieve public registration or allocation evidence from the applicable RDAP service.', ['published_registration_or_allocation', 'source_health']),
  rdap_nameserver_search: capabilityPrivacyDetail('Search one selected registry for a bounded nameserver result set.', ['registry_scoped_domain_candidates', 'source_health']),
  whois: capabilityPrivacyDetail('Retrieve separately attributed referral-aware WHOIS publication evidence.', ['published_whois_evidence', 'source_health']),
  availability: capabilityPrivacyDetail('Produce an authority-aware registration-availability decision.', ['authority_aware_availability', 'source_health']),
  domain_evidence: capabilityPrivacyDetail('Collect the source-qualified domain evidence eligible for the selected mode.', ['normalised_domain_evidence', 'source_health']),
  dns_intelligence: capabilityPrivacyDetail('Collect bounded public DNS publication evidence.', ['normalised_dns_evidence', 'source_health']),
  website_probe: capabilityPrivacyDetail('Observe one bounded homepage and static response workflow.', ['bounded_http_and_page_evidence', 'source_health']),
  tls_intelligence: capabilityPrivacyDetail('Observe one bounded TLS connection and certificate presentation.', ['bounded_tls_evidence', 'source_health']),
  certificate_transparency: capabilityPrivacyDetail('Search retained public certificate observations for a bounded term.', ['certificate_observation_leads', 'source_health']),
  security_txt: capabilityPrivacyDetail('Collect one optional bounded security.txt publication.', ['normalised_security_contact_publication', 'source_health']),
  external_intelligence: capabilityPrivacyDetail('Run only the explicitly selected configured intelligence adapters.', ['provider_attributed_review_leads', 'source_health']),
  urlscan_search: capabilityPrivacyDetail('Search existing archived public scan verdicts without submitting a scan.', ['archived_scan_review_leads', 'source_health']),
  urlhaus_host: capabilityPrivacyDetail('Search existing malware-host records for one canonical registrable domain.', ['archived_malware_host_review_leads', 'source_health']),
  threatfox_domain_ioc: capabilityPrivacyDetail('Search retained malware indicators for one exact canonical domain.', ['retained_indicator_review_leads', 'source_health']),
  registrar_rdap: capabilityPrivacyDetail('Retrieve one eligible sponsoring-registrar RDAP publication as a separate source.', ['registrar_registration_publication', 'source_health']),
  network_context: capabilityPrivacyDetail('Add bounded public allocation context for one observed public endpoint address.', ['public_network_allocation_context', 'source_health']),
  reverse_dns: capabilityPrivacyDetail('Resolve bounded reverse-DNS names for one public address.', ['reverse_dns_publication', 'source_health']),
  domain_posture: capabilityPrivacyDetail('Review bounded DNS and mail publication posture without changing configuration.', ['normalised_posture_evidence', 'source_health']),
  dnssec_validation: capabilityPrivacyDetail('Validate an explicitly authorised DNSSEC chain against a selected local trust anchor.', ['dnssec_validation_evidence', 'source_health']),
  mail_transport_review: capabilityPrivacyDetail('Review selected explicitly authorised SMTP transport and STARTTLS behaviour.', ['mail_transport_evidence', 'source_health']),
  rendered_web_capture: capabilityPrivacyDetail('Capture one explicitly authorised rendered page within the local-tool budget.', ['bounded_rendered_capture', 'capture_manifest']),
  rendered_capture_comparison: capabilityPrivacyDetail('Compare selected rendered-capture artefacts without another request.', ['bounded_capture_comparison']),
  idn_confusables: capabilityPrivacyDetail('Derive bounded Unicode and confusable context from the current target.', ['confusable_analysis']),
  analyst_cases: capabilityPrivacyDetail('Retain analyst-selected Case material and the separately bounded Review Item lifecycle overlay in the browser profile.', ['bounded_case_state', 'bounded_analyst_review_state']),
  watchlists: capabilityPrivacyDetail('Retain analyst-selected watchlist and monitoring-view state in the browser profile.', ['bounded_watchlist_state']),
  offline_review: capabilityPrivacyDetail('Review or derive from deliberately selected bounded local evidence without a request.', ['bounded_offline_review']),
  portable_evidence: capabilityPrivacyDetail('Build, verify or review bounded portable evidence under operator control.', ['bounded_portable_evidence', 'integrity_or_compatibility_state']),
  runtime_diagnostics: capabilityPrivacyDetail('Report local runtime readiness and only the explicitly selected fixed network diagnostics.', ['bounded_runtime_diagnostics']),
  workflow_execution: capabilityPrivacyDetail('Plan or run only installed fixed workflow steps with separate network approval.', ['bounded_workflow_state', 'explicit_step_outcomes']),
  scheduled_monitoring: capabilityPrivacyDetail('Run an operator-configured bounded monitoring cycle over encrypted compact state.', ['compact_monitoring_evidence', 'delivery_state', 'bounded_recovery_counts']),
  distributed_budgets: capabilityPrivacyDetail('Enforce configured distributed admission and usage controls using control metadata only.', ['bounded_control_state']),
} satisfies Readonly<Record<CapabilityId, CapabilityPrivacyDetail>>);

type CliPrivacySource = Readonly<{
  recordId: `command.cli.${string}`;
  command: string;
  title: string;
  requestPurpose: string;
  privacyBoundary: string;
  collectionMode: 'offline' | 'network';
  networkEffect: 'offline' | 'always_network' | 'conditional_network';
}>;

type PrivacyRetentionProjection = Readonly<{
  mode: string;
  storageClass: string;
  durationControl: string;
}>;

type PrivacyExportProjection = Readonly<{
  mode: string;
  classes: readonly string[];
}>;

type PrivacyBoundaryFields = Readonly<{
  executionPlanes: readonly string[];
  trigger: string;
  networkMode: string;
  authorisation: string;
  dataSent: readonly string[];
  dataDeliberatelyNotSent: readonly string[];
  recipientClasses: readonly string[];
  returnedDataCategories: readonly string[];
  processingClasses: readonly PrivacyProcessingClassId[];
  requestBudget: string;
  responseBudget: string;
  concurrency: string;
  retention: PrivacyRetentionProjection;
  exports: PrivacyExportProjection;
  credentialModel: string;
  credentialUse: string;
  cancellation: string;
  partialResults: string;
  outcomes: readonly string[];
  normalisedOutcomes: PrivacyNormalisedOutcomeProjection;
  documentStates: readonly string[];
  scoringEffect: string;
  nonInferences: readonly string[];
}>;

type PrivacyCapabilityFlow = PrivacyBoundaryFields & Readonly<{
  id: string;
  title: string;
  requestPurpose: string;
  job: string;
}>;

type PrivacyCliVariantFlow = PrivacyBoundaryFields & Readonly<{
  id: string;
  operationId: string;
  variantId: string;
  title: string;
  requestPurpose: string;
}>;

type PrivacyCliOperationFlow = PrivacyBoundaryFields & Readonly<{
  id: string;
  command: string;
  capabilityFamilyId: string;
  title: string;
  requestPurpose: string;
  collectionMode: 'offline' | 'network';
  variants: readonly PrivacyCliVariantFlow[];
}>;

type PrivacySchemaFamily = Readonly<{
  id: string;
  privacyClass: string;
  compatibilityIds: readonly string[];
  privacyProfileIds: readonly string[];
  consumerFlowIds: readonly string[];
}>;

type PrivacySchemaContract = Readonly<{
  id: string;
  familyId: string;
  kind: string;
  schema: string | null;
  lifecycleSchema: string;
  coverageClass: 'registered_schema' | 'registered_non_schema_identity';
  currentVersion: number;
  supportedVersions: readonly number[];
  futureVersionBehavior: string;
  migration: string;
  writeSemantics: string;
  byteBudget: number | null;
  storageClass: string;
  retentionControl: string;
}>;

type PrivacySchemaProfile = Readonly<{
  id: string;
  familyId: string;
  classification: string;
  projection: string;
  includedCategories: readonly string[];
  excludedCategories: readonly string[];
  notePolicy: string;
  retention: string;
  network: string;
  sharingReview: string;
  consumerFlowIds: readonly string[];
}>;

type PrivacyAcceptedContract = Readonly<{
  schema: string;
  versions: readonly number[];
  mode: string;
  discriminator: SchemaLifecycleConsumerDiscriminator | null;
}>;

type PrivacyEmittedContract = Readonly<{
  schema: string;
  version: number;
  discriminator: SchemaLifecycleVariantDiscriminator | null;
}>;

type PrivacySchemaConsumerFlow = Readonly<{
  id: string;
  familyId: string;
  plane: string;
  operation: string;
  acceptedContracts: readonly PrivacyAcceptedContract[];
  emittedContract: PrivacyEmittedContract | null;
  privacyProfileId: string;
  requestMode: string;
  retentionEffect: string;
  processingClasses: readonly PrivacyProcessingClassId[];
  policyState: string;
}>;

type PrivacyCatalogueCoverage = Readonly<{
  capabilityManifest: Readonly<{
    schema: string;
    version: number;
    capabilityCount: number;
    cliOperationCount: number;
    cliVariantCount: number;
  }>;
  cliCommandCatalogue: Readonly<{
    schema: string;
    version: number;
  }>;
  schemaLifecycleRegistry: Readonly<{
    familyCount: number;
    compatibilityCount: number;
    privacyProfileCount: number;
    consumerFlowCount: number;
    metadataVersions: readonly number[];
  }>;
  outsideLifecycleRegistry: Readonly<{
    classification: 'not_applicable';
    reason: string;
  }>;
}>;

export type PrivacyDataFlowCatalogue = Readonly<{
  schema: typeof PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA;
  version: typeof PRIVACY_DATA_FLOW_CATALOGUE_VERSION;
  coverage: PrivacyCatalogueCoverage;
  processingClasses: typeof PRIVACY_PROCESSING_CLASSES;
  invariants: readonly string[];
  capabilityFlows: readonly PrivacyCapabilityFlow[];
  cliOperationFlows: readonly PrivacyCliOperationFlow[];
  schemaFamilies: readonly PrivacySchemaFamily[];
  schemaContracts: readonly PrivacySchemaContract[];
  schemaPrivacyProfiles: readonly PrivacySchemaProfile[];
  schemaConsumerFlows: readonly PrivacySchemaConsumerFlow[];
}>;

export type PrivacyDataFlowCatalogueBuildInput = Readonly<{
  capabilityManifest: CapabilityManifest;
  cliCommandCatalogue: Readonly<{
    schema: string;
    version: number;
    commands: readonly CliPrivacySource[];
  }>;
  schemaLifecycleRegistry: SchemaLifecycleRegistry;
}>;

const GLOBAL_NON_INFERENCE = PRIVACY_CATALOGUE_INVARIANTS[3];

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function retentionProjection(mode: CapabilityDefinition['retention']): PrivacyRetentionProjection {
  const projections: Readonly<Record<CapabilityDefinition['retention'], PrivacyRetentionProjection>> = {
    transient: { mode, storageClass: 'transient_process_memory', durationControl: 'bounded_operation_or_cache_lifetime' },
    browser_deliberate: { mode, storageClass: 'browser_profile_storage', durationControl: 'until_user_deletes_or_browser_site_data_is_cleared' },
    local_output_deliberate: { mode, storageClass: 'operator_controlled_local_output', durationControl: 'no_automatic_retention_beyond_process_unless_operator_saves_output' },
    worker_compact_encrypted: { mode, storageClass: 'configured_worker_encrypted_store', durationControl: 'operator_configured_retention_and_deletion' },
    control_only: { mode, storageClass: 'configured_control_metadata_store', durationControl: 'configured_provider_control_window' },
  };
  return projections[mode];
}

function exportProjection(mode: CapabilityDefinition['export']): PrivacyExportProjection {
  const classes: Readonly<Record<CapabilityDefinition['export'], readonly string[]>> = {
    none: ['none'],
    deliberate_bounded: ['bounded_user_initiated_export'],
    metadata_only: ['metadata_only_stdout_or_operator_selected_file'],
    local_output: ['operator_selected_local_output'],
  };
  return { mode, classes: classes[mode] };
}

function credentialUse(model: CapabilityDefinition['credentialModel']): string {
  const descriptions: Readonly<Record<CapabilityDefinition['credentialModel'], string>> = {
    none: 'No operation credential is required.',
    deployment_optional: 'A configured deployment credential can authenticate the selected provider request; its value is never catalogued or returned.',
    variant_specific: 'Credential use is stated by the selected conditional variant.',
    required_public_trust_file: 'A selected local public trust file is read for validation and is not transmitted.',
    optional_secret_passphrase_file: 'A selected local passphrase file is read only for the requested local operation and is not emitted.',
    required_secret_private_key_file: 'A selected local private key is used locally and is not transmitted, retained or emitted.',
    optional_public_key_file: 'A selected local public key can be used for verification and is not transmitted.',
    worker_encryption_key: 'A configured worker key encrypts compact worker state and is never included in retained records or catalogue output.',
  };
  return descriptions[model];
}

function processingClassesForBoundary(boundary: Readonly<{
  planes: readonly string[];
  networkMode: string;
  recipients: readonly string[];
  retention: string;
  export: string;
}>): readonly PrivacyProcessingClassId[] {
  const classes: PrivacyProcessingClassId[] = ['transient_processing'];
  if (boundary.retention === 'browser_deliberate') {
    classes.push('browser_local_retention');
  }
  if (boundary.export === 'deliberate_bounded'
    || boundary.export === 'local_output'
    || boundary.retention === 'local_output_deliberate') {
    classes.push('deliberate_local_file_export');
  }
  if (boundary.planes.includes('hosted_bounded_passive')) classes.push('hosted_bounded_processing');
  if (boundary.planes.includes('optional_worker') || boundary.retention === 'worker_compact_encrypted') {
    classes.push('configured_worker_storage');
  }
  if (boundary.networkMode !== 'none' && boundary.recipients.some((value) => value !== 'none')) {
    classes.push('third_party_disclosure');
  }
  if (boundary.networkMode === 'none'
    || (boundary.networkMode === 'conditional_bounded_passive'
      && boundary.planes.some((value) => value === 'local_cli_offline'))) {
    classes.push('offline_processing_no_request');
  }
  return unique(classes) as readonly PrivacyProcessingClassId[];
}

function deliberatelyNotSent(boundary: Readonly<{
  networkMode: string;
  credentialModel: string;
}>): readonly string[] {
  if (boundary.networkMode === 'none') {
    return Object.freeze([
      'no_network_request',
      'no_third_party_disclosure',
      'credentials',
      'cookies_and_session_data',
      'local_paths',
    ]);
  }
  return Object.freeze([
    'browser_local_records',
    'unselected_local_files',
    'cookies_and_session_data',
    'unrelated_evidence_values',
    'complete_query_bearing_urls',
    ...(boundary.credentialModel === 'deployment_optional' ? [] : ['credentials']),
  ]);
}

function responseCategories(
  responseBudget: CliOperationDefinition['responseBudget'] | CliExecutionVariant['responseBudget'],
  capabilityFamilyId: CapabilityId,
): readonly string[] {
  if (responseBudget === 'collector_specific') {
    return CAPABILITY_PRIVACY_DETAILS[capabilityFamilyId].returnedDataCategories;
  }
  const categories = {
    none: ['no_returned_data'],
    bounded_runtime_report: ['bounded_runtime_metadata'],
    bounded_local_input: ['bounded_local_derivation'],
    bounded_portable_document: ['bounded_portable_document', 'integrity_or_compatibility_state'],
    bounded_rendered_capture: ['bounded_rendered_capture'],
    bounded_compact_state: ['bounded_compact_state'],
  } as const;
  return categories[responseBudget];
}

function normalisedOutcomeProjection(outcomes: readonly string[]): PrivacyNormalisedOutcomeProjection {
  return Object.freeze(Object.fromEntries(NORMALISED_OUTCOME_STATES.map((state) => [
    state,
    outcomes.includes(state) ? 'explicit_outcome' : 'not_declared_for_boundary',
  ]))) as PrivacyNormalisedOutcomeProjection;
}

function boundaryFields(
  boundary: CapabilityDefinition | CliOperationDefinition | CliExecutionVariant,
  returnedDataCategories: readonly string[],
  privacyLimitations: readonly string[],
): PrivacyBoundaryFields {
  return {
    executionPlanes: boundary.planes,
    trigger: boundary.trigger,
    networkMode: boundary.networkMode,
    authorisation: boundary.authorisation,
    dataSent: boundary.disclosedData,
    dataDeliberatelyNotSent: deliberatelyNotSent(boundary),
    recipientClasses: boundary.recipients,
    returnedDataCategories,
    processingClasses: processingClassesForBoundary(boundary),
    requestBudget: boundary.requestBudget,
    responseBudget: boundary.responseBudget,
    concurrency: boundary.concurrency,
    retention: retentionProjection(boundary.retention),
    exports: exportProjection(boundary.export),
    credentialModel: boundary.credentialModel,
    credentialUse: credentialUse(boundary.credentialModel),
    cancellation: boundary.cancellation,
    partialResults: boundary.partialResults,
    outcomes: boundary.outcomes,
    normalisedOutcomes: normalisedOutcomeProjection(boundary.outcomes),
    documentStates: boundary.documentStates ?? [],
    scoringEffect: boundary.scoringEffect,
    nonInferences: unique([GLOBAL_NON_INFERENCE, ...privacyLimitations]),
  };
}

function schemaStorage(kind: string): Readonly<{ storageClass: string; retentionControl: string }> {
  const values: Readonly<Record<string, Readonly<{ storageClass: string; retentionControl: string }>>> = {
    browser_store: { storageClass: 'browser_profile_storage', retentionControl: 'browser_profile_and_user_controlled' },
    tab_store: { storageClass: 'browser_tab_storage', retentionControl: 'tab_lifetime_or_one_use_consumption' },
    hosted_store: { storageClass: 'configured_worker_storage', retentionControl: 'operator_configured_store_or_queue_policy' },
    export: { storageClass: 'deliberate_local_file', retentionControl: 'operator_controlled_after_export' },
    cli_document: { storageClass: 'operator_controlled_output', retentionControl: 'transient_stdout_unless_operator_redirects_or_selects_output' },
    derived: { storageClass: 'transient_process_memory', retentionControl: 'discardable_after_current_operation' },
  };
  const value = values[kind];
  if (!value) throw new TypeError(`Unsupported schema lifecycle contract kind: ${kind}.`);
  return value;
}

function schemaProcessingClasses(
  requestMode: string,
  retentionEffect: string,
): readonly PrivacyProcessingClassId[] {
  const classes: PrivacyProcessingClassId[] = ['transient_processing'];
  if (retentionEffect === 'browser_indexeddb') classes.push('browser_local_retention');
  if (retentionEffect === 'deliberate_local_file' || retentionEffect === 'operator_controlled_output') {
    classes.push('deliberate_local_file_export');
  }
  if (requestMode !== 'none') classes.push('third_party_disclosure');
  if (requestMode === 'none') classes.push('offline_processing_no_request');
  return unique(classes) as readonly PrivacyProcessingClassId[];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function buildUncheckedPrivacyDataFlowCatalogue(
  input: PrivacyDataFlowCatalogueBuildInput,
): PrivacyDataFlowCatalogue {
  const manifest = input.capabilityManifest;
  if (manifest.schema !== CAPABILITY_MANIFEST_SCHEMA || manifest.version !== CAPABILITY_MANIFEST_VERSION) {
    throw new TypeError('Privacy catalogue requires the exact current capability manifest version.');
  }
  if (manifest.capabilities.length < 1 || manifest.capabilities.length > MAX_PRIVACY_CAPABILITIES
    || manifest.cliOperations.length < 1 || manifest.cliOperations.length > MAX_PRIVACY_CLI_OPERATIONS) {
    throw new TypeError('Privacy catalogue capability inputs exceed their declared bounds.');
  }
  const capabilityIds = new Set(manifest.capabilities.map((item) => item.id));
  if (capabilityIds.size !== manifest.capabilities.length) {
    throw new TypeError('Privacy catalogue capability identifiers must be unique.');
  }
  const privacyDetailIds = Object.keys(CAPABILITY_PRIVACY_DETAILS);
  if (privacyDetailIds.length !== capabilityIds.size
    || privacyDetailIds.some((id) => !capabilityIds.has(id as CapabilityId))) {
    throw new TypeError('Privacy catalogue capability-purpose metadata must cover the manifest exactly once.');
  }

  const cliSources = input.cliCommandCatalogue.commands;
  if (input.cliCommandCatalogue.schema !== PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_SCHEMA
    || input.cliCommandCatalogue.version !== PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_VERSION) {
    throw new TypeError('Privacy catalogue requires the exact current CLI command catalogue version.');
  }
  if (cliSources.length !== manifest.cliOperations.length || cliSources.length > MAX_PRIVACY_CLI_OPERATIONS) {
    throw new TypeError('Privacy catalogue CLI sources must cover the capability manifest exactly once.');
  }
  const cliSourceById = new Map(cliSources.map((item) => [item.recordId, item]));
  if (cliSourceById.size !== cliSources.length) {
    throw new TypeError('Privacy catalogue CLI source identifiers must be unique.');
  }

  const capabilityFlows = manifest.capabilities.map((capability): PrivacyCapabilityFlow => {
    const detail = CAPABILITY_PRIVACY_DETAILS[capability.id];
    return {
      id: capability.id,
      title: capability.title,
      requestPurpose: detail.requestPurpose,
      job: capability.job,
      ...boundaryFields(capability, detail.returnedDataCategories, capability.privacyLimitations),
    };
  });

  let cliVariantCount = 0;
  const cliOperationFlows = manifest.cliOperations.map((operation): PrivacyCliOperationFlow => {
    const source = cliSourceById.get(operation.recordId);
    if (!source
      || source.command !== operation.command
      || source.collectionMode !== operation.collectionMode
      || !['offline', 'always_network', 'conditional_network'].includes(source.networkEffect)
      || (source.networkEffect === 'offline') !== (operation.networkMode === 'none')
      || (source.networkEffect === 'conditional_network') !== (operation.networkMode === 'conditional_bounded_passive')) {
      throw new TypeError(`Privacy catalogue CLI source does not match ${operation.recordId}.`);
    }
    const variants = (operation.variants ?? []).map((variant): PrivacyCliVariantFlow => ({
      id: `${operation.recordId}.${variant.id}`,
      operationId: operation.recordId,
      variantId: variant.id,
      title: `${source.title} — ${variant.id.replaceAll('_', ' ')}`,
      requestPurpose: `${source.requestPurpose} Variant: ${variant.id.replaceAll('_', ' ')}.`,
      ...boundaryFields(
        variant,
        responseCategories(variant.responseBudget, operation.capabilityFamilyId),
        operation.privacyLimitations,
      ),
    }));
    cliVariantCount += variants.length;
    if (cliVariantCount > MAX_PRIVACY_CLI_VARIANTS) {
      throw new TypeError('Privacy catalogue CLI variants exceed their declared bound.');
    }
    return {
      id: operation.recordId,
      command: operation.command,
      capabilityFamilyId: operation.capabilityFamilyId,
      title: source.title,
      requestPurpose: source.requestPurpose,
      collectionMode: operation.collectionMode,
      ...boundaryFields(
        operation,
        responseCategories(operation.responseBudget, operation.capabilityFamilyId),
        unique([source.privacyBoundary, ...operation.privacyLimitations]),
      ),
      variants,
    };
  });

  const registry = input.schemaLifecycleRegistry;
  if (registry.length < 1 || registry.length > MAX_PRIVACY_SCHEMA_FAMILIES) {
    throw new TypeError('Privacy catalogue schema families exceed their declared bound.');
  }
  const schemaFamilies: PrivacySchemaFamily[] = [];
  const schemaContracts: PrivacySchemaContract[] = [];
  const schemaPrivacyProfiles: PrivacySchemaProfile[] = [];
  const schemaConsumerFlows: PrivacySchemaConsumerFlow[] = [];
  const metadataVersions = new Set<number>();
  for (const family of registry) {
    if (!('metadata' in family)) {
      throw new TypeError(`Privacy catalogue cannot project lifecycle family ${family.id} without canonical privacy metadata.`);
    }
    const metadata = family.metadata;
    metadataVersions.add(metadata.metadataVersion);
    if (schemaContracts.length + family.compatibility.length > MAX_PRIVACY_SCHEMA_CONTRACTS
      || schemaPrivacyProfiles.length + metadata.privacyProfiles.length > MAX_PRIVACY_SCHEMA_PROFILES
      || schemaConsumerFlows.length + metadata.consumerEdges.length > MAX_PRIVACY_SCHEMA_CONSUMER_FLOWS) {
      throw new TypeError('Privacy catalogue schema metadata exceeds its declared bounds.');
    }
    schemaFamilies.push({
      id: family.id,
      privacyClass: family.privacy,
      compatibilityIds: family.compatibility.map((item) => item.id),
      privacyProfileIds: metadata.privacyProfiles.map((item) => item.id),
      consumerFlowIds: metadata.consumerEdges.map((item) => item.id),
    });
    for (const descriptor of family.compatibility) {
      const current = family.contracts.filter((contract) => (
        contract.compatibilityId === descriptor.id && contract.lifecycle === 'current'
      ));
      if (current.length !== 1) {
        throw new TypeError(`Privacy catalogue schema contract ${descriptor.id} must have one current lifecycle contract.`);
      }
      const storage = schemaStorage(descriptor.kind);
      schemaContracts.push({
        id: descriptor.id,
        familyId: family.id,
        kind: descriptor.kind,
        schema: descriptor.schema,
        lifecycleSchema: current[0]!.schema,
        coverageClass: descriptor.schema === null ? 'registered_non_schema_identity' : 'registered_schema',
        currentVersion: descriptor.currentVersion,
        supportedVersions: descriptor.supportedVersions,
        futureVersionBehavior: descriptor.futureVersionBehavior,
        migration: descriptor.migration,
        writeSemantics: descriptor.writeSemantics,
        byteBudget: descriptor.byteBudget,
        ...storage,
      });
    }
    for (const profile of metadata.privacyProfiles) {
      const consumerFlowIds = metadata.consumerEdges
        .filter((edge) => edge.privacyProfileId === profile.id)
        .map((edge) => edge.id);
      if (consumerFlowIds.length === 0) {
        throw new TypeError(`Privacy catalogue profile ${profile.id} is orphaned.`);
      }
      schemaPrivacyProfiles.push({
        id: profile.id,
        familyId: family.id,
        classification: profile.classification,
        projection: profile.projection,
        includedCategories: profile.includedCategories,
        excludedCategories: profile.excludedCategories,
        notePolicy: profile.notePolicy,
        retention: profile.retention,
        network: profile.network,
        sharingReview: profile.sharingReview,
        consumerFlowIds,
      });
    }
    for (const edge of metadata.consumerEdges) {
      schemaConsumerFlows.push({
        id: edge.id,
        familyId: family.id,
        plane: edge.plane,
        operation: edge.operation,
        acceptedContracts: edge.acceptedContracts.map((contract) => ({
          schema: contract.schema,
          versions: contract.versions,
          mode: contract.mode,
          discriminator: contract.discriminator ?? null,
        })),
        emittedContract: edge.emittedContract
          ? { ...edge.emittedContract, discriminator: edge.emittedContract.discriminator ?? null }
          : null,
        privacyProfileId: edge.privacyProfileId,
        requestMode: edge.requestMode,
        retentionEffect: edge.retentionEffect,
        processingClasses: schemaProcessingClasses(edge.requestMode, edge.retentionEffect),
        policyState: edge.policyState,
      });
    }
  }

  return {
    schema: PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
    version: PRIVACY_DATA_FLOW_CATALOGUE_VERSION,
    coverage: {
      capabilityManifest: {
        schema: CAPABILITY_MANIFEST_SCHEMA,
        version: manifest.version,
        capabilityCount: capabilityFlows.length,
        cliOperationCount: cliOperationFlows.length,
        cliVariantCount,
      },
      cliCommandCatalogue: {
        schema: CLI_COMMAND_CATALOGUE_SCHEMA,
        version: input.cliCommandCatalogue.version,
      },
      schemaLifecycleRegistry: {
        familyCount: schemaFamilies.length,
        compatibilityCount: schemaContracts.length,
        privacyProfileCount: schemaPrivacyProfiles.length,
        consumerFlowCount: schemaConsumerFlows.length,
        metadataVersions: [...metadataVersions].sort((left, right) => left - right),
      },
      outsideLifecycleRegistry: {
        classification: 'not_applicable',
        reason: 'Schema-like inventory entries outside the canonical lifecycle registry are not assigned fabricated privacy semantics by this catalogue.',
      },
    },
    processingClasses: PRIVACY_PROCESSING_CLASSES,
    invariants: PRIVACY_CATALOGUE_INVARIANTS,
    capabilityFlows,
    cliOperationFlows,
    schemaFamilies,
    schemaContracts,
    schemaPrivacyProfiles,
    schemaConsumerFlows,
  };
}

function denseArray(value: unknown, label: string, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a bounded ordinary array.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) {
    throw new TypeError(`${label} exceeds its count bound.`);
  }
  const expectedKeys = new Set<PropertyKey>([
    'length',
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.size || ownKeys.some((key) => !expectedKeys.has(key))) {
    throw new TypeError(`${label} must be dense and have no custom keys.`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must contain ordinary data entries.`);
    }
    output.push(descriptor.value);
  }
  return output;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be an ordinary exact record.`);
  }
  const expected = new Set(keys);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expected.size
    || ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))) {
    throw new TypeError(`${label} must use exact keys.`);
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must use ordinary enumerable data properties.`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function textValue(value: unknown, label: string, maximum = MAX_PRIVACY_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded text.`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  const result = textValue(value, label, MAX_PRIVACY_IDENTIFIER_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(result)) {
    throw new TypeError(`${label} must be a stable identifier.`);
  }
  return result;
}

function positiveInteger(value: unknown, label: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) {
    throw new TypeError(`${label} must be a bounded integer.`);
  }
  return Number(value);
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  return value === null ? null : positiveInteger(value, label);
}

function strings(
  value: unknown,
  label: string,
  maximum = MAX_PRIVACY_LIST_ENTRIES,
  identifiersOnly = true,
): readonly string[] {
  const output = denseArray(value, label, maximum).map((item, index) => (
    identifiersOnly ? identifier(item, `${label} item ${index + 1}`) : textValue(item, `${label} item ${index + 1}`)
  ));
  if (new Set(output).size !== output.length) throw new TypeError(`${label} must not contain duplicates.`);
  return Object.freeze(output);
}

function numbers(value: unknown, label: string): readonly number[] {
  const output = denseArray(value, label, MAX_PRIVACY_LIST_ENTRIES, 1)
    .map((item, index) => positiveInteger(item, `${label} item ${index + 1}`));
  if (new Set(output).size !== output.length
    || output.some((item, index) => index > 0 && item <= output[index - 1]!)) {
    throw new TypeError(`${label} must be unique and increasing.`);
  }
  return Object.freeze(output);
}

const BOUNDARY_KEYS = Object.freeze([
  'executionPlanes', 'trigger', 'networkMode', 'authorisation', 'dataSent',
  'dataDeliberatelyNotSent', 'recipientClasses', 'returnedDataCategories',
  'processingClasses', 'requestBudget', 'responseBudget', 'concurrency', 'retention',
  'exports', 'credentialModel', 'credentialUse', 'cancellation', 'partialResults',
  'outcomes', 'normalisedOutcomes', 'documentStates', 'scoringEffect', 'nonInferences',
] as const);

function copyNormalisedOutcomes(value: unknown, label: string): PrivacyNormalisedOutcomeProjection {
  const source = exactRecord(value, NORMALISED_OUTCOME_STATES, label);
  return Object.freeze(Object.fromEntries(NORMALISED_OUTCOME_STATES.map((state) => {
    const disposition = source[state];
    if (disposition !== 'explicit_outcome' && disposition !== 'not_declared_for_boundary') {
      throw new TypeError(`${label} ${state} disposition is invalid.`);
    }
    return [state, disposition];
  }))) as PrivacyNormalisedOutcomeProjection;
}

function copyRetention(value: unknown, label: string): PrivacyRetentionProjection {
  const source = exactRecord(value, ['mode', 'storageClass', 'durationControl'], label);
  return Object.freeze({
    mode: identifier(source.mode, `${label} mode`),
    storageClass: identifier(source.storageClass, `${label} storage class`),
    durationControl: identifier(source.durationControl, `${label} duration control`),
  });
}

function copyExport(value: unknown, label: string): PrivacyExportProjection {
  const source = exactRecord(value, ['mode', 'classes'], label);
  return Object.freeze({
    mode: identifier(source.mode, `${label} mode`),
    classes: strings(source.classes, `${label} classes`),
  });
}

function copyBoundary(source: Readonly<Record<string, unknown>>, label: string): PrivacyBoundaryFields {
  const processingClasses = strings(source.processingClasses, `${label} processing classes`) as readonly PrivacyProcessingClassId[];
  if (processingClasses.some((id) => !PRIVACY_PROCESSING_CLASSES.some((item) => item.id === id))) {
    throw new TypeError(`${label} references an unknown processing class.`);
  }
  return {
    executionPlanes: strings(source.executionPlanes, `${label} execution planes`),
    trigger: identifier(source.trigger, `${label} trigger`),
    networkMode: identifier(source.networkMode, `${label} network mode`),
    authorisation: identifier(source.authorisation, `${label} authorisation`),
    dataSent: strings(source.dataSent, `${label} data sent`),
    dataDeliberatelyNotSent: strings(source.dataDeliberatelyNotSent, `${label} data deliberately not sent`),
    recipientClasses: strings(source.recipientClasses, `${label} recipient classes`),
    returnedDataCategories: strings(source.returnedDataCategories, `${label} returned data categories`),
    processingClasses,
    requestBudget: identifier(source.requestBudget, `${label} request budget`),
    responseBudget: identifier(source.responseBudget, `${label} response budget`),
    concurrency: identifier(source.concurrency, `${label} concurrency`),
    retention: copyRetention(source.retention, `${label} retention`),
    exports: copyExport(source.exports, `${label} exports`),
    credentialModel: identifier(source.credentialModel, `${label} credential model`),
    credentialUse: textValue(source.credentialUse, `${label} credential use`),
    cancellation: identifier(source.cancellation, `${label} cancellation`),
    partialResults: identifier(source.partialResults, `${label} partial results`),
    outcomes: strings(source.outcomes, `${label} outcomes`),
    normalisedOutcomes: copyNormalisedOutcomes(source.normalisedOutcomes, `${label} normalised outcomes`),
    documentStates: strings(source.documentStates, `${label} document states`),
    scoringEffect: identifier(source.scoringEffect, `${label} scoring effect`),
    nonInferences: strings(source.nonInferences, `${label} non-inferences`, MAX_PRIVACY_LIST_ENTRIES, false),
  };
}

function copyCapabilityFlow(value: unknown, index: number): PrivacyCapabilityFlow {
  const label = `Privacy capability flow ${index + 1}`;
  const source = exactRecord(value, ['id', 'title', 'requestPurpose', 'job', ...BOUNDARY_KEYS], label);
  return Object.freeze({
    id: identifier(source.id, `${label} id`),
    title: textValue(source.title, `${label} title`),
    requestPurpose: textValue(source.requestPurpose, `${label} purpose`),
    job: identifier(source.job, `${label} job`),
    ...copyBoundary(source, label),
  });
}

function copyCliVariantFlow(value: unknown, index: number, operationLabel: string): PrivacyCliVariantFlow {
  const label = `${operationLabel} variant ${index + 1}`;
  const source = exactRecord(value, ['id', 'operationId', 'variantId', 'title', 'requestPurpose', ...BOUNDARY_KEYS], label);
  return Object.freeze({
    id: identifier(source.id, `${label} id`),
    operationId: identifier(source.operationId, `${label} operation id`),
    variantId: identifier(source.variantId, `${label} variant id`),
    title: textValue(source.title, `${label} title`),
    requestPurpose: textValue(source.requestPurpose, `${label} purpose`),
    ...copyBoundary(source, label),
  });
}

function copyCliOperationFlow(value: unknown, index: number): PrivacyCliOperationFlow {
  const label = `Privacy CLI operation flow ${index + 1}`;
  const source = exactRecord(value, [
    'id', 'command', 'capabilityFamilyId', 'title', 'requestPurpose', 'collectionMode',
    ...BOUNDARY_KEYS, 'variants',
  ], label);
  const collectionMode = source.collectionMode;
  if (collectionMode !== 'offline' && collectionMode !== 'network') {
    throw new TypeError(`${label} collection mode is invalid.`);
  }
  return Object.freeze({
    id: identifier(source.id, `${label} id`),
    command: identifier(source.command, `${label} command`),
    capabilityFamilyId: identifier(source.capabilityFamilyId, `${label} capability family`),
    title: textValue(source.title, `${label} title`),
    requestPurpose: textValue(source.requestPurpose, `${label} purpose`),
    collectionMode,
    ...copyBoundary(source, label),
    variants: Object.freeze(denseArray(source.variants, `${label} variants`, MAX_PRIVACY_CLI_VARIANTS)
      .map((variant, variantIndex) => copyCliVariantFlow(variant, variantIndex, label))
      .sort((left, right) => compareCodeUnits(left.id, right.id))),
  });
}

function copySchemaFamily(value: unknown, index: number): PrivacySchemaFamily {
  const label = `Privacy schema family ${index + 1}`;
  const source = exactRecord(value, ['id', 'privacyClass', 'compatibilityIds', 'privacyProfileIds', 'consumerFlowIds'], label);
  return Object.freeze({
    id: identifier(source.id, `${label} id`),
    privacyClass: identifier(source.privacyClass, `${label} privacy class`),
    compatibilityIds: Object.freeze([...strings(source.compatibilityIds, `${label} compatibility ids`, MAX_PRIVACY_SCHEMA_CONTRACTS)].sort(compareCodeUnits)),
    privacyProfileIds: Object.freeze([...strings(source.privacyProfileIds, `${label} privacy profile ids`, MAX_PRIVACY_SCHEMA_PROFILES)].sort(compareCodeUnits)),
    consumerFlowIds: Object.freeze([...strings(source.consumerFlowIds, `${label} consumer flow ids`, MAX_PRIVACY_SCHEMA_CONSUMER_FLOWS)].sort(compareCodeUnits)),
  });
}

function copySchemaContract(value: unknown, index: number): PrivacySchemaContract {
  const label = `Privacy schema contract ${index + 1}`;
  const source = exactRecord(value, [
    'id', 'familyId', 'kind', 'schema', 'lifecycleSchema', 'coverageClass', 'currentVersion',
    'supportedVersions', 'futureVersionBehavior', 'migration', 'writeSemantics', 'byteBudget',
    'storageClass', 'retentionControl',
  ], label);
  if (source.schema !== null && typeof source.schema !== 'string') throw new TypeError(`${label} schema is invalid.`);
  const coverageClass = source.coverageClass;
  if (coverageClass !== 'registered_schema' && coverageClass !== 'registered_non_schema_identity') {
    throw new TypeError(`${label} coverage class is invalid.`);
  }
  if ((source.schema === null) !== (coverageClass === 'registered_non_schema_identity')) {
    throw new TypeError(`${label} schema and coverage class are inconsistent.`);
  }
  return Object.freeze({
    id: identifier(source.id, `${label} id`),
    familyId: identifier(source.familyId, `${label} family id`),
    kind: identifier(source.kind, `${label} kind`),
    schema: source.schema === null ? null : identifier(source.schema, `${label} schema`),
    lifecycleSchema: identifier(source.lifecycleSchema, `${label} lifecycle schema`),
    coverageClass,
    currentVersion: positiveInteger(source.currentVersion, `${label} current version`),
    supportedVersions: numbers(source.supportedVersions, `${label} supported versions`),
    futureVersionBehavior: identifier(source.futureVersionBehavior, `${label} future-version behaviour`),
    migration: identifier(source.migration, `${label} migration`),
    writeSemantics: identifier(source.writeSemantics, `${label} write semantics`),
    byteBudget: nullablePositiveInteger(source.byteBudget, `${label} byte budget`),
    storageClass: identifier(source.storageClass, `${label} storage class`),
    retentionControl: identifier(source.retentionControl, `${label} retention control`),
  });
}

function copySchemaProfile(value: unknown, index: number): PrivacySchemaProfile {
  const label = `Privacy schema profile ${index + 1}`;
  const source = exactRecord(value, [
    'id', 'familyId', 'classification', 'projection', 'includedCategories', 'excludedCategories',
    'notePolicy', 'retention', 'network', 'sharingReview', 'consumerFlowIds',
  ], label);
  return Object.freeze({
    id: identifier(source.id, `${label} id`),
    familyId: identifier(source.familyId, `${label} family id`),
    classification: identifier(source.classification, `${label} classification`),
    projection: identifier(source.projection, `${label} projection`),
    includedCategories: strings(source.includedCategories, `${label} included categories`),
    excludedCategories: strings(source.excludedCategories, `${label} excluded categories`),
    notePolicy: identifier(source.notePolicy, `${label} note policy`),
    retention: identifier(source.retention, `${label} retention`),
    network: identifier(source.network, `${label} network`),
    sharingReview: identifier(source.sharingReview, `${label} sharing review`),
    consumerFlowIds: Object.freeze([...strings(source.consumerFlowIds, `${label} consumer flow ids`, MAX_PRIVACY_SCHEMA_CONSUMER_FLOWS)].sort(compareCodeUnits)),
  });
}

function copyConsumerDiscriminator(value: unknown, label: string): SchemaLifecycleConsumerDiscriminator | null {
  if (value === null) return null;
  const source = exactRecord(value, ['path', 'values'], label);
  return Object.freeze({
    path: textValue(source.path, `${label} path`, MAX_PRIVACY_IDENTIFIER_LENGTH),
    values: strings(source.values, `${label} values`),
  });
}

function copyVariantDiscriminator(value: unknown, label: string): SchemaLifecycleVariantDiscriminator | null {
  if (value === null) return null;
  const source = exactRecord(value, ['path', 'value'], label);
  return Object.freeze({
    path: textValue(source.path, `${label} path`, MAX_PRIVACY_IDENTIFIER_LENGTH),
    value: identifier(source.value, `${label} value`),
  });
}

function copyAcceptedContract(value: unknown, index: number, flowLabel: string): PrivacyAcceptedContract {
  const label = `${flowLabel} accepted contract ${index + 1}`;
  const source = exactRecord(value, ['schema', 'versions', 'mode', 'discriminator'], label);
  return Object.freeze({
    schema: identifier(source.schema, `${label} schema`),
    versions: numbers(source.versions, `${label} versions`),
    mode: identifier(source.mode, `${label} mode`),
    discriminator: copyConsumerDiscriminator(source.discriminator, `${label} discriminator`),
  });
}

function copyEmittedContract(value: unknown, label: string): PrivacyEmittedContract | null {
  if (value === null) return null;
  const source = exactRecord(value, ['schema', 'version', 'discriminator'], label);
  return Object.freeze({
    schema: identifier(source.schema, `${label} schema`),
    version: positiveInteger(source.version, `${label} version`),
    discriminator: copyVariantDiscriminator(source.discriminator, `${label} discriminator`),
  });
}

function copySchemaConsumerFlow(value: unknown, index: number): PrivacySchemaConsumerFlow {
  const label = `Privacy schema consumer flow ${index + 1}`;
  const source = exactRecord(value, [
    'id', 'familyId', 'plane', 'operation', 'acceptedContracts', 'emittedContract',
    'privacyProfileId', 'requestMode', 'retentionEffect', 'processingClasses', 'policyState',
  ], label);
  const processingClasses = strings(source.processingClasses, `${label} processing classes`) as readonly PrivacyProcessingClassId[];
  if (processingClasses.some((id) => !PRIVACY_PROCESSING_CLASSES.some((item) => item.id === id))) {
    throw new TypeError(`${label} references an unknown processing class.`);
  }
  return Object.freeze({
    id: identifier(source.id, `${label} id`),
    familyId: identifier(source.familyId, `${label} family id`),
    plane: identifier(source.plane, `${label} plane`),
    operation: identifier(source.operation, `${label} operation`),
    acceptedContracts: Object.freeze(denseArray(source.acceptedContracts, `${label} accepted contracts`, MAX_PRIVACY_LIST_ENTRIES)
      .map((contract, contractIndex) => copyAcceptedContract(contract, contractIndex, label))),
    emittedContract: copyEmittedContract(source.emittedContract, `${label} emitted contract`),
    privacyProfileId: identifier(source.privacyProfileId, `${label} privacy profile id`),
    requestMode: identifier(source.requestMode, `${label} request mode`),
    retentionEffect: identifier(source.retentionEffect, `${label} retention effect`),
    processingClasses,
    policyState: identifier(source.policyState, `${label} policy state`),
  });
}

function copyCoverage(value: unknown): PrivacyCatalogueCoverage {
  const source = exactRecord(value, [
    'capabilityManifest', 'cliCommandCatalogue', 'schemaLifecycleRegistry', 'outsideLifecycleRegistry',
  ], 'Privacy catalogue coverage');
  const manifest = exactRecord(source.capabilityManifest, [
    'schema', 'version', 'capabilityCount', 'cliOperationCount', 'cliVariantCount',
  ], 'Privacy catalogue capability coverage');
  const cli = exactRecord(source.cliCommandCatalogue, ['schema', 'version'], 'Privacy catalogue CLI coverage');
  const lifecycle = exactRecord(source.schemaLifecycleRegistry, [
    'familyCount', 'compatibilityCount', 'privacyProfileCount', 'consumerFlowCount', 'metadataVersions',
  ], 'Privacy catalogue lifecycle coverage');
  const outside = exactRecord(source.outsideLifecycleRegistry, ['classification', 'reason'], 'Privacy catalogue outside-registry coverage');
  if (outside.classification !== 'not_applicable') {
    throw new TypeError('Privacy catalogue outside-registry coverage must remain explicitly non-applicable.');
  }
  const manifestSchema = identifier(manifest.schema, 'Privacy catalogue capability source schema');
  const cliSchema = identifier(cli.schema, 'Privacy catalogue CLI source schema');
  if (manifestSchema !== CAPABILITY_MANIFEST_SCHEMA || cliSchema !== CLI_COMMAND_CATALOGUE_SCHEMA) {
    throw new TypeError('Privacy catalogue source schema identities are unsupported.');
  }
  return Object.freeze({
    capabilityManifest: Object.freeze({
      schema: CAPABILITY_MANIFEST_SCHEMA,
      version: positiveInteger(manifest.version, 'Privacy catalogue capability source version'),
      capabilityCount: positiveInteger(manifest.capabilityCount, 'Privacy catalogue capability count'),
      cliOperationCount: positiveInteger(manifest.cliOperationCount, 'Privacy catalogue CLI operation count'),
      cliVariantCount: positiveInteger(manifest.cliVariantCount, 'Privacy catalogue CLI variant count', true),
    }),
    cliCommandCatalogue: Object.freeze({
      schema: CLI_COMMAND_CATALOGUE_SCHEMA,
      version: positiveInteger(cli.version, 'Privacy catalogue CLI source version'),
    }),
    schemaLifecycleRegistry: Object.freeze({
      familyCount: positiveInteger(lifecycle.familyCount, 'Privacy catalogue lifecycle family count'),
      compatibilityCount: positiveInteger(lifecycle.compatibilityCount, 'Privacy catalogue lifecycle compatibility count'),
      privacyProfileCount: positiveInteger(lifecycle.privacyProfileCount, 'Privacy catalogue lifecycle privacy profile count'),
      consumerFlowCount: positiveInteger(lifecycle.consumerFlowCount, 'Privacy catalogue lifecycle consumer flow count'),
      metadataVersions: numbers(lifecycle.metadataVersions, 'Privacy catalogue lifecycle metadata versions'),
    }),
    outsideLifecycleRegistry: Object.freeze({
      classification: 'not_applicable',
      reason: textValue(outside.reason, 'Privacy catalogue outside-registry reason'),
    }),
  });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertUniqueIds(values: readonly Readonly<{ id: string }>[], label: string): void {
  if (new Set(values.map((item) => item.id)).size !== values.length) {
    throw new TypeError(`${label} identifiers must be unique.`);
  }
}

function validateCatalogueRelations(catalogue: PrivacyDataFlowCatalogue): void {
  assertUniqueIds(catalogue.capabilityFlows, 'Privacy capability flow');
  assertUniqueIds(catalogue.cliOperationFlows, 'Privacy CLI operation flow');
  assertUniqueIds(catalogue.schemaFamilies, 'Privacy schema family');
  assertUniqueIds(catalogue.schemaContracts, 'Privacy schema contract');
  assertUniqueIds(catalogue.schemaPrivacyProfiles, 'Privacy schema profile');
  assertUniqueIds(catalogue.schemaConsumerFlows, 'Privacy schema consumer flow');
  const allVariants = catalogue.cliOperationFlows.flatMap((operation) => operation.variants);
  assertUniqueIds(allVariants, 'Privacy CLI variant flow');
  const capabilityIds = new Set(catalogue.capabilityFlows.map((item) => item.id));
  const operationIds = new Set(catalogue.cliOperationFlows.map((item) => item.id));
  const familyIds = new Set(catalogue.schemaFamilies.map((item) => item.id));
  const profileIds = new Set(catalogue.schemaPrivacyProfiles.map((item) => item.id));
  const contractPairs = new Set(catalogue.schemaContracts.flatMap((contract) => (
    contract.supportedVersions.map((version) => `${contract.lifecycleSchema}\u0000${version}`)
  )));
  if (catalogue.cliOperationFlows.some((operation) => !capabilityIds.has(operation.capabilityFamilyId)
    || operation.variants.some((variant) => variant.operationId !== operation.id))) {
    throw new TypeError('Privacy catalogue CLI joins are inconsistent.');
  }
  for (const family of catalogue.schemaFamilies) {
    const contractIds = catalogue.schemaContracts.filter((item) => item.familyId === family.id).map((item) => item.id).sort(compareCodeUnits);
    const familyProfileIds = catalogue.schemaPrivacyProfiles.filter((item) => item.familyId === family.id).map((item) => item.id).sort(compareCodeUnits);
    const familyConsumerIds = catalogue.schemaConsumerFlows.filter((item) => item.familyId === family.id).map((item) => item.id).sort(compareCodeUnits);
    if (!sameIds(family.compatibilityIds, contractIds)
      || !sameIds(family.privacyProfileIds, familyProfileIds)
      || !sameIds(family.consumerFlowIds, familyConsumerIds)) {
      throw new TypeError(`Privacy catalogue schema family ${family.id} has an unknown join.`);
    }
  }
  if (catalogue.schemaContracts.some((contract) => !familyIds.has(contract.familyId)
    || !contract.supportedVersions.includes(contract.currentVersion))) {
    throw new TypeError('Privacy catalogue schema contracts have an inconsistent family or version join.');
  }
  for (const profile of catalogue.schemaPrivacyProfiles) {
    const joinedFlowIds = catalogue.schemaConsumerFlows
      .filter((flow) => flow.privacyProfileId === profile.id && flow.familyId === profile.familyId)
      .map((flow) => flow.id)
      .sort(compareCodeUnits);
    if (!familyIds.has(profile.familyId) || joinedFlowIds.length === 0
      || !sameIds(profile.consumerFlowIds, joinedFlowIds)) {
      throw new TypeError(`Privacy catalogue schema profile ${profile.id} has an inconsistent consumer join.`);
    }
  }
  for (const flow of catalogue.schemaConsumerFlows) {
    const profile = catalogue.schemaPrivacyProfiles.find((candidate) => candidate.id === flow.privacyProfileId);
    if (!familyIds.has(flow.familyId) || !profileIds.has(flow.privacyProfileId)
      || profile?.familyId !== flow.familyId
      || flow.acceptedContracts.some((contract) => contract.versions.some((version) => !contractPairs.has(`${contract.schema}\u0000${version}`)))
      || (flow.emittedContract !== null && !contractPairs.has(`${flow.emittedContract.schema}\u0000${flow.emittedContract.version}`))) {
      throw new TypeError(`Privacy catalogue schema consumer ${flow.id} has an unknown join.`);
    }
  }
  const offlineBoundaries = [
    ...catalogue.capabilityFlows,
    ...catalogue.cliOperationFlows,
    ...allVariants,
  ].filter((flow) => flow.networkMode === 'none');
  if (offlineBoundaries.some((flow) => !flow.processingClasses.includes('offline_processing_no_request')
    || flow.processingClasses.includes('third_party_disclosure')
    || flow.recipientClasses.some((recipient) => recipient !== 'none')
    || flow.dataSent.some((category) => category !== 'none'))) {
    throw new TypeError('Privacy catalogue offline flows must remain request-free without inherited disclosure.');
  }
  const allBoundaries = [
    ...catalogue.capabilityFlows,
    ...catalogue.cliOperationFlows,
    ...allVariants,
  ];
  if (allBoundaries.some((flow) => NORMALISED_OUTCOME_STATES.some((state) => (
    flow.normalisedOutcomes[state] !== (flow.outcomes.includes(state)
      ? 'explicit_outcome'
      : 'not_declared_for_boundary')
  )))) {
    throw new TypeError('Privacy catalogue normalised outcome projections are inconsistent.');
  }
  const coverage = catalogue.coverage;
  if (coverage.capabilityManifest.schema !== CAPABILITY_MANIFEST_SCHEMA
    || coverage.capabilityManifest.version !== CAPABILITY_MANIFEST_VERSION
    || coverage.capabilityManifest.capabilityCount !== catalogue.capabilityFlows.length
    || coverage.capabilityManifest.cliOperationCount !== catalogue.cliOperationFlows.length
    || coverage.capabilityManifest.cliVariantCount !== allVariants.length
    || coverage.cliCommandCatalogue.schema !== PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_SCHEMA
    || coverage.cliCommandCatalogue.version !== PRIVACY_DATA_FLOW_CATALOGUE_CLI_SOURCE_VERSION
    || coverage.schemaLifecycleRegistry.familyCount !== catalogue.schemaFamilies.length
    || coverage.schemaLifecycleRegistry.compatibilityCount !== catalogue.schemaContracts.length
    || coverage.schemaLifecycleRegistry.privacyProfileCount !== catalogue.schemaPrivacyProfiles.length
    || coverage.schemaLifecycleRegistry.consumerFlowCount !== catalogue.schemaConsumerFlows.length
    || operationIds.size !== catalogue.cliOperationFlows.length) {
    throw new TypeError('Privacy catalogue coverage counts do not match the projected records.');
  }
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function assertPrecopyBudget(value: unknown): void {
  const pending: Array<Readonly<{ value: unknown; exiting: boolean }>> = [{ value, exiting: false }];
  const active = new WeakSet<object>();
  let estimatedBytes = 0;
  let visitedNodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop()!;
    const current = entry.value;
    if (entry.exiting) {
      active.delete(current as object);
      continue;
    }
    visitedNodes += 1;
    if (visitedNodes > MAX_PRIVACY_PRECOPY_NODES) {
      throw new TypeError('Privacy data-flow catalogue exceeds its pre-copy node budget.');
    }
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      if (typeof current === 'number' && !Number.isFinite(current)) {
        throw new TypeError('Privacy data-flow catalogue contains a non-finite number.');
      }
      estimatedBytes += utf8Length(JSON.stringify(current));
    } else if (typeof current === 'string') {
      estimatedBytes += utf8Length(JSON.stringify(current));
    } else if (typeof current === 'object') {
      if (active.has(current)) throw new TypeError('Privacy data-flow catalogue must not contain cycles.');
      active.add(current);
      pending.push({ value: current, exiting: true });
      const isArray = Array.isArray(current);
      const prototype = Object.getPrototypeOf(current);
      if ((!isArray && prototype !== Object.prototype && prototype !== null)
        || (isArray && prototype !== Array.prototype)) {
        throw new TypeError('Privacy data-flow catalogue must contain only ordinary records and arrays.');
      }
      if (isArray && current.length > MAX_PRIVACY_PRECOPY_NODES) {
        throw new TypeError('Privacy data-flow catalogue exceeds its pre-copy node budget.');
      }
      const ownKeys = Reflect.ownKeys(current);
      if (ownKeys.length > MAX_PRIVACY_PRECOPY_NODES) {
        throw new TypeError('Privacy data-flow catalogue exceeds its pre-copy node budget.');
      }
      estimatedBytes += 2;
      for (const key of ownKeys) {
        if (isArray && key === 'length') continue;
        if (typeof key !== 'string') {
          throw new TypeError('Privacy data-flow catalogue must not contain symbol keys.');
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw new TypeError('Privacy data-flow catalogue must contain ordinary enumerable data properties.');
        }
        estimatedBytes += utf8Length(JSON.stringify(key)) + 2;
        pending.push({ value: descriptor.value, exiting: false });
      }
    } else {
      throw new TypeError('Privacy data-flow catalogue contains an unsupported value.');
    }
    if (estimatedBytes > MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES) {
      throw new TypeError('Privacy data-flow catalogue exceeds its pre-copy byte budget.');
    }
  }
}

export function definePrivacyDataFlowCatalogue(value: unknown): PrivacyDataFlowCatalogue {
  assertPrecopyBudget(value);
  const source = exactRecord(value, [
    'schema', 'version', 'coverage', 'processingClasses', 'invariants', 'capabilityFlows',
    'cliOperationFlows', 'schemaFamilies', 'schemaContracts', 'schemaPrivacyProfiles',
    'schemaConsumerFlows',
  ], 'Privacy data-flow catalogue');
  if (source.schema !== PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA) {
    throw new TypeError('Privacy data-flow catalogue schema is unsupported.');
  }
  if (source.version !== PRIVACY_DATA_FLOW_CATALOGUE_VERSION) {
    throw new TypeError('Privacy data-flow catalogue future or legacy versions are unsupported; exact current version 1 is required.');
  }
  const processingClasses = Object.freeze(denseArray(
    source.processingClasses,
    'Privacy processing classes',
    PRIVACY_PROCESSING_CLASSES.length,
    PRIVACY_PROCESSING_CLASSES.length,
  ).map((value, index) => {
    const label = `Privacy processing class ${index + 1}`;
    const item = exactRecord(value, ['id', 'title', 'description'], label);
    return Object.freeze({
      id: identifier(item.id, `${label} id`),
      title: textValue(item.title, `${label} title`),
      description: textValue(item.description, `${label} description`),
    });
  })) as unknown as typeof PRIVACY_PROCESSING_CLASSES;
  if (JSON.stringify(processingClasses) !== JSON.stringify(PRIVACY_PROCESSING_CLASSES)) {
    throw new TypeError('Privacy processing class definitions must match the canonical fixed vocabulary.');
  }
  const catalogue: PrivacyDataFlowCatalogue = Object.freeze({
    schema: PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
    version: PRIVACY_DATA_FLOW_CATALOGUE_VERSION,
    coverage: copyCoverage(source.coverage),
    processingClasses,
    invariants: strings(source.invariants, 'Privacy catalogue invariants', PRIVACY_CATALOGUE_INVARIANTS.length, false),
    capabilityFlows: Object.freeze(denseArray(source.capabilityFlows, 'Privacy capability flows', MAX_PRIVACY_CAPABILITIES, 1)
      .map(copyCapabilityFlow).sort((left, right) => compareCodeUnits(left.id, right.id))),
    cliOperationFlows: Object.freeze(denseArray(source.cliOperationFlows, 'Privacy CLI operation flows', MAX_PRIVACY_CLI_OPERATIONS, 1)
      .map(copyCliOperationFlow).sort((left, right) => compareCodeUnits(left.id, right.id))),
    schemaFamilies: Object.freeze(denseArray(source.schemaFamilies, 'Privacy schema families', MAX_PRIVACY_SCHEMA_FAMILIES, 1)
      .map(copySchemaFamily).sort((left, right) => compareCodeUnits(left.id, right.id))),
    schemaContracts: Object.freeze(denseArray(source.schemaContracts, 'Privacy schema contracts', MAX_PRIVACY_SCHEMA_CONTRACTS, 1)
      .map(copySchemaContract).sort((left, right) => compareCodeUnits(left.id, right.id))),
    schemaPrivacyProfiles: Object.freeze(denseArray(source.schemaPrivacyProfiles, 'Privacy schema profiles', MAX_PRIVACY_SCHEMA_PROFILES, 1)
      .map(copySchemaProfile).sort((left, right) => compareCodeUnits(left.id, right.id))),
    schemaConsumerFlows: Object.freeze(denseArray(source.schemaConsumerFlows, 'Privacy schema consumer flows', MAX_PRIVACY_SCHEMA_CONSUMER_FLOWS, 1)
      .map(copySchemaConsumerFlow).sort((left, right) => compareCodeUnits(left.id, right.id))),
  });
  if (JSON.stringify(catalogue.invariants) !== JSON.stringify(PRIVACY_CATALOGUE_INVARIANTS)) {
    throw new TypeError('Privacy catalogue invariants must match the canonical fixed boundary.');
  }
  validateCatalogueRelations(catalogue);
  if (utf8Length(JSON.stringify(catalogue)) > MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES) {
    throw new TypeError('Privacy data-flow catalogue exceeds its serialised byte budget.');
  }
  return catalogue;
}

export function buildPrivacyDataFlowCatalogue(
  input: PrivacyDataFlowCatalogueBuildInput,
): PrivacyDataFlowCatalogue {
  return definePrivacyDataFlowCatalogue(buildUncheckedPrivacyDataFlowCatalogue(input));
}

export function serialisePrivacyDataFlowCatalogue(value: unknown): string {
  const catalogue = definePrivacyDataFlowCatalogue(value);
  const serialised = `${JSON.stringify(catalogue, null, 2)}\n`;
  if (utf8Length(serialised) > MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES) {
    throw new TypeError('Privacy data-flow catalogue exceeds its serialised byte budget.');
  }
  return serialised;
}

export const PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.privacy-data-flow-catalogue',
  kind: 'derived',
  schema: PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
  currentVersion: PRIVACY_DATA_FLOW_CATALOGUE_VERSION,
  supportedVersions: [PRIVACY_DATA_FLOW_CATALOGUE_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES,
  owner: 'packages/contracts/privacy-data-flow-catalogue.mts',
  note: 'Exact-current generated fixed privacy boundary metadata; it contains no targets or evidence and enables no request, retention, export, score or authorisation.',
});

export const PRIVACY_DATA_FLOW_CATALOGUE_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily({
  id: 'privacy-data-flow-catalogue',
  owner: 'packages/contracts/privacy-data-flow-catalogue.mts',
  privacy: 'metadata_only',
  compatibility: [PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY],
  contracts: [{
    compatibilityId: PRIVACY_DATA_FLOW_CATALOGUE_COMPATIBILITY.id,
    schema: PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
    version: PRIVACY_DATA_FLOW_CATALOGUE_VERSION,
    role: 'document',
    lifecycle: 'current',
    readable: true,
    emitted: true,
    exactKeys: true,
    extensionPolicy: 'reject',
    futureVersionBehaviour: 'reject',
    migrationTarget: null,
    canonicalisation: null,
    byteBudget: MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES,
    fixtureIds: ['privacy-data-flow-catalogue-v1'],
  }],
  fixtures: [{
    id: 'privacy-data-flow-catalogue-v1',
    path: 'docs/privacy-data-flow-catalogue.json',
    bytes: 485_231,
    sha256: '1e990fa37178b153e13286e0ca03e8dd0944c81f03d521e41f53a822f95a9e65',
    contentDigestSha256: null,
    schema: PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
    version: PRIVACY_DATA_FLOW_CATALOGUE_VERSION,
    role: 'current',
    expectation: 'accepted_exact',
    expectedOutputFixtureId: null,
    scope: 'repository',
  }],
  metadata: {
    metadataVersion: 2,
    enforcement: 'declarative_only',
    shapes: [{
      id: 'privacy-data-flow-catalogue.document.v1',
      schema: PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
      versions: [PRIVACY_DATA_FLOW_CATALOGUE_VERSION],
      objects: [{
        path: '$',
        requiredKeys: [
          'schema', 'version', 'coverage', 'processingClasses', 'invariants', 'capabilityFlows',
          'cliOperationFlows', 'schemaFamilies', 'schemaContracts', 'schemaPrivacyProfiles',
          'schemaConsumerFlows',
        ],
        optionalKeys: [],
        unknownKeys: 'reject',
      }],
      fixedArrays: [],
      normalisation: 'preserve_document',
      target: null,
    }],
    boundProfiles: [{
      id: 'privacy-data-flow-catalogue.bounds.v1',
      bounds: [{
        id: 'serialised-bytes',
        path: '$',
        phase: 'serialised',
        unit: 'bytes',
        minimum: 1,
        maximum: MAX_PRIVACY_DATA_FLOW_CATALOGUE_BYTES,
        handling: 'reject',
      }],
    }],
    hooks: [{
      id: 'privacy-data-flow-catalogue.serialise.v1',
      role: 'serialiser',
      runtime: 'shared',
      module: 'packages/contracts/privacy-data-flow-catalogue.mts',
      exportName: 'serialisePrivacyDataFlowCatalogue',
    }],
    serialisationProfiles: [{
      id: 'privacy-data-flow-catalogue.json.v1',
      schema: PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
      versions: [PRIVACY_DATA_FLOW_CATALOGUE_VERSION],
      mediaType: 'application/json',
      encoding: 'utf-8',
      bom: false,
      indentSpaces: 2,
      terminalLf: true,
      propertyOrder: 'normalised_fixed',
      canonicalisation: null,
      integrity: 'none',
      serializerHookId: 'privacy-data-flow-catalogue.serialise.v1',
      verifierHookIds: [],
    }],
    privacyProfiles: [{
      id: 'privacy-data-flow-catalogue.metadata-only.v1',
      classification: 'metadata_only',
      projection: 'metadata_only',
      includedCategories: ['fixed-contract-metadata', 'bounded-counts', 'stable-identifiers', 'privacy-limitations'],
      excludedCategories: ['targets', 'evidence-values', 'personal-data', 'raw-contacts', 'credentials', 'cookies', 'authorisation-values', 'runtime-secrets', 'query-bearing-urls', 'local-paths'],
      notePolicy: 'not_applicable',
      retention: 'operator_controlled_output',
      network: 'none',
      sharingReview: 'not_applicable',
    }],
    expiryProfiles: [{
      id: 'privacy-data-flow-catalogue.expiry.v1',
      field: null,
      anchor: null,
      handling: 'not_applicable',
      phase: 'not_applicable',
      maximumLifetimeDays: null,
    }],
    consumerEdges: [{
      id: 'privacy-data-flow-catalogue.public-generation.v1',
      plane: 'shared',
      operation: 'generate-public-catalogue',
      acceptedContracts: [],
      emittedContract: {
        schema: PRIVACY_DATA_FLOW_CATALOGUE_SCHEMA,
        version: PRIVACY_DATA_FLOW_CATALOGUE_VERSION,
      },
      shapeIds: ['privacy-data-flow-catalogue.document.v1'],
      boundProfileIds: ['privacy-data-flow-catalogue.bounds.v1'],
      hookIds: ['privacy-data-flow-catalogue.serialise.v1'],
      serialisationProfileId: 'privacy-data-flow-catalogue.json.v1',
      privacyProfileId: 'privacy-data-flow-catalogue.metadata-only.v1',
      expiryPolicyId: 'privacy-data-flow-catalogue.expiry.v1',
      requestMode: 'none',
      retentionEffect: 'operator_controlled_output',
      bindingState: 'declared_unenforced',
      policyState: 'current',
    }],
    consumerRelationships: [],
  },
});
