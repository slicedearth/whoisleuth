import { DOMAIN_CONTROL_MANIFEST_COMPATIBILITY } from '../packages/contracts/domain-control-manifest.mts';

export type InterchangeSupport = 'supported' | 'unsupported' | 'verification_only';
export type InterchangeFidelity =
  | 'semantic_exact_after_normalisation'
  | 'normalised_merge'
  | 'lossy_by_design'
  | 'verification_only'
  | 'unsupported'
  | 'not_verified';
export type InterchangeAssuranceRequirement = 'authenticated_whole_integrity' | 'structure' | 'unsupported' | 'whole_integrity';

export type InterchangeArtifactContract = Readonly<{
  id: 'brand_profiles' | 'case_pack' | 'domain_control_passport' | 'encrypted_workspace' | 'legacy_desired_baseline' | 'lookup_claim_passport' | 'lookup_evidence' | 'workspace';
  compatibilityEntryId: string | null;
  schema: string;
  versions: readonly number[];
  versionField: 'schemaVersion' | 'version';
  nestedSchemaPath: readonly string[];
  browser: Readonly<{ import: InterchangeSupport; export: InterchangeSupport }>;
  cli: Readonly<{ read: InterchangeSupport; write: InterchangeSupport; verify: InterchangeSupport }>;
  fidelity: Exclude<InterchangeFidelity, 'not_verified'>;
  requiredAssurance: InterchangeAssuranceRequirement;
  preservedFieldGroups: readonly string[];
  excludedFieldGroups: readonly string[];
  futureVersionBehaviour: 'reject';
}>;

const exact = Object.freeze(['domain_identity', 'dns_control_expectations', 'certificate_control_expectations', 'registrar_control_expectations', 'renewal_review']);

