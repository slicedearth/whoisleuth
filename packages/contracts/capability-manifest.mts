const CAPABILITY_MANIFEST_SCHEMA = 'whoisleuth.capability-manifest';
const CAPABILITY_MANIFEST_VERSION = 1 as const;
const MAX_CAPABILITY_MANIFEST_BYTES = 256 * 1024;

const EXECUTION_PLANES = Object.freeze([
  'browser_local',
  'hosted_bounded_passive',
  'local_cli_offline',
  'local_cli_network',
  'local_cli_authorised_active',
  'local_tool_offline',
  'local_tool_authorised_active',
  'optional_worker',
] as const);

const CAPABILITY_OUTCOME_STATES = Object.freeze([
  'complete',
  'partial',
  'blocked',
  'unsupported',
  'unavailable',
  'stale',
  'budget_exhausted',
] as const);

const CAPABILITY_IDS = Object.freeze({
  LOOKUP: 'lookup',
  RDAP: 'rdap',
  RDAP_NAMESERVER_SEARCH: 'rdap_nameserver_search',
  WHOIS: 'whois',
  AVAILABILITY: 'availability',
  DOMAIN_EVIDENCE: 'domain_evidence',
  DNS_INTELLIGENCE: 'dns_intelligence',
  WEBSITE_PROBE: 'website_probe',
  TLS_INTELLIGENCE: 'tls_intelligence',
  CERTIFICATE_TRANSPARENCY: 'certificate_transparency',
  SECURITY_TXT: 'security_txt',
  EXTERNAL_INTELLIGENCE: 'external_intelligence',
  URLSCAN_SEARCH: 'urlscan_search',
  URLHAUS_HOST: 'urlhaus_host',
  THREATFOX_DOMAIN_IOC: 'threatfox_domain_ioc',
  REGISTRAR_RDAP: 'registrar_rdap',
  NETWORK_CONTEXT: 'network_context',
  REVERSE_DNS: 'reverse_dns',
  DOMAIN_POSTURE: 'domain_posture',
  DNSSEC_VALIDATION: 'dnssec_validation',
  MAIL_TRANSPORT_REVIEW: 'mail_transport_review',
  RENDERED_WEB_CAPTURE: 'rendered_web_capture',
  RENDERED_CAPTURE_COMPARISON: 'rendered_capture_comparison',
  IDN_CONFUSABLES: 'idn_confusables',
  ANALYST_CASES: 'analyst_cases',
  WATCHLISTS: 'watchlists',
  OFFLINE_REVIEW: 'offline_review',
  PORTABLE_EVIDENCE: 'portable_evidence',
  RUNTIME_DIAGNOSTICS: 'runtime_diagnostics',
  WORKFLOW_EXECUTION: 'workflow_execution',
  SCHEDULED_MONITORING: 'scheduled_monitoring',
  DISTRIBUTED_BUDGETS: 'distributed_budgets',
} as const);

type ExecutionPlane = typeof EXECUTION_PLANES[number];
type CapabilityOutcomeState = typeof CAPABILITY_OUTCOME_STATES[number];
type CapabilityId = typeof CAPABILITY_IDS[keyof typeof CAPABILITY_IDS];
type CapabilityJob = 'investigate' | 'respond' | 'assure' | 'platform';
type CapabilityTrigger =
  | 'explicit_browser_action'
  | 'explicit_cli_command'
  | 'explicit_local_tool'
  | 'variant_specific'
  | 'authenticated_request'
  | 'derived_from_current_evidence'
  | 'derived_from_retained_evidence'
  | 'operator_schedule'
  | 'deployment_configuration';
type CapabilityNetworkMode =
  | 'none'
  | 'bounded_passive'
  | 'conditional_bounded_passive'
  | 'bounded_authorised_active';
type CapabilityDataClass =
  | 'none'
  | 'normalised_target'
  | 'normalised_registrable_domain'
  | 'registry_query'
  | 'whois_query'
  | 'dns_question'
  | 'public_ip_address'
  | 'homepage_request'
  | 'tls_handshake'
  | 'certificate_search_term'
  | 'mail_transport_commands'
  | 'mta_sts_policy_request'
  | 'encrypted_compact_watchlist'
  | 'fixed_diagnostic_probe'
  | 'operation_control_metadata'
  | 'admitted_resource_request';
type CapabilityRecipientClass =
  | 'none'
  | 'registry_service'
  | 'dns_resolver'
  | 'target_public_service'
  | 'certificate_transparency_service'
  | 'configured_intelligence_provider'
  | 'selected_public_resolver'
  | 'selected_mail_endpoint'
  | 'configured_worker_store'
  | 'configured_control_provider';
type CapabilityRequestBudget =
  | 'none'
  | 'variant_specific'
  | 'registry_light'
  | 'registry_deep'
  | 'certificate_search'
  | 'posture_audit'
  | 'collector_specific'
  | 'authorised_dnssec'
  | 'authorised_mail_transport'
  | 'control_provider_specific'
  | 'worker_cycle'
  | 'authorised_rendered_capture'
  | 'workflow_step_specific';
type CapabilityResponseBudget =
  | 'none'
  | 'bounded_runtime_report'
  | 'collector_specific'
  | 'bounded_local_input'
  | 'bounded_portable_document'
  | 'bounded_rendered_capture'
  | 'bounded_compact_state';
type CapabilityConcurrency =
  | 'none'
  | 'registry_light'
  | 'registry_deep'
  | 'certificate_search'
  | 'posture_audit'
  | 'command_bounded'
  | 'single_capture'
  | 'worker_bounded';
type CapabilityCredentialModel =
  | 'none'
  | 'deployment_optional'
  | 'variant_specific'
  | 'required_public_trust_file'
  | 'optional_secret_passphrase_file'
  | 'required_secret_private_key_file'
  | 'optional_public_key_file'
  | 'worker_encryption_key';
type CapabilityRetention =
  | 'transient'
  | 'browser_deliberate'
  | 'local_output_deliberate'
  | 'worker_compact_encrypted'
  | 'control_only';
type CapabilityExport =
  | 'none'
  | 'deliberate_bounded'
  | 'metadata_only'
  | 'local_output';
type CapabilityScoringEffect =
  | 'none'
  | 'bounded_risk_input'
  | 'acquisition_only'
  | 'bounded_risk_and_acquisition_input';
type CapabilityAuthorisation =
  | 'explicit_action'
  | 'authenticated_request'
  | 'authenticated_explicit_action'
  | 'explicit_network_approval'
  | 'inherited_parent_action'
  | 'owned_or_authorised_acknowledgement'
  | 'authorised_capture_acknowledgement'
  | 'deployment_configuration'
  | 'worker_configuration';
type CapabilityCancellation =
  | 'not_applicable'
  | 'variant_specific'
  | 'client_stops_waiting'
  | 'cooperative'
  | 'step_stops_admission'
  | 'queue_stops_admission'
  | 'bounded_atomic';
type CapabilityPartialResults =
  | 'not_applicable'
  | 'variant_specific'
  | 'explicit_per_source'
  | 'explicit_per_item'
  | 'explicit_document'
  | 'explicit_step'
  | 'fail_closed'
  | 'all_or_nothing';
type LegacyCapabilityStatus = 'supported' | 'disabled' | 'unavailable' | 'local_only';
type LegacyCapabilityExecution = 'hosted' | 'browser' | 'worker';

type LegacyCapabilityProjection = Readonly<{
  status: LegacyCapabilityStatus;
  execution: LegacyCapabilityExecution;
  scanModes: readonly ('fast' | 'deep')[];
  reason?: string;
}>;

type OperationBudgetVariant = Readonly<{
  featureId: string;
  classId: 'registry_light' | 'registry_deep' | 'certificate_search' | 'posture_audit';
}>;

type WorkerCycleBudget = Readonly<{
  maxLookups: number;
  maxProcessedDeliveries: number;
  softCycleBudgetMs: number;
  minLookupWindowMs: number;
}>;

type RenderedCaptureBudget = Readonly<{
  maxRequests: number;
  maxHosts: number;
  maxUrlLength: number;
  maxTimeoutMs: number;
  maxResponseBytes: number;
  maxTransferBytes: number;
  maxManifestBytes: number;
  maxDomDigestBytes: number;
  maxScreenshotBytes: number;
  maxDomElements: number;
  maxDomProjectionCharacters: number;
  maxVisibleTextBytes: number;
}>;

