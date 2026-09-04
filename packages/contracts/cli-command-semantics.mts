export const CAPABILITY_IDS = Object.freeze({
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

export const CLI_HELP_GROUP_ORDER = Object.freeze([
  'investigate',
  'respond',
  'assure',
  'utilities',
] as const);

export type CapabilityId = typeof CAPABILITY_IDS[keyof typeof CAPABILITY_IDS];
export type CliHelpGroup = typeof CLI_HELP_GROUP_ORDER[number];
export type CliCommand = keyof typeof CLI_COMMAND_SEMANTICS;

type CliCommandSemantic = Readonly<{
  group: CliHelpGroup;
  capabilityFamilyId: CapabilityId;
}>;

function semantic(group: CliHelpGroup, capabilityFamilyId: CapabilityId): CliCommandSemantic {
  return Object.freeze({ group, capabilityFamilyId });
}

export const CLI_COMMAND_SEMANTICS = Object.freeze({
  completion: semantic('utilities', CAPABILITY_IDS.OFFLINE_REVIEW),
  doctor: semantic('utilities', CAPABILITY_IDS.RUNTIME_DIAGNOSTICS),
  commands: semantic('utilities', CAPABILITY_IDS.OFFLINE_REVIEW),
  manual: semantic('utilities', CAPABILITY_IDS.OFFLINE_REVIEW),
  manifest: semantic('assure', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'map-observations': semantic('respond', CAPABILITY_IDS.OFFLINE_REVIEW),
  'oam-export': semantic('respond', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  lookup: semantic('investigate', CAPABILITY_IDS.LOOKUP),
  bulk: semantic('investigate', CAPABILITY_IDS.LOOKUP),
  'ct-search': semantic('investigate', CAPABILITY_IDS.CERTIFICATE_TRANSPARENCY),
  'ct-intake': semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  discover: semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'discover-scan': semantic('investigate', CAPABILITY_IDS.LOOKUP),
  posture: semantic('investigate', CAPABILITY_IDS.DOMAIN_POSTURE),
  http: semantic('investigate', CAPABILITY_IDS.WEBSITE_PROBE),
  tls: semantic('investigate', CAPABILITY_IDS.TLS_INTELLIGENCE),
  'dnssec-validate': semantic('assure', CAPABILITY_IDS.DNSSEC_VALIDATION),
  'mail-transport': semantic('assure', CAPABILITY_IDS.MAIL_TRANSPORT_REVIEW),
  'registry-support': semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'registry-doctor': semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'registry-cohort': semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'registry-scaffold': semantic('utilities', CAPABILITY_IDS.OFFLINE_REVIEW),
  'risk-calibrate': semantic('assure', CAPABILITY_IDS.OFFLINE_REVIEW),
  'lookalike-calibrate': semantic('assure', CAPABILITY_IDS.OFFLINE_REVIEW),
  'verify-artifact': semantic('assure', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'interchange-report': semantic('assure', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'inspect-archive': semantic('assure', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'sign-artifact': semantic('assure', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'verify-signature': semantic('assure', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'source-report': semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  compare: semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'page-compare': semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'mail-review': semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'mail-headers': semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'review-evidence': semantic('investigate', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  brief: semantic('investigate', CAPABILITY_IDS.OFFLINE_REVIEW),
  'case-pack': semantic('respond', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'domain-control': semantic('assure', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'monitor-once': semantic('assure', CAPABILITY_IDS.LOOKUP),
  assurance: semantic('assure', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'change-packet': semantic('respond', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'sharing-review': semantic('respond', CAPABILITY_IDS.PORTABLE_EVIDENCE),
  'workflow-plan': semantic('assure', CAPABILITY_IDS.OFFLINE_REVIEW),
  'workflow-run': semantic('assure', CAPABILITY_IDS.WORKFLOW_EXECUTION),
  diff: semantic('assure', CAPABILITY_IDS.OFFLINE_REVIEW),
  reconcile: semantic('assure', CAPABILITY_IDS.OFFLINE_REVIEW),
  timeline: semantic('assure', CAPABILITY_IDS.OFFLINE_REVIEW),
  export: semantic('respond', CAPABILITY_IDS.PORTABLE_EVIDENCE),
} as const satisfies Readonly<Record<string, CliCommandSemantic>>);