export const INTERCHANGE_ARTIFACT_CONTRACTS: readonly InterchangeArtifactContract[] = Object.freeze([
  Object.freeze({
    id: 'lookup_claim_passport',
    compatibilityEntryId: 'export.lookup-claim-passport',
    schema: 'whoisleuth.lookup-claim-passport',
    versions: Object.freeze([1]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'unsupported', export: 'supported' }),
    cli: Object.freeze({ read: 'supported', write: 'unsupported', verify: 'supported' }),
    fidelity: 'semantic_exact_after_normalisation',
    requiredAssurance: 'whole_integrity',
    preservedFieldGroups: Object.freeze(['target_identity', 'claim_identity', 'evidence_requirement_ids', 'source_states', 'observation_times', 'model_versions', 'limitations']),
    excludedFieldGroups: Object.freeze(['raw_registry_payloads', 'contacts', 'page_values', 'request_paths', 'credentials', 'browser_local_records', 'signer_authentication']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'lookup_evidence',
    compatibilityEntryId: 'export.lookup-evidence',
    schema: LOOKUP_EVIDENCE_SCHEMA,
    versions: Object.freeze([...SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS]),
    versionField: 'schemaVersion',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'supported', write: 'supported', verify: 'supported' }),
    fidelity: 'lossy_by_design',
    requiredAssurance: 'structure',
    preservedFieldGroups: Object.freeze(['query_context', 'generator_metadata', 'source_health', 'normalised_registration_evidence', 'bounded_replay_facts', 'observation_times', 'limitations']),
    excludedFieldGroups: Object.freeze(['browser_local_records', 'case_context', 'brand_profiles', 'credentials', 'session_material', 'request_headers', 'cookies', 'signer_authentication', 'raw_payload_rendering_during_replay']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'domain_control_passport',
    compatibilityEntryId: DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.id,
    schema: DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.schema!,
    versions: DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.supportedVersions,
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'supported', write: 'supported', verify: 'supported' }),
    fidelity: 'normalised_merge',
    requiredAssurance: 'whole_integrity',
    preservedFieldGroups: exact,
    excludedFieldGroups: Object.freeze(['profile_identity', 'brand_context', 'contacts', 'notes', 'observations', 'planning_context', 'suppression_context']),
    futureVersionBehaviour: DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.futureVersionBehavior === 'reject'
      ? 'reject'
      : (() => { throw new TypeError('Domain-control interchange must reject future manifest versions.'); })(),
  }),
  Object.freeze({
    id: 'brand_profiles',
    compatibilityEntryId: 'export.brand-profiles',
    schema: 'whoisleuth.brand-profiles',
    versions: Object.freeze([2, 3, 4, 5, 6]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'supported', write: 'unsupported', verify: 'verification_only' }),
    fidelity: 'normalised_merge',
    requiredAssurance: 'structure',
    preservedFieldGroups: Object.freeze(['profile_identity', 'brand_context', 'domain_scope', 'mail_posture', 'desired_posture', 'reviewed_planning', 'retained_observations']),
    excludedFieldGroups: Object.freeze(['login_sessions', 'credentials', 'raw_upstream_payloads']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'workspace',
    compatibilityEntryId: 'export.workspace-archive',
    schema: 'whoisleuth.workspace-archive',
    versions: Object.freeze([1, 2, 3, 4, 5]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'verification_only', write: 'unsupported', verify: 'supported' }),
    fidelity: 'normalised_merge',
    requiredAssurance: 'whole_integrity',
    preservedFieldGroups: Object.freeze(['supported_workspace_sections', 'section_versions', 'section_checksums', 'merge_metadata']),
    excludedFieldGroups: Object.freeze(['login_sessions', 'credentials', 'hosted_monitor_keys', 'raw_upstream_payloads', 'tab_state']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'encrypted_workspace',
    compatibilityEntryId: 'export.encrypted-workspace-archive',
    schema: 'whoisleuth.encrypted-workspace-archive',
    versions: Object.freeze([1]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'supported', export: 'supported' }),
    cli: Object.freeze({ read: 'verification_only', write: 'unsupported', verify: 'supported' }),
    fidelity: 'verification_only',
    requiredAssurance: 'authenticated_whole_integrity',
    preservedFieldGroups: Object.freeze(['encrypted_workspace_envelope', 'authenticated_ciphertext', 'inner_workspace_after_decryption']),
    excludedFieldGroups: Object.freeze(['passphrase', 'derived_key']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'case_pack',
    compatibilityEntryId: 'export.cli-case-pack',
    schema: 'whoisleuth.cli.case-pack',
    versions: Object.freeze([1, 2]),
    versionField: 'version',
    nestedSchemaPath: Object.freeze(['packet']),
    browser: Object.freeze({ import: 'supported', export: 'unsupported' }),
    cli: Object.freeze({ read: 'supported', write: 'supported', verify: 'supported' }),
    fidelity: 'lossy_by_design',
    requiredAssurance: 'whole_integrity',
    preservedFieldGroups: Object.freeze(['redacted_case_collection', 'case_schema_version', 'trusted_internal_case_brand_profile_references']),
    excludedFieldGroups: Object.freeze(['package_reports', 'package_redaction_manifest', 'package_integrity_envelope', 'audience_excluded_case_fields', 'public_audience_case_brand_profile_references']),
    futureVersionBehaviour: 'reject',
  }),
  Object.freeze({
    id: 'legacy_desired_baseline',
    compatibilityEntryId: null,
    schema: 'whoisleuth.desired-posture-baseline',
    versions: Object.freeze([1]),
    versionField: 'schemaVersion',
    nestedSchemaPath: Object.freeze([]),
    browser: Object.freeze({ import: 'unsupported', export: 'unsupported' }),
    cli: Object.freeze({ read: 'unsupported', write: 'unsupported', verify: 'unsupported' }),
    fidelity: 'unsupported',
    requiredAssurance: 'unsupported',
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
import {
  LOOKUP_EVIDENCE_SCHEMA,
  SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS,
} from './evidence-export.mts';
