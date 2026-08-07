export type InterchangeSupport = 'supported' | 'unsupported' | 'verification_only';
export type InterchangeFidelity =
  | 'semantic_exact_after_normalisation'
  | 'normalised_merge'
  | 'lossy_by_design'
  | 'verification_only'
  | 'unsupported'
  | 'not_verified';

export type InterchangeArtifactContract = Readonly<{
  id: 'brand_profiles' | 'case_pack' | 'domain_control_passport' | 'encrypted_workspace' | 'legacy_desired_baseline' | 'workspace';
  schema: string;
  versions: readonly number[];
  versionField: 'schemaVersion' | 'version';
  nestedSchemaPath: readonly string[];
  browser: Readonly<{ import: InterchangeSupport; export: InterchangeSupport }>;
  cli: Readonly<{ read: InterchangeSupport; write: InterchangeSupport; verify: InterchangeSupport }>;
  fidelity: Exclude<InterchangeFidelity, 'not_verified'>;
  preservedFieldGroups: readonly string[];
  excludedFieldGroups: readonly string[];
  futureVersionBehaviour: 'reject';
}>;

const exact = Object.freeze(['domain_identity', 'dns_control_expectations', 'certificate_control_expectations', 'registrar_control_expectations', 'renewal_review']);

export const INTERCHANGE_ARTIFACT_CONTRACTS: readonly InterchangeArtifactContract[] = Object.freeze([
  Object.freeze({
    id: 'domain_control_passport',
    schema: 'whoisleuth.domain-control-manifest',
    versions: Object.freeze([1]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'supported', write: 'supported', verify: 'supported' }),
    fidelity: 'semantic_exact_after_normalisation',
    preservedFieldGroups: exact,
    excludedFieldGroups: Object.freeze(['profile_identity', 'brand_context', 'contacts', 'notes', 'observations', 'planning_context', 'suppression_context']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'brand_profiles',
    schema: 'whoisleuth.brand-profiles',
    versions: Object.freeze([2, 3, 4, 5, 6]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'supported', write: 'unsupported', verify: 'verification_only' }),
    fidelity: 'normalised_merge',
    preservedFieldGroups: Object.freeze(['profile_identity', 'brand_context', 'domain_scope', 'mail_posture', 'desired_posture', 'reviewed_planning', 'retained_observations']),
    excludedFieldGroups: Object.freeze(['login_sessions', 'credentials', 'raw_upstream_payloads']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'workspace',
    schema: 'whoisleuth.workspace-archive',
    versions: Object.freeze([1, 2, 3, 4, 5]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'verification_only', write: 'unsupported', verify: 'supported' }),
    fidelity: 'normalised_merge',
    preservedFieldGroups: Object.freeze(['supported_workspace_sections', 'section_versions', 'section_checksums', 'merge_metadata']),
    excludedFieldGroups: Object.freeze(['login_sessions', 'credentials', 'hosted_monitor_keys', 'raw_upstream_payloads', 'tab_state']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'encrypted_workspace',
    schema: 'whoisleuth.encrypted-workspace-archive',
    versions: Object.freeze([1]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'verification_only', write: 'unsupported', verify: 'supported' }),
    fidelity: 'verification_only',
    preservedFieldGroups: Object.freeze(['encrypted_workspace_envelope', 'authenticated_ciphertext', 'inner_workspace_after_decryption']),
    excludedFieldGroups: Object.freeze(['passphrase', 'derived_key']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'case_pack',
    schema: 'whoisleuth.cli.case-pack',
    versions: Object.freeze([1]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze(['packet']),
    browser: Object.freeze({ import: 'supported', export: 'unsupported' }),
    cli: Object.freeze({ read: 'supported', write: 'supported', verify: 'supported' }),
    fidelity: 'lossy_by_design',
    preservedFieldGroups: Object.freeze(['redacted_case_collection', 'case_schema_version']),
    excludedFieldGroups: Object.freeze(['package_reports', 'package_redaction_manifest', 'package_integrity_envelope', 'audience_excluded_case_fields']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'legacy_desired_baseline',
    schema: 'whoisleuth.desired-posture-baseline',
    versions: Object.freeze([1]),
    versionField: 'schemaVersion',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'unsupported', export: 'unsupported' }),
    cli: Object.freeze({ read: 'unsupported', write: 'unsupported', verify: 'unsupported' }),
    fidelity: 'unsupported',
    preservedFieldGroups: Object.freeze([]),
    excludedFieldGroups: Object.freeze(['entire_legacy_document']),
    futureVersionBehaviour: 'reject',
  }),
]);

export function interchangeContractFor(id: InterchangeArtifactContract['id']): InterchangeArtifactContract {
  const contract = INTERCHANGE_ARTIFACT_CONTRACTS.find((item) => item.id === id);
  if (!contract) throw new TypeError('Interchange contract is not registered.');
  return contract;
}