type DistributedControlBudget = Readonly<{
  requestTimeoutMs: number;
  maxResponseBytes: number;
  providerUnavailableRetryAfterSeconds: number;
  maxRequestAttempts: number;
  automaticRetries: number;
  defaultLeaseTtlMs: number;
  minLeaseTtlMs: number;
  maxLeaseTtlMs: number;
  maxUsageCounter: number;
}>;

type CliExecutionVariant = Readonly<{
  id: string;
  planes: readonly ExecutionPlane[];
  trigger: CapabilityTrigger;
  networkMode: CapabilityNetworkMode;
  disclosedData: readonly CapabilityDataClass[];
  recipients: readonly CapabilityRecipientClass[];
  requestBudget: CapabilityRequestBudget;
  responseBudget: CapabilityResponseBudget;
  concurrency: CapabilityConcurrency;
  credentialModel: CapabilityCredentialModel;
  retention: CapabilityRetention;
  export: CapabilityExport;
  scoringEffect: CapabilityScoringEffect;
  authorisation: CapabilityAuthorisation;
  cancellation: CapabilityCancellation;
  partialResults: CapabilityPartialResults;
  outcomes: readonly CapabilityOutcomeState[];
  documentStates?: readonly string[];
}>;

type CapabilityDefinition = Readonly<{
  id: CapabilityId;
  title: string;
  job: CapabilityJob;
  planes: readonly ExecutionPlane[];
  trigger: CapabilityTrigger;
  networkMode: CapabilityNetworkMode;
  scanModes: readonly ('fast' | 'compact' | 'deep' | 'offline' | 'monitor' | 'active')[];
  disclosedData: readonly CapabilityDataClass[];
  recipients: readonly CapabilityRecipientClass[];
  requestBudget: CapabilityRequestBudget;
  responseBudget: CapabilityResponseBudget;
  concurrency: CapabilityConcurrency;
  credentialModel: CapabilityCredentialModel;
  retention: CapabilityRetention;
  export: CapabilityExport;
  scoringEffect: CapabilityScoringEffect;
  authorisation: CapabilityAuthorisation;
  cancellation: CapabilityCancellation;
  partialResults: CapabilityPartialResults;
  outcomes: readonly CapabilityOutcomeState[];
  documentStates?: readonly string[];
  privacyLimitations: readonly string[];
  featurePolicyId?: string;
  featurePolicyDependencies?: readonly string[];
  operationBudgetVariants?: readonly OperationBudgetVariant[];
  workerCycleBudget?: WorkerCycleBudget;
  renderedCaptureBudget?: RenderedCaptureBudget;
  distributedControlBudget?: DistributedControlBudget;
  legacyCapability?: LegacyCapabilityProjection;
}>;

type CapabilityManifest = Readonly<{
  schema: typeof CAPABILITY_MANIFEST_SCHEMA;
  version: typeof CAPABILITY_MANIFEST_VERSION;
  capabilities: readonly CapabilityDefinition[];
  cliOperations: readonly CliOperationDefinition[];
}>;

type CliOperationDefinition = Readonly<{
  recordId: `command.cli.${string}`;
  command: string;
  capabilityFamilyId: CapabilityId;
  collectionMode: 'offline' | 'network';
  planes: readonly ExecutionPlane[];
  trigger: CapabilityTrigger;
  networkMode: CapabilityNetworkMode;
  disclosedData: readonly CapabilityDataClass[];
  recipients: readonly CapabilityRecipientClass[];
  requestBudget: CapabilityRequestBudget;
  responseBudget: CapabilityResponseBudget;
  concurrency: CapabilityConcurrency;
  credentialModel: CapabilityCredentialModel;
  retention: CapabilityRetention;
  export: CapabilityExport;
  scoringEffect: CapabilityScoringEffect;
  authorisation: CapabilityAuthorisation;
  cancellation: CapabilityCancellation;
  partialResults: CapabilityPartialResults;
  outcomes: readonly CapabilityOutcomeState[];
  documentStates?: readonly string[];
  privacyLimitations: readonly string[];
  variants?: readonly CliExecutionVariant[];
}>;

const COMPLETE_OR_LIMITED = Object.freeze([
  'complete', 'partial', 'blocked', 'unsupported', 'unavailable', 'budget_exhausted',
] as const satisfies readonly CapabilityOutcomeState[]);
const LOCAL_OUTCOMES = Object.freeze([
  'complete', 'partial', 'blocked', 'unsupported', 'unavailable', 'stale',
] as const satisfies readonly CapabilityOutcomeState[]);
const STATIC_OUTCOMES = Object.freeze([
  'complete',
] as const satisfies readonly CapabilityOutcomeState[]);
const COMPLETE_OR_PARTIAL = Object.freeze([
  'complete', 'partial',
] as const satisfies readonly CapabilityOutcomeState[]);

const OFFLINE_ALL_OR_NOTHING_COMMANDS = Object.freeze([
  'manifest',
  'registry-support',
  'registry-scaffold',
  'risk-calibrate',
  'lookalike-calibrate',
  'sign-artifact',
  'case-pack',
  'workflow-plan',
  'export',
] as const);
const OFFLINE_PER_ITEM_COMMANDS = Object.freeze([
  'map-observations',
  'oam-export',
  'ct-intake',
  'discover',
  'registry-cohort',
  'source-report',
  'mail-review',
] as const);
const OFFLINE_PER_SOURCE_COMMANDS = Object.freeze([
  'registry-doctor',
  'compare',
  'page-compare',
  'brief',
  'domain-control',
  'assurance',
  'diff',
  'reconcile',
  'timeline',
] as const);

function freezeCapability(definition: CapabilityDefinition): CapabilityDefinition {
  return Object.freeze({
    ...definition,
    planes: Object.freeze([...definition.planes]),
    scanModes: Object.freeze([...definition.scanModes]),
    disclosedData: Object.freeze([...definition.disclosedData]),
    recipients: Object.freeze([...definition.recipients]),
    outcomes: Object.freeze([...definition.outcomes]),
    ...(definition.documentStates
      ? { documentStates: Object.freeze([...definition.documentStates]) }
      : {}),
    privacyLimitations: Object.freeze([...definition.privacyLimitations]),
    ...(definition.featurePolicyDependencies
      ? { featurePolicyDependencies: Object.freeze([...definition.featurePolicyDependencies]) }
      : {}),
    ...(definition.operationBudgetVariants
      ? {
          operationBudgetVariants: Object.freeze(definition.operationBudgetVariants.map((variant) => (
            Object.freeze({ ...variant })
          ))),
        }
      : {}),
    ...(definition.workerCycleBudget
      ? { workerCycleBudget: Object.freeze({ ...definition.workerCycleBudget }) }
      : {}),
    ...(definition.renderedCaptureBudget
      ? { renderedCaptureBudget: Object.freeze({ ...definition.renderedCaptureBudget }) }
      : {}),
    ...(definition.distributedControlBudget
      ? { distributedControlBudget: Object.freeze({ ...definition.distributedControlBudget }) }
      : {}),
    ...(definition.legacyCapability
      ? {
          legacyCapability: Object.freeze({
            ...definition.legacyCapability,
            scanModes: Object.freeze([...definition.legacyCapability.scanModes]),
          }),
        }
      : {}),
  });
}

const capabilities: readonly CapabilityDefinition[] = Object.freeze([
  freezeCapability({
    id: CAPABILITY_IDS.LOOKUP,
    title: 'Unified Lookup and bounded multi-target collection',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'explicit_browser_action',
    networkMode: 'bounded_passive',
    scanModes: ['fast', 'compact', 'deep', 'monitor'],
    disclosedData: ['normalised_target', 'registry_query', 'whois_query', 'dns_question', 'public_ip_address', 'homepage_request', 'tls_handshake'],
    recipients: ['registry_service', 'dns_resolver', 'target_public_service'],
    requestBudget: 'variant_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'bounded_risk_and_acquisition_input',
    authorisation: 'authenticated_explicit_action',
    cancellation: 'variant_specific',
    partialResults: 'variant_specific',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Targets are disclosed only to the source families eligible for the selected mode.',
      'Fast, Compact, Deep and monitoring retain distinct request, evidence and storage boundaries.',
      'A source failure or omission remains explicit and never establishes absence or safety.',
    ],
    featurePolicyId: 'lookup',
    operationBudgetVariants: [
      { featureId: 'lookup_fast', classId: 'registry_light' },
      { featureId: 'lookup_deep', classId: 'registry_deep' },
      { featureId: 'bulk_fast', classId: 'registry_light' },
      { featureId: 'bulk_deep', classId: 'registry_deep' },
    ],
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.RDAP,
    title: 'RDAP registration and allocation evidence',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'bounded_passive',
    scanModes: ['fast', 'compact', 'deep', 'monitor'],
    disclosedData: ['normalised_target', 'registry_query'],
    recipients: ['registry_service'],
    requestBudget: 'registry_light',
    responseBudget: 'collector_specific',
    concurrency: 'registry_light',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'bounded_risk_and_acquisition_input',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Published registration and allocation data remains attributed to its RDAP service.',
      'Missing or redacted fields do not establish absence, ownership or operational control.',
    ],
    featurePolicyId: 'rdap',
    operationBudgetVariants: [{ featureId: 'rdap', classId: 'registry_light' }],
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.RDAP_NAMESERVER_SEARCH,
    title: 'Registry-scoped RDAP nameserver search',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'explicit_browser_action',
    networkMode: 'bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['normalised_target', 'registry_query'],
    recipients: ['registry_service'],
    requestBudget: 'registry_light',
    responseBudget: 'collector_specific',
    concurrency: 'registry_light',
    credentialModel: 'none',
    retention: 'transient',
    export: 'none',
    scoringEffect: 'none',
    authorisation: 'authenticated_explicit_action',
    cancellation: 'client_stops_waiting',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'The query is limited to one selected registry and is not a global reverse-nameserver inventory.',
    ],
    featurePolicyId: 'rdap_nameserver_search',
    featurePolicyDependencies: ['rdap'],
    operationBudgetVariants: [{ featureId: 'rdap_nameserver_search', classId: 'registry_light' }],
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: [] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.WHOIS,
    title: 'Referral-aware WHOIS publication evidence',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'bounded_passive',
    scanModes: ['deep', 'monitor'],
    disclosedData: ['normalised_target', 'whois_query'],
    recipients: ['registry_service'],
    requestBudget: 'registry_deep',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'bounded_risk_and_acquisition_input',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Registry and referral publications remain separately attributed and can disagree.',
      'Raw WHOIS payloads and expanded contact data are excluded from compact retention.',
    ],
    featurePolicyId: 'whois',
    operationBudgetVariants: [{ featureId: 'whois', classId: 'registry_deep' }],
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.AVAILABILITY,
    title: 'Authority-aware registration availability',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'conditional_bounded_passive',
    scanModes: ['fast', 'compact', 'deep', 'monitor'],
    disclosedData: ['normalised_target', 'registry_query', 'dns_question'],
    recipients: ['registry_service', 'dns_resolver'],
    requestBudget: 'variant_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_light',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'bounded_risk_and_acquisition_input',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Only authoritative registration evidence can establish an availability decision.',
      'DNS, page, mail and heuristic evidence cannot decide registration existence.',
    ],
    featurePolicyId: 'availability',
    operationBudgetVariants: [
      { featureId: 'availability_fast', classId: 'registry_light' },
      { featureId: 'availability_deep', classId: 'registry_deep' },
    ],
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: ['fast', 'deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.DOMAIN_EVIDENCE,
    title: 'Bounded domain evidence collection',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'conditional_bounded_passive',
    scanModes: ['fast', 'compact', 'deep', 'monitor'],
    disclosedData: ['normalised_target', 'dns_question', 'homepage_request', 'tls_handshake'],
    recipients: ['dns_resolver', 'target_public_service'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'bounded_risk_and_acquisition_input',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_per_source',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Each source retains its own state, observation time, completeness and limitations.',
      'Fast and Compact never inherit the richer Deep request or storage contract.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.DNS_INTELLIGENCE,
    title: 'DNS intelligence',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'bounded_passive',
    scanModes: ['deep', 'monitor'],
    disclosedData: ['normalised_target', 'dns_question'],
    recipients: ['dns_resolver'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'bounded_risk_input',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_per_source',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Resolver answers are point-in-time publications and do not prove provider ownership or control.',
    ],
    featurePolicyId: 'dns_intelligence',
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.WEBSITE_PROBE,
    title: 'Bounded homepage and static page evidence',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['normalised_target', 'dns_question', 'homepage_request'],
    recipients: ['dns_resolver', 'target_public_service'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'bounded_risk_and_acquisition_input',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_per_source',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Static captured evidence is not a browser execution, vulnerability test or proof of page purpose.',
      'Complete query-bearing URLs, cookies, credentials, scripts and raw page content are not retained.',
    ],
    featurePolicyId: 'website_probe',
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.TLS_INTELLIGENCE,
    title: 'Bounded TLS connection and certificate evidence',
    job: 'assure',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['normalised_target', 'dns_question', 'tls_handshake'],
    recipients: ['dns_resolver', 'target_public_service'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'PKIX, hostname, validity and connection states remain independent and point-in-time.',
      'A successful handshake is not a safety, ownership or intent verdict.',
    ],
    featurePolicyId: 'tls_intelligence',
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: ['deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.CERTIFICATE_TRANSPARENCY,
    title: 'Certificate Transparency search',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'explicit_browser_action',
    networkMode: 'bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['certificate_search_term'],
    recipients: ['certificate_transparency_service'],
    requestBudget: 'certificate_search',
    responseBudget: 'collector_specific',
    concurrency: 'certificate_search',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'authenticated_explicit_action',
    cancellation: 'client_stops_waiting',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Search results are lower-bound public log observations and do not prove current deployment or control.',
    ],
    featurePolicyId: 'certificate_transparency',
    operationBudgetVariants: [{ featureId: 'certificate_transparency', classId: 'certificate_search' }],
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: [] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.SECURITY_TXT,
    title: 'Optional security.txt collection',
    job: 'respond',
    planes: ['hosted_bounded_passive'],
    trigger: 'explicit_browser_action',
    networkMode: 'bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['normalised_target', 'dns_question', 'homepage_request'],
    recipients: ['dns_resolver', 'target_public_service'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'authenticated_explicit_action',
    cancellation: 'client_stops_waiting',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Publication is a source-attributed contact route, not proof that it is monitored or appropriate.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.EXTERNAL_INTELLIGENCE,
    title: 'Selected optional intelligence providers',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'explicit_browser_action',
    networkMode: 'bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['normalised_registrable_domain'],
    recipients: ['configured_intelligence_provider'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'deployment_optional',
    retention: 'transient',
    export: 'none',
    scoringEffect: 'bounded_risk_input',
    authorisation: 'authenticated_explicit_action',
    cancellation: 'client_stops_waiting',
    partialResults: 'explicit_per_source',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Optional providers remain off unless configured and selected for one Deep Lookup.',
      'A provider report or miss remains attributed and is not proof of maliciousness, safety or absence.',
    ],
  }),
  ...([
    [CAPABILITY_IDS.URLSCAN_SEARCH, 'Archived public scan verdict search', 'Archived scan history is searched without submitting a new scan.', 'Archived URLscan verdict search is not configured.'],
    [CAPABILITY_IDS.URLHAUS_HOST, 'Archived malware-host search', 'One exact host search is performed without submitting a URL, file or report.', 'Malware-host intelligence is not configured.'],
    [CAPABILITY_IDS.THREATFOX_DOMAIN_IOC, 'Retained malware-indicator search', 'One exact retained-indicator search is performed without submitting an indicator or sample.', 'Malware-IOC intelligence is not configured.'],
  ] as const).map(([id, title, limitation, reason]) => freezeCapability({
    id,
    title,
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'explicit_browser_action',
    networkMode: 'bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['normalised_registrable_domain'],
    recipients: ['configured_intelligence_provider'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'deployment_optional',
    retention: 'transient',
    export: 'none',
    scoringEffect: 'bounded_risk_input',
    authorisation: 'authenticated_explicit_action',
    cancellation: 'client_stops_waiting',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [limitation],
    legacyCapability: { status: 'unavailable', execution: 'hosted', scanModes: ['deep'], reason },
  })),
  freezeCapability({
    id: CAPABILITY_IDS.REGISTRAR_RDAP,
    title: 'Eligible registrar RDAP follow-up',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'conditional_bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['normalised_registrable_domain', 'registry_query'],
    recipients: ['registry_service'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'At most one eligible registry-advertised HTTPS service is followed and it never overwrites registry evidence.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.NETWORK_CONTEXT,
    title: 'Observed endpoint network context',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'conditional_bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['public_ip_address', 'registry_query'],
    recipients: ['registry_service'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'One observed public endpoint does not establish an origin host, hosting control or ownership.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.REVERSE_DNS,
    title: 'Public-address reverse DNS',
    job: 'investigate',
    planes: ['hosted_bounded_passive'],
    trigger: 'authenticated_request',
    networkMode: 'conditional_bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['public_ip_address', 'dns_question'],
    recipients: ['dns_resolver'],
    requestBudget: 'collector_specific',
    responseBudget: 'collector_specific',
    concurrency: 'registry_deep',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'authenticated_request',
    cancellation: 'bounded_atomic',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'PTR names are publisher-controlled context and do not prove ownership or service identity.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.DOMAIN_POSTURE,
    title: 'Owned-domain posture review',
    job: 'assure',
    planes: ['hosted_bounded_passive'],
    trigger: 'explicit_browser_action',
    networkMode: 'bounded_passive',
    scanModes: ['deep'],
    disclosedData: ['normalised_target', 'registry_query', 'dns_question', 'mta_sts_policy_request'],
    recipients: ['registry_service', 'dns_resolver', 'target_public_service'],
    requestBudget: 'posture_audit',
    responseBudget: 'collector_specific',
    concurrency: 'posture_audit',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'authenticated_explicit_action',
    cancellation: 'client_stops_waiting',
    partialResults: 'explicit_per_source',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Posture findings describe bounded public registry, DNS and MTA-STS publication evidence and never change configuration.',
    ],
    featurePolicyId: 'domain_posture',
    featurePolicyDependencies: ['dns_intelligence'],
    operationBudgetVariants: [{ featureId: 'domain_posture', classId: 'posture_audit' }],
    legacyCapability: { status: 'supported', execution: 'hosted', scanModes: [] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.DNSSEC_VALIDATION,
    title: 'Explicit DNSSEC validation',
    job: 'assure',
    planes: ['local_cli_authorised_active'],
    trigger: 'explicit_cli_command',
    networkMode: 'bounded_authorised_active',
    scanModes: ['active'],
    disclosedData: ['normalised_target', 'dns_question'],
    recipients: ['selected_public_resolver'],
    requestBudget: 'authorised_dnssec',
    responseBudget: 'collector_specific',
    concurrency: 'command_bounded',
    credentialModel: 'required_public_trust_file',
    retention: 'local_output_deliberate',
    export: 'local_output',
    scoringEffect: 'none',
    authorisation: 'owned_or_authorised_acknowledgement',
    cancellation: 'client_stops_waiting',
    partialResults: 'explicit_document',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'The selected resolver receives the bounded DNS questions for this explicitly authorised run.',
      'DNSSEC assurance remains separate from routing, DANE, PKIX and ownership claims.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.MAIL_TRANSPORT_REVIEW,
    title: 'Explicit mail transport review',
    job: 'assure',
    planes: ['local_cli_authorised_active'],
    trigger: 'explicit_cli_command',
    networkMode: 'bounded_authorised_active',
    scanModes: ['active'],
    disclosedData: ['normalised_target', 'dns_question', 'mail_transport_commands', 'tls_handshake'],
    recipients: ['selected_public_resolver', 'selected_mail_endpoint'],
    requestBudget: 'authorised_mail_transport',
    responseBudget: 'collector_specific',
    concurrency: 'command_bounded',
    credentialModel: 'required_public_trust_file',
    retention: 'local_output_deliberate',
    export: 'local_output',
    scoringEffect: 'none',
    authorisation: 'owned_or_authorised_acknowledgement',
    cancellation: 'client_stops_waiting',
    partialResults: 'explicit_per_source',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'The action never sends mail, authenticates, tests relay, enumerates recipients or retries automatically.',
      'DNSSEC, TLSA, DANE, PKIX, STARTTLS and SMTP states remain independently attributed.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.RENDERED_WEB_CAPTURE,
    title: 'Explicit local rendered web capture',
    job: 'investigate',
    planes: ['local_tool_authorised_active'],
    trigger: 'explicit_local_tool',
    networkMode: 'bounded_authorised_active',
    scanModes: ['active'],
    disclosedData: ['admitted_resource_request', 'dns_question'],
    recipients: ['target_public_service', 'dns_resolver'],
    requestBudget: 'authorised_rendered_capture',
    responseBudget: 'bounded_rendered_capture',
    concurrency: 'single_capture',
    credentialModel: 'none',
    retention: 'local_output_deliberate',
    export: 'local_output',
    scoringEffect: 'none',
    authorisation: 'authorised_capture_acknowledgement',
    cancellation: 'cooperative',
    partialResults: 'explicit_document',
    outcomes: ['complete', 'partial', 'blocked', 'unavailable', 'budget_exhausted'],
    privacyLimitations: [
      'Each admitted resource request discloses its exact URL, including path and query, its GET or HEAD method, and ordinary allowlisted request headers to that public resource endpoint; DNS questions are disclosed to the configured resolver.',
      'Structured outputs exclude request paths, queries, headers and bodies, but the control-sanitised page title and screenshot retain page-controlled content that may reproduce a path or query.',
      'Rendered capture executes page JavaScript and remains separate from hosted Lookup and the distributable CLI.',
    ],
    renderedCaptureBudget: {
      maxRequests: 100,
      maxHosts: 30,
      maxUrlLength: 2_048,
      maxTimeoutMs: 30_000,
      maxResponseBytes: 4 * 1024 * 1024,
      maxTransferBytes: 24 * 1024 * 1024,
      maxManifestBytes: 1024 * 1024,
      maxDomDigestBytes: 1024 * 1024,
      maxScreenshotBytes: 10 * 1024 * 1024,
      maxDomElements: 20_000,
      maxDomProjectionCharacters: 256 * 1024,
      maxVisibleTextBytes: 256 * 1024,
    },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.RENDERED_CAPTURE_COMPARISON,
    title: 'Offline rendered capture comparison',
    job: 'investigate',
    planes: ['local_tool_offline'],
    trigger: 'explicit_local_tool',
    networkMode: 'none',
    scanModes: ['offline'],
    disclosedData: ['none'],
    recipients: ['none'],
    requestBudget: 'none',
    responseBudget: 'bounded_local_input',
    concurrency: 'none',
    credentialModel: 'none',
    retention: 'transient',
    export: 'local_output',
    scoringEffect: 'none',
    authorisation: 'explicit_action',
    cancellation: 'not_applicable',
    partialResults: 'explicit_document',
    outcomes: ['complete', 'partial', 'blocked', 'unsupported', 'unavailable'],
    privacyLimitations: [
      'The comparator reads only two selected bounded local capture sets and makes no network request.',
      'It reports independent verified components and never emits a combined similarity, intent or maliciousness score.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.IDN_CONFUSABLES,
    title: 'Browser-local IDN and confusable analysis',
    job: 'investigate',
    planes: ['browser_local'],
    trigger: 'derived_from_current_evidence',
    networkMode: 'none',
    scanModes: ['fast', 'deep', 'offline'],
    disclosedData: ['none'],
    recipients: ['none'],
    requestBudget: 'none',
    responseBudget: 'none',
    concurrency: 'none',
    credentialModel: 'none',
    retention: 'transient',
    export: 'deliberate_bounded',
    scoringEffect: 'bounded_risk_input',
    authorisation: 'inherited_parent_action',
    cancellation: 'not_applicable',
    partialResults: 'explicit_document',
    outcomes: LOCAL_OUTCOMES,
    privacyLimitations: [
      'Local string similarity and script analysis do not establish impersonation, intent or maliciousness.',
    ],
    legacyCapability: { status: 'local_only', execution: 'browser', scanModes: ['fast', 'deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.ANALYST_CASES,
    title: 'Browser-local analyst cases and Review Item lifecycle',
    job: 'respond',
    planes: ['browser_local'],
    trigger: 'explicit_browser_action',
    networkMode: 'none',
    scanModes: ['offline'],
    disclosedData: ['none'],
    recipients: ['none'],
    requestBudget: 'none',
    responseBudget: 'bounded_local_input',
    concurrency: 'none',
    credentialModel: 'none',
    retention: 'browser_deliberate',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'explicit_action',
    cancellation: 'not_applicable',
    partialResults: 'explicit_document',
    outcomes: LOCAL_OUTCOMES,
    privacyLimitations: [
      'Cases and the bounded analyst Review Item lifecycle overlay remain in the current browser profile unless deliberately exported.',
      'Review decisions retain stable subject identity, the reviewed material fingerprint, rationale, timestamps, expiry and bounded associations; current titles, evidence summaries and source values remain derived.',
      'Analyst assertions, response actions and Review Item lifecycle decisions never rewrite their source evidence or start collection, reporting, monitoring or enforcement.',
      'Missing, partial, stale, truncated or unavailable evidence cannot resolve a Review Item; changed material evidence and expired decisions return it to review.',
    ],
    legacyCapability: { status: 'local_only', execution: 'browser', scanModes: [] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.WATCHLISTS,
    title: 'Browser-local watchlists and monitoring views',
    job: 'assure',
    planes: ['browser_local'],
    trigger: 'explicit_browser_action',
    networkMode: 'none',
    scanModes: ['fast', 'deep', 'offline', 'monitor'],
    disclosedData: ['none'],
    recipients: ['none'],
    requestBudget: 'none',
    responseBudget: 'bounded_local_input',
    concurrency: 'none',
    credentialModel: 'none',
    retention: 'browser_deliberate',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'explicit_action',
    cancellation: 'not_applicable',
    partialResults: 'explicit_per_source',
    outcomes: LOCAL_OUTCOMES,
    privacyLimitations: [
      'Browser-local monitoring state is not refreshed automatically unless a separately configured worker is used.',
    ],
    legacyCapability: { status: 'local_only', execution: 'browser', scanModes: ['fast', 'deep'] },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.OFFLINE_REVIEW,
    title: 'Bounded local CLI review and derivation',
    job: 'investigate',
    planes: ['local_cli_offline'],
    trigger: 'explicit_cli_command',
    networkMode: 'none',
    scanModes: ['offline'],
    disclosedData: ['none'],
    recipients: ['none'],
    requestBudget: 'none',
    responseBudget: 'bounded_local_input',
    concurrency: 'none',
    credentialModel: 'none',
    retention: 'local_output_deliberate',
    export: 'local_output',
    scoringEffect: 'none',
    authorisation: 'explicit_action',
    cancellation: 'variant_specific',
    partialResults: 'variant_specific',
    outcomes: LOCAL_OUTCOMES,
    privacyLimitations: [
      'Offline commands read only selected bounded local inputs and make no network request.',
      'Generated output remains under the operator\'s local retention and deletion control.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.PORTABLE_EVIDENCE,
    title: 'Portable evidence, verification and reviewed hand-off',
    job: 'assure',
    planes: ['browser_local', 'local_cli_offline'],
    trigger: 'variant_specific',
    networkMode: 'none',
    scanModes: ['offline'],
    disclosedData: ['none'],
    recipients: ['none'],
    requestBudget: 'none',
    responseBudget: 'bounded_portable_document',
    concurrency: 'none',
    credentialModel: 'variant_specific',
    retention: 'local_output_deliberate',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'explicit_action',
    cancellation: 'variant_specific',
    partialResults: 'variant_specific',
    outcomes: LOCAL_OUTCOMES,
    privacyLimitations: [
      'Integrity, structure, signature and content assurance remain separate checks.',
      'Browser exports require an explicit browser action; CLI exports, verification and review require an explicit CLI command.',
      'Sharing a generated artefact is a deliberate action outside the collection runtime.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.RUNTIME_DIAGNOSTICS,
    title: 'CLI runtime diagnostics',
    job: 'platform',
    planes: ['local_cli_offline', 'local_cli_network'],
    trigger: 'explicit_cli_command',
    networkMode: 'conditional_bounded_passive',
    scanModes: ['offline'],
    disclosedData: ['fixed_diagnostic_probe'],
    recipients: ['dns_resolver', 'target_public_service', 'registry_service'],
    requestBudget: 'collector_specific',
    responseBudget: 'bounded_runtime_report',
    concurrency: 'command_bounded',
    credentialModel: 'none',
    retention: 'local_output_deliberate',
    export: 'metadata_only',
    scoringEffect: 'none',
    authorisation: 'explicit_network_approval',
    cancellation: 'variant_specific',
    partialResults: 'variant_specific',
    outcomes: COMPLETE_OR_LIMITED,
    privacyLimitations: [
      'Network diagnostics run only with the explicit network option and use fixed diagnostic targets.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.WORKFLOW_EXECUTION,
    title: 'Approved local CLI workflow execution',
    job: 'investigate',
    planes: ['local_cli_offline', 'local_cli_network'],
    trigger: 'explicit_cli_command',
    networkMode: 'conditional_bounded_passive',
    scanModes: ['offline', 'fast', 'deep'],
    disclosedData: ['normalised_target', 'registry_query', 'whois_query', 'dns_question', 'public_ip_address', 'homepage_request', 'tls_handshake', 'mta_sts_policy_request'],
    recipients: ['registry_service', 'dns_resolver', 'target_public_service'],
    requestBudget: 'variant_specific',
    responseBudget: 'bounded_local_input',
    concurrency: 'command_bounded',
    credentialModel: 'none',
    retention: 'local_output_deliberate',
    export: 'local_output',
    scoringEffect: 'none',
    authorisation: 'explicit_network_approval',
    cancellation: 'step_stops_admission',
    partialResults: 'explicit_step',
    outcomes: ['complete', 'partial', 'blocked'],
    documentStates: ['complete', 'awaiting_network_approval', 'awaiting_analyst_selection', 'step_failed'],
    privacyLimitations: [
      'Only installed fixed-recipe steps can run, and each network invocation requires explicit approval.',
      'Analyst-selection placeholders pause without interpretation or collection.',
    ],
  }),
  freezeCapability({
    id: CAPABILITY_IDS.SCHEDULED_MONITORING,
    title: 'Optional scheduled monitoring worker',
    job: 'assure',
    planes: ['optional_worker'],
    trigger: 'operator_schedule',
    networkMode: 'bounded_passive',
    scanModes: ['fast', 'compact', 'monitor'],
    disclosedData: ['normalised_target', 'registry_query', 'dns_question', 'encrypted_compact_watchlist'],
    recipients: ['registry_service', 'dns_resolver', 'configured_worker_store'],
    requestBudget: 'worker_cycle',
    responseBudget: 'bounded_compact_state',
    concurrency: 'worker_bounded',
    credentialModel: 'worker_encryption_key',
    retention: 'worker_compact_encrypted',
    export: 'deliberate_bounded',
    scoringEffect: 'none',
    authorisation: 'worker_configuration',
    cancellation: 'queue_stops_admission',
    partialResults: 'explicit_per_source',
    outcomes: ['complete', 'partial', 'blocked', 'unavailable', 'budget_exhausted'],
    privacyLimitations: [
      'The worker retains only the documented compact encrypted projection and is not general evidence custody.',
      'Disabling collection does not delete retained ciphertext; deletion remains deliberate.',
    ],
    workerCycleBudget: {
      maxLookups: 2,
      maxProcessedDeliveries: 8,
      softCycleBudgetMs: 24_000,
      minLookupWindowMs: 16_000,
    },
    legacyCapability: {
      status: 'unavailable', execution: 'worker', scanModes: ['fast'],
      reason: 'Scheduled monitoring is not configured.',
    },
  }),
  freezeCapability({
    id: CAPABILITY_IDS.DISTRIBUTED_BUDGETS,
    title: 'Optional distributed operation budgets',
    job: 'platform',
    planes: ['hosted_bounded_passive'],
    trigger: 'deployment_configuration',
    networkMode: 'conditional_bounded_passive',
    scanModes: [],
    disclosedData: ['operation_control_metadata'],
    recipients: ['configured_control_provider'],
    requestBudget: 'control_provider_specific',
    responseBudget: 'bounded_runtime_report',
    concurrency: 'none',
    credentialModel: 'deployment_optional',
    retention: 'control_only',
    export: 'metadata_only',
    scoringEffect: 'none',
    authorisation: 'deployment_configuration',
    cancellation: 'not_applicable',
    partialResults: 'fail_closed',
    outcomes: ['complete', 'budget_exhausted', 'unavailable'],
    privacyLimitations: [
      'Budget records contain operation classes and bounded counters, not targets or evidence contents.',
      'Unavailable distributed controls make configured network-heavy operations fail closed.',
    ],
    distributedControlBudget: {
      requestTimeoutMs: 4_000,
      maxResponseBytes: 16 * 1024,
      providerUnavailableRetryAfterSeconds: 5,
      maxRequestAttempts: 1,
      automaticRetries: 0,
      defaultLeaseTtlMs: 5 * 60 * 1000,
      minLeaseTtlMs: 30_000,
      maxLeaseTtlMs: 15 * 60 * 1000,
      maxUsageCounter: 1_000_000_000,
    },
    legacyCapability: {
      status: 'unavailable', execution: 'hosted', scanModes: [],
      reason: 'Distributed counters are not configured.',
    },
  }),
]);

const CLI_CAPABILITY_BINDINGS = Object.freeze({
  completion: CAPABILITY_IDS.OFFLINE_REVIEW,
  doctor: CAPABILITY_IDS.RUNTIME_DIAGNOSTICS,
  commands: CAPABILITY_IDS.OFFLINE_REVIEW,
  manual: CAPABILITY_IDS.OFFLINE_REVIEW,
  manifest: CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'map-observations': CAPABILITY_IDS.OFFLINE_REVIEW,
  'oam-export': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  lookup: CAPABILITY_IDS.LOOKUP,
  bulk: CAPABILITY_IDS.LOOKUP,
  'ct-search': CAPABILITY_IDS.CERTIFICATE_TRANSPARENCY,
  'ct-intake': CAPABILITY_IDS.OFFLINE_REVIEW,
  discover: CAPABILITY_IDS.OFFLINE_REVIEW,
  'discover-scan': CAPABILITY_IDS.LOOKUP,
  posture: CAPABILITY_IDS.DOMAIN_POSTURE,
  http: CAPABILITY_IDS.WEBSITE_PROBE,
  tls: CAPABILITY_IDS.TLS_INTELLIGENCE,
  'dnssec-validate': CAPABILITY_IDS.DNSSEC_VALIDATION,
  'mail-transport': CAPABILITY_IDS.MAIL_TRANSPORT_REVIEW,
  'registry-support': CAPABILITY_IDS.OFFLINE_REVIEW,
  'registry-doctor': CAPABILITY_IDS.OFFLINE_REVIEW,
  'registry-cohort': CAPABILITY_IDS.OFFLINE_REVIEW,
  'registry-scaffold': CAPABILITY_IDS.OFFLINE_REVIEW,
  'risk-calibrate': CAPABILITY_IDS.OFFLINE_REVIEW,
  'lookalike-calibrate': CAPABILITY_IDS.OFFLINE_REVIEW,
  'verify-artifact': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'interchange-report': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'inspect-archive': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'sign-artifact': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'verify-signature': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'source-report': CAPABILITY_IDS.OFFLINE_REVIEW,
  compare: CAPABILITY_IDS.OFFLINE_REVIEW,
  'page-compare': CAPABILITY_IDS.OFFLINE_REVIEW,
  'mail-review': CAPABILITY_IDS.OFFLINE_REVIEW,
  'review-evidence': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  brief: CAPABILITY_IDS.OFFLINE_REVIEW,
  'case-pack': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'domain-control': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'monitor-once': CAPABILITY_IDS.LOOKUP,
  assurance: CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'change-packet': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'sharing-review': CAPABILITY_IDS.PORTABLE_EVIDENCE,
  'workflow-plan': CAPABILITY_IDS.OFFLINE_REVIEW,
  'workflow-run': CAPABILITY_IDS.WORKFLOW_EXECUTION,
  diff: CAPABILITY_IDS.OFFLINE_REVIEW,
  reconcile: CAPABILITY_IDS.OFFLINE_REVIEW,
  timeline: CAPABILITY_IDS.OFFLINE_REVIEW,
  export: CAPABILITY_IDS.PORTABLE_EVIDENCE,
} as const satisfies Readonly<Record<string, CapabilityId>>);

const CAPABILITY_SOURCE_ALIASES = Object.freeze({
  malware_host_intelligence: CAPABILITY_IDS.URLHAUS_HOST,
  malware_ioc_intelligence: CAPABILITY_IDS.THREATFOX_DOMAIN_IOC,
} as const satisfies Readonly<Record<string, CapabilityId>>);

function freezeCliOperation(definition: CliOperationDefinition): CliOperationDefinition {
  return Object.freeze({
    ...definition,
    planes: Object.freeze([...definition.planes]),
    disclosedData: Object.freeze([...definition.disclosedData]),
    recipients: Object.freeze([...definition.recipients]),
    outcomes: Object.freeze([...definition.outcomes]),
    ...(definition.documentStates
      ? { documentStates: Object.freeze([...definition.documentStates]) }
      : {}),
    privacyLimitations: Object.freeze([...definition.privacyLimitations]),
    ...(definition.variants
      ? {
          variants: Object.freeze(definition.variants.map((variant) => Object.freeze({
            ...variant,
            planes: Object.freeze([...variant.planes]),
            disclosedData: Object.freeze([...variant.disclosedData]),
            recipients: Object.freeze([...variant.recipients]),
            outcomes: Object.freeze([...variant.outcomes]),
            ...(variant.documentStates
              ? { documentStates: Object.freeze([...variant.documentStates]) }
              : {}),
          }))),
        }
      : {}),
  });
}

function offlineCliOperation(command: string, capabilityId: CapabilityId): CliOperationDefinition {
  if (['completion', 'commands', 'manual'].includes(command)) {
    return freezeCliOperation({
      recordId: `command.cli.${command}`,
      command,
      capabilityFamilyId: capabilityId,
      collectionMode: 'offline',
      planes: ['local_cli_offline'],
      trigger: 'explicit_cli_command',
      networkMode: 'none',
      disclosedData: ['none'],
      recipients: ['none'],
      requestBudget: 'none',
      responseBudget: 'bounded_runtime_report',
      concurrency: 'none',
      credentialModel: 'none',
      retention: 'local_output_deliberate',
      export: 'metadata_only',
      scoringEffect: 'none',
      authorisation: 'explicit_action',
      cancellation: 'not_applicable',
      partialResults: 'all_or_nothing',
      outcomes: STATIC_OUTCOMES,
      privacyLimitations: [
        'The command emits fixed installed metadata and makes no network request or local evidence read.',
      ],
    });
  }
  const portable = capabilityId === CAPABILITY_IDS.PORTABLE_EVIDENCE;
  const allOrNothing = OFFLINE_ALL_OR_NOTHING_COMMANDS.includes(
    command as typeof OFFLINE_ALL_OR_NOTHING_COMMANDS[number],
  );
  const perItem = OFFLINE_PER_ITEM_COMMANDS.includes(
    command as typeof OFFLINE_PER_ITEM_COMMANDS[number],
  );
  const perSource = OFFLINE_PER_SOURCE_COMMANDS.includes(
    command as typeof OFFLINE_PER_SOURCE_COMMANDS[number],
  );
  const credentialModel: CapabilityCredentialModel = command === 'sign-artifact'
    ? 'required_secret_private_key_file'
    : command === 'verify-signature'
      ? 'optional_public_key_file'
      : ['verify-artifact', 'interchange-report', 'inspect-archive'].includes(command)
        ? 'optional_secret_passphrase_file'
        : 'none';
  return freezeCliOperation({
    recordId: `command.cli.${command}`,
    command,
    capabilityFamilyId: capabilityId,
    collectionMode: 'offline',
    planes: ['local_cli_offline'],
    trigger: 'explicit_cli_command',
    networkMode: 'none',
    disclosedData: ['none'],
    recipients: ['none'],
    requestBudget: 'none',
    responseBudget: portable ? 'bounded_portable_document' : 'bounded_local_input',
    concurrency: 'none',
    credentialModel,
    retention: 'local_output_deliberate',
    export: portable ? 'deliberate_bounded' : 'local_output',
    scoringEffect: 'none',
    authorisation: 'explicit_action',
    cancellation: ['registry-scaffold', 'workflow-plan'].includes(command)
      ? 'not_applicable'
      : 'bounded_atomic',
    partialResults: allOrNothing
      ? 'all_or_nothing'
      : perItem
        ? 'explicit_per_item'
        : perSource
          ? 'explicit_per_source'
          : 'explicit_document',
    outcomes: allOrNothing
      ? STATIC_OUTCOMES
      : command === 'interchange-report'
        ? ['complete', 'partial', 'unsupported', 'unavailable']
        : ['inspect-archive', 'verify-signature'].includes(command)
          ? ['complete', 'partial', 'unavailable']
          : ['review-evidence', 'change-packet', 'sharing-review'].includes(command)
            ? ['complete', 'partial', 'blocked']
            : COMPLETE_OR_PARTIAL,
    privacyLimitations: [
      'The command reads only selected bounded local input and makes no network request.',
      'Output remains under the operator\'s local retention and deletion control.',
    ],
  });
}

function passiveCliOperation(
  command: string,
  capabilityId: CapabilityId,
  options: Readonly<{
    disclosedData: readonly CapabilityDataClass[];
    recipients: readonly CapabilityRecipientClass[];
    scoringEffect?: CapabilityScoringEffect;
    networkMode?: CapabilityNetworkMode;
    planes?: readonly ExecutionPlane[];
    authorisation?: CapabilityAuthorisation;
    requestBudget?: CapabilityRequestBudget;
    responseBudget?: CapabilityResponseBudget;
    credentialModel?: CapabilityCredentialModel;
    export?: CapabilityExport;
    cancellation?: CapabilityCancellation;
    partialResults?: CapabilityPartialResults;
    outcomes?: readonly CapabilityOutcomeState[];
    documentStates?: readonly string[];
    variants?: readonly CliExecutionVariant[];
    privacyLimitations: readonly string[];
  }>,
): CliOperationDefinition {
  return freezeCliOperation({
    recordId: `command.cli.${command}`,
    command,
    capabilityFamilyId: capabilityId,
    collectionMode: 'network',
    planes: options.planes ?? ['local_cli_network'],
    trigger: 'explicit_cli_command',
    networkMode: options.networkMode ?? 'bounded_passive',
    disclosedData: options.disclosedData,
    recipients: options.recipients,
    requestBudget: options.requestBudget ?? 'collector_specific',
    responseBudget: options.responseBudget ?? 'collector_specific',
    concurrency: 'command_bounded',
    credentialModel: options.credentialModel ?? 'none',
    retention: 'local_output_deliberate',
    export: options.export ?? 'local_output',
    scoringEffect: options.scoringEffect ?? 'none',
    authorisation: options.authorisation ?? 'explicit_action',
    cancellation: options.cancellation ?? 'client_stops_waiting',
    partialResults: options.partialResults ?? 'explicit_per_source',
    outcomes: options.outcomes ?? COMPLETE_OR_PARTIAL,
    ...(options.documentStates ? { documentStates: options.documentStates } : {}),
    privacyLimitations: options.privacyLimitations,
    ...(options.variants ? { variants: options.variants } : {}),
  });
}

function lookupCliVariants(command: 'lookup' | 'bulk' | 'discover-scan'): readonly CliExecutionVariant[] {
  const cancellation: CapabilityCancellation = command === 'lookup'
    ? 'client_stops_waiting'
    : 'queue_stops_admission';
  const plan = (mode: 'fast' | 'deep'): CliExecutionVariant => ({
    id: `plan_${mode}`,
    planes: ['local_cli_offline'],
    trigger: 'explicit_cli_command',
    networkMode: 'none',
    disclosedData: ['none'],
    recipients: ['none'],
    requestBudget: 'none',
    responseBudget: 'bounded_runtime_report',
    concurrency: 'none',
    credentialModel: 'none',
    retention: 'local_output_deliberate',
    export: 'metadata_only',
    scoringEffect: 'none',
    authorisation: 'explicit_action',
    cancellation: 'bounded_atomic',
    partialResults: 'all_or_nothing',
    outcomes: STATIC_OUTCOMES,
  });
  const collect = (mode: 'fast' | 'deep'): CliExecutionVariant => ({
    id: `collect_${mode}`,
    planes: ['local_cli_network'],
    trigger: 'explicit_cli_command',
    networkMode: 'bounded_passive',
    disclosedData: mode === 'fast'
      ? ['normalised_target', 'registry_query', 'dns_question']
      : [
          'normalised_target', 'registry_query', 'whois_query', 'dns_question',
          'homepage_request', 'tls_handshake',
          ...(command === 'lookup' ? ['public_ip_address' as const] : []),
        ],
    recipients: mode === 'fast'
      ? ['registry_service', 'dns_resolver']
      : ['registry_service', 'dns_resolver', 'target_public_service'],
    requestBudget: mode === 'fast' ? 'registry_light' : 'registry_deep',
    responseBudget: 'collector_specific',
    concurrency: 'command_bounded',
    credentialModel: 'none',
    retention: 'local_output_deliberate',
    export: 'local_output',
    scoringEffect: 'bounded_risk_and_acquisition_input',
    authorisation: 'explicit_action',
    cancellation,
    partialResults: command === 'lookup' ? 'explicit_per_source' : 'explicit_per_item',
    outcomes: COMPLETE_OR_PARTIAL,
  });
  return [plan('fast'), plan('deep'), collect('fast'), collect('deep')];
}

function cliOperation(command: string, capabilityId: CapabilityId): CliOperationDefinition {
  if (command === 'doctor') {
    return passiveCliOperation(command, capabilityId, {
      planes: ['local_cli_offline', 'local_cli_network'],
      networkMode: 'conditional_bounded_passive',
      disclosedData: ['fixed_diagnostic_probe'],
      recipients: ['dns_resolver', 'target_public_service', 'registry_service'],
      requestBudget: 'variant_specific',
      responseBudget: 'bounded_runtime_report',
      export: 'metadata_only',
      authorisation: 'explicit_network_approval',
      variants: [
        {
          id: 'default_local',
          planes: ['local_cli_offline'],
          trigger: 'explicit_cli_command',
          networkMode: 'none',
          disclosedData: ['none'],
          recipients: ['none'],
          requestBudget: 'none',
          responseBudget: 'bounded_runtime_report',
          concurrency: 'none',
          credentialModel: 'none',
          retention: 'local_output_deliberate',
          export: 'metadata_only',
          scoringEffect: 'none',
          authorisation: 'explicit_action',
          cancellation: 'not_applicable',
          partialResults: 'all_or_nothing',
          outcomes: STATIC_OUTCOMES,
        },
        {
          id: 'network_opt_in',
          planes: ['local_cli_network'],
          trigger: 'explicit_cli_command',
          networkMode: 'bounded_passive',
          disclosedData: ['fixed_diagnostic_probe'],
          recipients: ['dns_resolver', 'target_public_service', 'registry_service'],
          requestBudget: 'collector_specific',
          responseBudget: 'bounded_runtime_report',
          concurrency: 'command_bounded',
          credentialModel: 'none',
          retention: 'local_output_deliberate',
          export: 'metadata_only',
          scoringEffect: 'none',
          authorisation: 'explicit_network_approval',
          cancellation: 'client_stops_waiting',
          partialResults: 'explicit_per_source',
          outcomes: ['complete', 'partial'],
        },
      ],
      privacyLimitations: [
        'Network diagnostics are opt-in and use only fixed public diagnostic destinations.',
      ],
    });
  }
  if (['lookup', 'bulk', 'discover-scan'].includes(command)) {
    const lookupCommand = command as 'lookup' | 'bulk' | 'discover-scan';
    const cancellation: CapabilityCancellation = command === 'lookup'
      ? 'client_stops_waiting'
      : 'queue_stops_admission';
    return passiveCliOperation(command, capabilityId, {
      planes: ['local_cli_offline', 'local_cli_network'],
      networkMode: 'conditional_bounded_passive',
      disclosedData: [
        'normalised_target', 'registry_query', 'whois_query', 'dns_question',
        'homepage_request', 'tls_handshake',
        ...(command === 'lookup' ? ['public_ip_address' as const] : []),
      ],
      recipients: ['registry_service', 'dns_resolver', 'target_public_service'],
      requestBudget: 'variant_specific',
      scoringEffect: 'bounded_risk_and_acquisition_input',
      cancellation,
      partialResults: command === 'lookup' ? 'explicit_per_source' : 'explicit_per_item',
      outcomes: COMPLETE_OR_PARTIAL,
      variants: lookupCliVariants(lookupCommand),
      privacyLimitations: [
        'Only the source families eligible for the selected command and mode receive the bounded target representation.',
        'The plan variant is request-free; collection retains the selected command and mode\'s evidence and persistence contract.',
      ],
    });
  }
  if (command === 'monitor-once') {
    return passiveCliOperation(command, capabilityId, {
      disclosedData: ['normalised_target', 'registry_query', 'whois_query', 'dns_question', 'public_ip_address', 'homepage_request', 'tls_handshake'],
      recipients: ['registry_service', 'dns_resolver', 'target_public_service'],
      scoringEffect: 'none',
      cancellation: 'queue_stops_admission',
      partialResults: 'explicit_per_item',
      privacyLimitations: [
        'The one-shot monitor reads selected local control state and performs only the bounded scheduled review collection.',
        'Its checkpoint and review evidence do not calculate Risk or Opportunity scores.',
      ],
    });
  }
  if (command === 'ct-search') {
    return passiveCliOperation(command, capabilityId, {
      disclosedData: ['certificate_search_term'],
      recipients: ['certificate_transparency_service'],
      requestBudget: 'certificate_search',
      partialResults: 'explicit_document',
      privacyLimitations: [
        'The bounded search term is sent to the fixed Certificate Transparency search service.',
      ],
    });
  }
  if (command === 'posture') {
    return passiveCliOperation(command, capabilityId, {
      disclosedData: ['normalised_target', 'registry_query', 'dns_question', 'mta_sts_policy_request'],
      recipients: ['registry_service', 'dns_resolver', 'target_public_service'],
      requestBudget: 'posture_audit',
      privacyLimitations: [
        'The posture review performs bounded RDAP, DNS and MTA-STS publication checks without changing configuration.',
      ],
    });
  }
  if (command === 'http') {
    return passiveCliOperation(command, capabilityId, {
      disclosedData: ['normalised_target', 'dns_question', 'homepage_request'],
      recipients: ['dns_resolver', 'target_public_service'],
      partialResults: 'explicit_document',
      privacyLimitations: [
        'The target public service receives one bounded SSRF-guarded homepage workflow.',
      ],
    });
  }
  if (command === 'tls') {
    return passiveCliOperation(command, capabilityId, {
      disclosedData: ['normalised_target', 'dns_question', 'tls_handshake'],
      recipients: ['dns_resolver', 'target_public_service'],
      partialResults: 'explicit_document',
      privacyLimitations: [
        'The selected public endpoint receives one bounded certificate connection.',
      ],
    });
  }
  if (command === 'dnssec-validate') {
    return freezeCliOperation({
      ...passiveCliOperation(command, capabilityId, {
        planes: ['local_cli_authorised_active'],
        networkMode: 'bounded_authorised_active',
        disclosedData: ['normalised_target', 'dns_question'],
        recipients: ['selected_public_resolver'],
        requestBudget: 'authorised_dnssec',
        authorisation: 'owned_or_authorised_acknowledgement',
        partialResults: 'explicit_document',
        privacyLimitations: [
          'The selected resolver receives the bounded questions only after the owned-or-authorised acknowledgement.',
          'The local trust anchor is read from the selected file and is never transmitted.',
        ],
      }),
      credentialModel: 'required_public_trust_file',
    });
  }
  if (command === 'mail-transport') {
    return freezeCliOperation({
      ...passiveCliOperation(command, capabilityId, {
        planes: ['local_cli_authorised_active'],
        networkMode: 'bounded_authorised_active',
        disclosedData: ['normalised_target', 'dns_question', 'mail_transport_commands', 'tls_handshake'],
        recipients: ['selected_public_resolver', 'selected_mail_endpoint'],
        requestBudget: 'authorised_mail_transport',
        authorisation: 'owned_or_authorised_acknowledgement',
        partialResults: 'explicit_per_source',
        privacyLimitations: [
          'The command requires both owned-or-authorised and active-probe acknowledgements.',
          'It never sends mail, authenticates, tests relay, enumerates recipients or retries automatically.',
        ],
      }),
      credentialModel: 'required_public_trust_file',
    });
  }
  if (command === 'workflow-run') {
    return passiveCliOperation(command, capabilityId, {
      planes: ['local_cli_offline', 'local_cli_network'],
      networkMode: 'conditional_bounded_passive',
      disclosedData: ['normalised_target', 'registry_query', 'whois_query', 'dns_question', 'public_ip_address', 'homepage_request', 'tls_handshake', 'mta_sts_policy_request'],
      recipients: ['registry_service', 'dns_resolver', 'target_public_service'],
      requestBudget: 'variant_specific',
      authorisation: 'explicit_network_approval',
      cancellation: 'step_stops_admission',
      partialResults: 'explicit_step',
      outcomes: ['complete', 'partial', 'blocked'],
      documentStates: ['complete', 'awaiting_network_approval', 'awaiting_analyst_selection', 'step_failed'],
      variants: [
        {
          id: 'unapproved_run',
          planes: ['local_cli_offline'],
          trigger: 'explicit_cli_command',
          networkMode: 'none',
          disclosedData: ['none'],
          recipients: ['none'],
          requestBudget: 'none',
          responseBudget: 'bounded_local_input',
          concurrency: 'command_bounded',
          credentialModel: 'none',
          retention: 'local_output_deliberate',
          export: 'local_output',
          scoringEffect: 'none',
          authorisation: 'explicit_action',
          cancellation: 'step_stops_admission',
          partialResults: 'explicit_step',
          outcomes: ['complete', 'partial', 'blocked'],
          documentStates: ['complete', 'awaiting_network_approval', 'awaiting_analyst_selection', 'step_failed'],
        },
        {
          id: 'approved_run',
          planes: ['local_cli_offline', 'local_cli_network'],
          trigger: 'explicit_cli_command',
          networkMode: 'conditional_bounded_passive',
          disclosedData: ['normalised_target', 'registry_query', 'whois_query', 'dns_question', 'public_ip_address', 'homepage_request', 'tls_handshake', 'mta_sts_policy_request'],
          recipients: ['registry_service', 'dns_resolver', 'target_public_service'],
          requestBudget: 'workflow_step_specific',
          responseBudget: 'collector_specific',
          concurrency: 'command_bounded',
          credentialModel: 'none',
          retention: 'local_output_deliberate',
          export: 'local_output',
          scoringEffect: 'none',
          authorisation: 'explicit_network_approval',
          cancellation: 'step_stops_admission',
          partialResults: 'explicit_step',
          outcomes: ['complete', 'partial', 'blocked'],
          documentStates: ['complete', 'awaiting_analyst_selection', 'step_failed'],
        },
      ],
      privacyLimitations: [
        'Only fixed installed recipe steps can run, and every network invocation requires explicit approval.',
      ],
    });
  }
  return offlineCliOperation(command, capabilityId);
}

const cliOperations: readonly CliOperationDefinition[] = Object.freeze(
  Object.entries(CLI_CAPABILITY_BINDINGS).map(([command, capabilityId]) => (
    cliOperation(command, capabilityId)
  )),
);

const CAPABILITY_MANIFEST: CapabilityManifest = Object.freeze({
  schema: CAPABILITY_MANIFEST_SCHEMA,
  version: CAPABILITY_MANIFEST_VERSION,
  capabilities,
  cliOperations,
});

function capabilityDefinition(id: string): CapabilityDefinition | null {
  return CAPABILITY_MANIFEST.capabilities.find((item) => item.id === id) ?? null;
}

function capabilityForSourceId(sourceId: string): CapabilityDefinition | null {
  const direct = capabilityDefinition(sourceId);
  if (direct) return direct;
  const alias = (CAPABILITY_SOURCE_ALIASES as Readonly<Record<string, CapabilityId>>)[sourceId];
  return alias ? capabilityDefinition(alias) : null;
}

function cliOperationForCommand(command: string): CliOperationDefinition | null {
  return CAPABILITY_MANIFEST.cliOperations.find((item) => item.command === command) ?? null;
}

export {
  CAPABILITY_IDS,
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_SCHEMA,
  CAPABILITY_MANIFEST_VERSION,
  MAX_CAPABILITY_MANIFEST_BYTES,
  CAPABILITY_OUTCOME_STATES,
  CAPABILITY_SOURCE_ALIASES,
  CLI_CAPABILITY_BINDINGS,
  EXECUTION_PLANES,
  capabilityDefinition,
  capabilityForSourceId,
  cliOperationForCommand,
};

export type {
  CapabilityDefinition,
  DistributedControlBudget,
  CapabilityId,
  CapabilityManifest,
  CapabilityNetworkMode,
  CapabilityOutcomeState,
  CliExecutionVariant,
  CliOperationDefinition,
  ExecutionPlane,
  LegacyCapabilityProjection,
  RenderedCaptureBudget,
  WorkerCycleBudget,
};
