import {
  ACQUISITION_DECISIONS,
  ACQUISITION_MANUAL_CHECKS,
  ACQUISITION_DECISION_PACKET_SCHEMA,
  ACQUISITION_DECISION_PACKET_VERSION,
} from '../../packages/investigation/acquisition-decision-packet.mts';
import {
  BULK_DOMAIN_COMPARISON_EXPORT_VERSION,
  BULK_DOMAIN_COMPARISON_SCHEMA,
} from '../../packages/investigation/bulk-domain-comparison.mts';
import {
  BULK_MAIL_EXPOSURE_EXPORT_VERSION,
  BULK_MAIL_EXPOSURE_SCHEMA,
  MAX_BULK_MAIL_EXPOSURE_ROWS,
} from '../../packages/investigation/bulk-mail-exposure.mts';
import {
  BULK_REVIEW_MANIFEST_SCHEMA,
  BULK_REVIEW_MANIFEST_VERSION,
} from '../../packages/investigation/bulk-review-export.mts';
import {
  LOOKUP_CLAIM_PASSPORT_SCHEMA,
  LOOKUP_CLAIM_PASSPORT_TARGET_TYPES,
  LOOKUP_CLAIM_PASSPORT_VERSION,
  MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS,
  MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS,
} from '../../packages/investigation/lookup-claim-passport.mts';
import {
  LOOKUP_CLAIM_IDS,
  LOOKUP_CLAIM_READINESS_VERSION,
  LOOKUP_CLAIM_REQUIREMENT_IDS,
} from '../../packages/investigation/lookup-claim-readiness.mts';
import { normalizeDomainControlManifestDocument } from '../../packages/evidence/domain-control-runtime.mts';
import { DOMAIN_CHANGE_PACKET_SCHEMA, DOMAIN_CHANGE_PACKET_VERSION } from '../../lib/domain-change-packet.mts';
import { DOMAIN_CONTROL_MANIFEST_SCHEMA } from '../../packages/contracts/domain-control-manifest.mts';
import {
  INVESTIGATION_MANIFEST_SCHEMA,
  INVESTIGATION_MANIFEST_VERSION,
  MAX_INVESTIGATION_MANIFEST_ARTIFACTS,
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
} from '../investigation-manifest.mts';
import {
  array,
  boolean,
  domain,
  digest,
  enumeration,
  exact,
  fail,
  integer,
  iso,
  optionalText,
  sameValues,
  strings,
  text,
  validateIntegrity,
  type UnknownRecord,
} from './structure-primitives.mts';

const CLAIM_PASSPORT_SOURCE_STATES = ['complete', 'not_found', 'partial', 'skipped', 'unavailable', 'unknown', 'unsupported'] as const;
const COMPARISON_STATES = ['conflicting', 'different', 'equal', 'missing', 'not_recorded', 'unavailable'] as const;
const SOURCE_STATES = ['complete', 'error', 'not_found', 'not_recorded', 'partial', 'skipped', 'unavailable', 'unsupported'] as const;
const DOMAIN_COMPARISON_ROW_IDS = [
  'registration', 'registrar', 'created', 'expires', 'nameservers', 'dns-a', 'dns-aaaa', 'dns-cname',
  'dns-caa', 'dnssec', 'ip-addresses', 'tls-source', 'certificate', 'tls-issuer', 'tls-spki', 'mail',
  'null-mx', 'spf', 'dmarc', 'website', 'page-title', 'favicon', 'tracking', 'password-field',
  'phishing-language', 'official-assets', 'technology', 'source-health',
] as const;
const MAIL_STATES = ['authenticated_mail', 'evidence_incomplete', 'mail_auth_gap', 'mail_auth_incomplete', 'no_explicit_mx', 'null_mx'] as const;

const DNS_TYPES = ['A', 'AAAA', 'CAA', 'CDNSKEY', 'CDS', 'CNAME', 'CSYNC', 'HTTPS', 'MX', 'NS', 'SRV', 'SVCB', 'TLSA', 'TXT'] as const;

function validateAcquisitionItem(value: unknown, label: string): string {
  const item = exact(value, ['id', 'label', 'state', 'detail', 'provenance'], label);
  const id = enumeration(item.id, ['availability', 'contacts', 'lifecycle', 'mail', 'nameservers', 'operations', 'policy_eligibility', 'policy_lifecycle', 'policy_transfer', 'tls', 'transfer', 'web'], label);
  enumeration(item.state, ['authoritative', 'observed', 'review', 'unavailable'], label);
  text(item.label, label, 200);
  text(item.detail, label, 2_000);
  text(item.provenance, label, 300);
  return id;
}

function validateAcquisition(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'target', 'synthetic', 'evidenceObservedAt', 'analystReview', 'evidenceReview', 'limitations', 'integrity'], 'Acquisition decision packet');
  iso(root.generatedAt, 'Acquisition decision packet generatedAt');
  domain(root.target, 'Acquisition decision packet target');
  boolean(root.synthetic, 'Acquisition decision packet synthetic');
  iso(root.evidenceObservedAt, 'Acquisition decision packet evidenceObservedAt', true);
  const review = exact(root.analystReview, ['decision', 'rationale', 'reviewedChecks', 'outstandingChecks', 'state'], 'Acquisition analyst review');
  const decision = enumeration(review.decision, ACQUISITION_DECISIONS, 'Acquisition analyst review decision');
  text(review.rationale, 'Acquisition analyst review rationale', 2_000, true);
  const reviewed = strings(review.reviewedChecks, 'Acquisition reviewed checks', ACQUISITION_MANUAL_CHECKS.length, 40);
  const outstanding = strings(review.outstandingChecks, 'Acquisition outstanding checks', ACQUISITION_MANUAL_CHECKS.length, 40);
  const expectedReviewed = ACQUISITION_MANUAL_CHECKS.filter((item) => reviewed.includes(item));
  const expectedOutstanding = ACQUISITION_MANUAL_CHECKS.filter((item) => !reviewed.includes(item));
  if (!sameValues(reviewed, expectedReviewed) || !sameValues(outstanding, expectedOutstanding)) fail('Acquisition analyst review checks');
  const expectedState = decision === 'unresolved' || reviewed.length < ACQUISITION_MANUAL_CHECKS.length ? 'draft' : 'reviewed';
  if (review.state !== expectedState) fail('Acquisition analyst review state');
  const evidence = exact(root.evidenceReview, ['version', 'label', 'state', 'items', 'transitionDependencies', 'policyChecks', 'nextSteps', 'limitations'], 'Acquisition evidence review');
  if (evidence.version !== 2) fail('Acquisition evidence review');
  text(evidence.label, 'Acquisition evidence review label', 200);
  enumeration(evidence.state, ['incomplete', 'registered', 'review_transition', 'sale_signal', 'unregistered_observation'], 'Acquisition evidence review state');
  const expectedEvidenceIds = {
    items: ['availability', 'lifecycle', 'transfer', 'operations', 'contacts'],
    transitionDependencies: ['nameservers', 'web', 'mail', 'tls'],
    policyChecks: ['policy_eligibility', 'policy_lifecycle', 'policy_transfer'],
  } as const;
  for (const key of ['items', 'transitionDependencies', 'policyChecks'] as const) {
    const expected = expectedEvidenceIds[key];
    const values = array(evidence[key], `Acquisition evidence review ${key}`, expected.length, expected.length);
    const ids = values.map((item, index) => validateAcquisitionItem(item, `Acquisition evidence review ${key}[${index}]`));
    if (!sameValues(ids, expected)) fail(`Acquisition evidence review ${key}`);
  }
  strings(evidence.nextSteps, 'Acquisition next steps', 6, 600);
  strings(evidence.limitations, 'Acquisition evidence limitations', 12, 600);
  strings(root.limitations, 'Acquisition limitations', 8, 600);
  validateIntegrity(root.integrity, 'Acquisition integrity', root.version, ACQUISITION_DECISION_PACKET_VERSION);
}

function validateClaimPassportTarget(type: string, value: unknown): void {
  const candidate = text(value, 'Claim passport target', 253);
  if (type === 'domain') {
    domain(candidate, 'Claim passport target');
    return;
  }
  if (type === 'ipv4') {
    const parts = candidate.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255 || String(Number(part)) !== part)) fail('Claim passport target');
    return;
  }
  if (type === 'ipv6') {
    if (!candidate.includes(':') || /[\[\]%/?#@]/u.test(candidate)) fail('Claim passport target');
    try {
      const hostname = new URL(`http://[${candidate}]/`).hostname;
      const normalized = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
      if (normalized !== candidate) fail('Claim passport target');
    } catch { fail('Claim passport target'); }
    return;
  }
  if (!/^AS(?:[1-9]\d{0,9})$/u.test(candidate) || Number(candidate.slice(2)) > 4_294_967_295) fail('Claim passport target');
}

function validateLookupClaimPassport(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'application', 'target', 'observation', 'claim', 'models', 'limitations', 'integrity'], 'Lookup claim passport');
  if (root.version !== LOOKUP_CLAIM_PASSPORT_VERSION) fail('Lookup claim passport');
  iso(root.generatedAt, 'Lookup claim passport generatedAt');
  const application = exact(root.application, ['name', 'version'], 'Lookup claim passport application');
  if (application.name !== 'WHOISleuth' || typeof application.version !== 'string'
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(application.version)) fail('Lookup claim passport application');
  const target = exact(root.target, ['type', 'value'], 'Lookup claim passport target');
  const type = enumeration(target.type, LOOKUP_CLAIM_PASSPORT_TARGET_TYPES, 'Lookup claim passport target');
  validateClaimPassportTarget(type, target.value);
  const observation = exact(root.observation, ['observedAt', 'lookupDepth'], 'Lookup claim passport observation');
  iso(observation.observedAt, 'Lookup claim passport observation', true);
  enumeration(observation.lookupDepth, ['fast', 'deep'], 'Lookup claim passport observation');
  const claim = exact(root.claim, ['id', 'label', 'state', 'conclusion', 'requiredEvidenceIds', 'missingEvidenceIds', 'requirements', 'limitations'], 'Lookup claim passport claim');
  enumeration(claim.id, LOOKUP_CLAIM_IDS, 'Lookup claim passport claim');
  text(claim.label, 'Lookup claim passport claim label', 160);
  text(claim.conclusion, 'Lookup claim passport claim conclusion', 600);
  const requirements = array(claim.requirements, 'Lookup claim passport requirements', MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS, 1);
  const requirementIds: string[] = [];
  const missingIds: string[] = [];
  const seen = new Set<string>();
  let observedCount = 0;
  let hasLimited = false;
  for (const [index, candidate] of requirements.entries()) {
    const item = exact(candidate, ['id', 'label', 'evidenceId', 'mode', 'state', 'observedAt', 'limitations'], `Lookup claim passport requirement ${index + 1}`);
    const id = enumeration(item.id, LOOKUP_CLAIM_REQUIREMENT_IDS, 'Lookup claim passport requirement id');
    if (seen.has(id)) fail('Lookup claim passport requirements');
    seen.add(id);
    requirementIds.push(id);
    text(item.label, 'Lookup claim passport requirement label', 160);
    if (item.evidenceId !== null && (typeof item.evidenceId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/u.test(item.evidenceId))) fail('Lookup claim passport evidence id');
    enumeration(item.mode, ['network_collection', 'local_review'], 'Lookup claim passport requirement mode');
    const state = enumeration(item.state, CLAIM_PASSPORT_SOURCE_STATES, 'Lookup claim passport requirement state');
    if (state !== 'complete') missingIds.push(id);
    if (state !== 'skipped' && state !== 'unsupported' && state !== 'unknown') observedCount += 1;
    if (state === 'partial' || state === 'unavailable' || state === 'unknown') hasLimited = true;
    iso(item.observedAt, 'Lookup claim passport requirement observedAt', true);
    if (item.evidenceId === null && item.observedAt !== null) fail('Lookup claim passport requirement observedAt');
    strings(item.limitations, 'Lookup claim passport requirement limitations', 8, 400);
  }
  const required = strings(claim.requiredEvidenceIds, 'Lookup claim passport required evidence', MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS, 64);
  const missing = strings(claim.missingEvidenceIds, 'Lookup claim passport missing evidence', MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS, 64);
  if (!sameValues(required, requirementIds) || !sameValues(missing, missingIds)) fail('Lookup claim passport evidence identifiers');
  const expectedState = missingIds.length === 0 ? 'ready' : observedCount > 0 && hasLimited ? 'limited' : 'not_ready';
  if (claim.state !== expectedState) fail('Lookup claim passport claim state');
  strings(claim.limitations, 'Lookup claim passport claim limitations', MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS, 400);
  const models = exact(root.models, ['claimReadiness', 'risk'], 'Lookup claim passport models');
  if (models.claimReadiness !== LOOKUP_CLAIM_READINESS_VERSION) fail('Lookup claim passport models');
  if (models.risk !== null) integer(models.risk, 'Lookup claim passport Risk model', 1, 1_000);
  strings(root.limitations, 'Lookup claim passport limitations', MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS, 600);
  validateIntegrity(root.integrity, 'Lookup claim passport integrity', root.version, LOOKUP_CLAIM_PASSPORT_VERSION);
}

function validateDomainComparison(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'comparison', 'integrity'], 'Domain comparison artefact');
  iso(root.generatedAt, 'Domain comparison generatedAt');
  const comparison = exact(root.comparison, ['version', 'leftDomain', 'rightDomain', 'observedAt', 'freshness', 'rows', 'counts', 'limitations'], 'Domain comparison');
  if (comparison.version !== 3) fail('Domain comparison');
  domain(comparison.leftDomain, 'Domain comparison left domain');
  domain(comparison.rightDomain, 'Domain comparison right domain');
  iso(comparison.observedAt, 'Domain comparison observedAt', true);
  const freshness = exact(comparison.freshness, ['state', 'ageDays'], 'Domain comparison freshness');
  enumeration(freshness.state, ['current', 'stale', 'unknown'], 'Domain comparison freshness');
  if (freshness.ageDays !== null) integer(freshness.ageDays, 'Domain comparison age', 0, 1_000_000);
  const rows = array(comparison.rows, 'Domain comparison rows', DOMAIN_COMPARISON_ROW_IDS.length, DOMAIN_COMPARISON_ROW_IDS.length);
  const counts = exact(comparison.counts, [...COMPARISON_STATES], 'Domain comparison counts');
  const actual = new Map<string, number>(COMPARISON_STATES.map((state) => [state, 0]));
  for (const [index, candidate] of rows.entries()) {
    const row = exact(candidate, ['id', 'category', 'label', 'left', 'right', 'state', 'method', 'source', 'leftSourceState', 'rightSourceState', 'observedAt', 'leftEvidenceHref', 'rightEvidenceHref', 'limitations'], `Domain comparison row ${index + 1}`);
    const id = text(row.id, 'Domain comparison row id', 80);
    if (id !== DOMAIN_COMPARISON_ROW_IDS[index]) fail('Domain comparison row order');
    enumeration(row.category, ['certificate', 'dns', 'identity', 'infrastructure', 'lifecycle', 'mail', 'registration', 'source', 'technology', 'web'], 'Domain comparison category');
    text(row.label, 'Domain comparison label', 120);
    text(row.left, 'Domain comparison left value', 2_000);
    text(row.right, 'Domain comparison right value', 2_000);
    const state = enumeration(row.state, COMPARISON_STATES, 'Domain comparison state');
    actual.set(state, (actual.get(state) ?? 0) + 1);
    text(row.method, 'Domain comparison method', 320);
    text(row.source, 'Domain comparison source', 80);
    enumeration(row.leftSourceState, SOURCE_STATES, 'Domain comparison left source state');
    enumeration(row.rightSourceState, SOURCE_STATES, 'Domain comparison right source state');
    iso(row.observedAt, 'Domain comparison row observedAt', true);
    if (row.observedAt !== comparison.observedAt) fail('Domain comparison row observedAt');
    if (typeof row.leftEvidenceHref !== 'string' || !/^(?:|#bulk-result-\d{1,4})$/u.test(row.leftEvidenceHref)) fail('Domain comparison evidence link');
    if (typeof row.rightEvidenceHref !== 'string' || !/^(?:|#bulk-result-\d{1,4})$/u.test(row.rightEvidenceHref)) fail('Domain comparison evidence link');
    strings(row.limitations, 'Domain comparison row limitations', 6, 320);
  }
  for (const state of COMPARISON_STATES) {
    if (integer(counts[state], `Domain comparison ${state} count`, 0, rows.length) !== actual.get(state)) fail('Domain comparison counts');
  }
  strings(comparison.limitations, 'Domain comparison limitations', 12, 600);
  validateIntegrity(root.integrity, 'Domain comparison integrity', root.version, BULK_DOMAIN_COMPARISON_EXPORT_VERSION);
}

function validateSourceCoverage(value: unknown, label: string): void {
  const source = exact(value, ['source', 'state'], label);
  if (typeof source.source !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/u.test(source.source)) fail(label);
  enumeration(source.state, SOURCE_STATES.filter((state) => state !== 'not_recorded'), label);
}

function validateProfileContext(value: unknown, label: string): void {
  const context = exact(value, ['sourceState', 'activeProfileId', 'profileUpdatedAt', 'limitation'], label);
  enumeration(context.sourceState, ['mixed', 'ready', 'unavailable'], label);
  optionalText(context.activeProfileId, label, 128);
  iso(context.profileUpdatedAt, label, true);
  text(context.limitation, label, 300, true);
}

function validateMailExposure(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'report', 'integrity'], 'Bulk mail exposure artefact');
  const report = exact(root.report, ['version', 'generatedAt', 'observedAt', 'baseline', 'rows', 'counts', 'profileContextUnevaluatedCount', 'limitations'], 'Bulk mail exposure report');
  if (report.version !== 1) fail('Bulk mail exposure report');
  iso(report.generatedAt, 'Bulk mail exposure generatedAt');
  iso(report.observedAt, 'Bulk mail exposure observedAt', true);
  const baseline = exact(report.baseline, ['profile', 'officialDomains', 'label', 'limitations'], 'Bulk mail exposure baseline');
  if (baseline.profile !== null) enumeration(baseline.profile, ['defensive_no_mail', 'parked', 'standard'], 'Bulk mail exposure baseline');
  const officialDomains = strings(baseline.officialDomains, 'Bulk mail exposure official domains', 20, 253);
  officialDomains.forEach((item) => domain(item, 'Bulk mail exposure official domain'));
  text(baseline.label, 'Bulk mail exposure baseline label', 200);
  strings(baseline.limitations, 'Bulk mail exposure baseline limitations', 8, 600);
  const rows = array(report.rows, 'Bulk mail exposure rows', MAX_BULK_MAIL_EXPOSURE_ROWS);
  const counts = exact(report.counts, [...MAIL_STATES], 'Bulk mail exposure counts');
  const actual = new Map<string, number>(MAIL_STATES.map((state) => [state, 0]));
  let unevaluated = 0;
  for (const [index, candidate] of rows.entries()) {
    const row = exact(candidate, ['domain', 'state', 'label', 'detail', 'baselineRelation', 'baselineDetail', 'mutationTypes', 'registration', 'sourceCoverage', 'profileContextState', 'profileContextLimitation', 'limitations'], `Bulk mail exposure row ${index + 1}`);
    domain(row.domain, 'Bulk mail exposure row domain');
    const state = enumeration(row.state, MAIL_STATES, 'Bulk mail exposure row state');
    actual.set(state, (actual.get(state) ?? 0) + 1);
    text(row.label, 'Bulk mail exposure row label', 200);
    text(row.detail, 'Bulk mail exposure row detail', 600);
    enumeration(row.baselineRelation, ['aligned', 'inconclusive', 'review'], 'Bulk mail exposure baseline relation');
    text(row.baselineDetail, 'Bulk mail exposure baseline detail', 600);
    strings(row.mutationTypes, 'Bulk mail exposure mutation types', 40, 120);
    text(row.registration, 'Bulk mail exposure registration', 160, true);
    array(row.sourceCoverage, 'Bulk mail exposure source coverage', 12).forEach((item, sourceIndex) => validateSourceCoverage(item, `Bulk mail exposure source ${sourceIndex + 1}`));
    const profileState = enumeration(row.profileContextState, ['mixed', 'ready', 'unavailable'], 'Bulk mail exposure profile context state');
    if (profileState !== 'ready') unevaluated += 1;
    text(row.profileContextLimitation, 'Bulk mail exposure profile context limitation', 300, true);
    strings(row.limitations, 'Bulk mail exposure row limitations', 6, 600);
  }
  for (const state of MAIL_STATES) {
    if (integer(counts[state], `Bulk mail exposure ${state} count`, 0, rows.length) !== actual.get(state)) fail('Bulk mail exposure counts');
  }
  const declaredUnevaluated = integer(report.profileContextUnevaluatedCount, 'Bulk mail exposure unevaluated count', 0, rows.length);
  if (declaredUnevaluated < unevaluated) fail('Bulk mail exposure unevaluated count');
  strings(report.limitations, 'Bulk mail exposure limitations', 12, 600);
  validateIntegrity(root.integrity, 'Bulk mail exposure integrity', root.version, BULK_MAIL_EXPOSURE_EXPORT_VERSION);
}

function validateBulkView(value: unknown, label: string): void {
  const view = exact(value, ['primaryFilter', 'mutationFilter', 'signalFilters', 'sourceFilter', 'lifecycleFilter', 'ageFilter', 'mailFilter', 'registrarFilter', 'caseDispositionFilter', 'reviewStateFilter', 'groupBy', 'sortKey', 'sortDirection'], label);
  text(view.primaryFilter, label, 60);
  text(view.mutationFilter, label, 60, true);
  strings(view.signalFilters, label, 5, 40);
  text(view.sourceFilter, label, 60, true);
  text(view.lifecycleFilter, label, 60, true);
  text(view.ageFilter, label, 60, true);
  text(view.mailFilter, label, 60, true);
  text(view.registrarFilter, label, 200, true);
  text(view.caseDispositionFilter, label, 60, true);
  enumeration(view.reviewStateFilter, ['', 'unreviewed', 'reviewing', 'reviewed', 'deferred'], label);
  text(view.groupBy, label, 60, true);
  enumeration(view.sortKey, ['domain', 'availability', 'risk', 'opportunity', 'activity', 'registrar', 'mutation'], label);
  if (view.sortDirection !== 1 && view.sortDirection !== -1) fail(label);
}

function validateBulkReviewManifest(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'observedAt', 'lookupProfile', 'selection', 'view', 'rows', 'limitations', 'integrity'], 'Bulk review manifest');
  iso(root.generatedAt, 'Bulk review manifest generatedAt');
  iso(root.observedAt, 'Bulk review manifest observedAt');
  enumeration(root.lookupProfile, ['deep', 'fast'], 'Bulk review manifest lookup profile');
  const selection = exact(root.selection, ['count', 'domains'], 'Bulk review manifest selection');
  const domains = strings(selection.domains, 'Bulk review manifest selected domains', 2_000, 253);
  domains.forEach((item) => domain(item, 'Bulk review manifest selected domain'));
  if (integer(selection.count, 'Bulk review manifest selection count', 0, 2_000) !== domains.length) fail('Bulk review manifest selection');
  validateBulkView(root.view, 'Bulk review manifest view');
  const rows = array(root.rows, 'Bulk review manifest rows', 2_000);
  for (const [index, candidate] of rows.entries()) {
    const row = exact(candidate, ['domain', 'reviewState', 'resultState', 'scanDepth', 'sourceCoverage', 'profileContext'], `Bulk review manifest row ${index + 1}`);
    domain(row.domain, 'Bulk review manifest row domain');
    enumeration(row.reviewState, ['unreviewed', 'reviewing', 'reviewed', 'deferred'], 'Bulk review manifest review state');
    enumeration(row.resultState, ['complete', 'error'], 'Bulk review manifest result state');
    enumeration(row.scanDepth, ['deep', 'fast'], 'Bulk review manifest scan depth');
    array(row.sourceCoverage, 'Bulk review manifest source coverage', 12).forEach((item, sourceIndex) => validateSourceCoverage(item, `Bulk review manifest source ${sourceIndex + 1}`));
    validateProfileContext(row.profileContext, 'Bulk review manifest profile context');
    if (domains[index] !== row.domain) fail('Bulk review manifest selection');
  }
  if (rows.length !== domains.length) fail('Bulk review manifest selection');
  strings(root.limitations, 'Bulk review manifest limitations', 8, 600);
  validateIntegrity(root.integrity, 'Bulk review manifest integrity', root.version, BULK_REVIEW_MANIFEST_VERSION);
}

function validateInvestigationManifest(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'application', 'workflow', 'configuration', 'artifacts', 'steps', 'summary', 'limitations', 'integrity'], 'Investigation manifest');
  iso(root.generatedAt, 'Investigation manifest generatedAt');
  const application = exact(root.application, ['name', 'version'], 'Investigation manifest application');
  if (application.name !== 'WHOISleuth CLI' || typeof application.version !== 'string'
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(application.version)) fail('Investigation manifest application');
  text(root.workflow, 'Investigation manifest workflow', 160);
  const configuration = exact(root.configuration, ['digestSha256'], 'Investigation manifest configuration');
  if (configuration.digestSha256 !== null) digest(configuration.digestSha256, 'Investigation manifest configuration');
  const artifacts = array(root.artifacts, 'Investigation manifest artifacts', MAX_INVESTIGATION_MANIFEST_ARTIFACTS, 1);
  const steps = array(root.steps, 'Investigation manifest steps', MAX_INVESTIGATION_MANIFEST_ARTIFACTS, 1);
  let totalBytes = 0;
  for (const [index, candidate] of artifacts.entries()) {
    const item = exact(candidate, ['sequence', 'id', 'schema', 'version', 'byteLength', 'contentDigestSha256', 'canonicalDigestSha256'], `Investigation manifest artifact ${index + 1}`);
    if (integer(item.sequence, 'Investigation manifest artifact sequence', 1, artifacts.length) !== index + 1
      || item.id !== `artifact-${index + 1}`) fail('Investigation manifest artifact order');
    if (item.schema !== null) text(item.schema, 'Investigation manifest artifact schema', 160);
    if (item.version !== null) integer(item.version, 'Investigation manifest artifact version', 1, 1_000);
    totalBytes += integer(item.byteLength, 'Investigation manifest artifact bytes', 1, 15 * 1024 * 1024);
    digest(item.contentDigestSha256, 'Investigation manifest content digest');
    digest(item.canonicalDigestSha256, 'Investigation manifest canonical digest');
    const step = exact(steps[index], ['sequence', 'artifactId', 'contentDigestSha256'], `Investigation manifest step ${index + 1}`);
    if (step.sequence !== item.sequence || step.artifactId !== item.id || step.contentDigestSha256 !== item.contentDigestSha256) fail('Investigation manifest step linkage');
  }
  const summary = exact(root.summary, ['artifactCount', 'totalBytes'], 'Investigation manifest summary');
  if (integer(summary.artifactCount, 'Investigation manifest artifact count', 1, MAX_INVESTIGATION_MANIFEST_ARTIFACTS) !== artifacts.length
    || integer(summary.totalBytes, 'Investigation manifest total bytes', 1, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES) !== totalBytes) fail('Investigation manifest summary');
  strings(root.limitations, 'Investigation manifest limitations', 8, 600);
  validateIntegrity(root.integrity, 'Investigation manifest integrity', root.version, INVESTIGATION_MANIFEST_VERSION);
}

function validateReviewMatrix(value: unknown, label: string): void {
  for (const [rowIndex, candidate] of array(value, label, 500).entries()) {
    const row = exact(candidate, ['owner', 'type', 'state', 'observations'], `${label} row ${rowIndex + 1}`);
    text(row.owner, `${label} owner`, 253);
    enumeration(row.type, DNS_TYPES, `${label} type`);
    const observations = array(row.observations, `${label} observations`, 16);
    let complete = 0;
    const signatures = new Set<string>();
    for (const observationCandidate of observations) {
      const observation = exact(observationCandidate, ['label', 'source', 'state', 'values', 'ttlRange'], `${label} observation`);
      text(observation.label, `${label} observation label`, 120);
      text(observation.source, `${label} observation source`, 240);
      const state = enumeration(observation.state, ['observed', 'partial', 'unavailable'], `${label} observation state`);
      const values = strings(observation.values, `${label} observation values`, 500, 16_384);
      if (state === 'observed') { complete += 1; signatures.add(JSON.stringify(values)); }
      if (observation.ttlRange !== null) {
        const range = exact(observation.ttlRange, ['minimum', 'maximum'], `${label} TTL range`);
        const minimum = integer(range.minimum, `${label} minimum TTL`, 0, 0x7fff_ffff);
        const maximum = integer(range.maximum, `${label} maximum TTL`, minimum, 0x7fff_ffff);
        if (maximum < minimum) fail(`${label} TTL range`);
      }
    }
    const expected = complete < 2 ? 'insufficient' : signatures.size === 1 ? 'aligned' : 'different';
    if (row.state !== expected) fail(`${label} state`);
  }
}

function validateDomainChangeReview(value: unknown, label: string): UnknownRecord {
  const review = exact(value, ['schema', 'version', 'generatedAt', 'domain', 'state', 'authoritativeRecordMatrix', 'resolverDivergenceMatrix', 'dnssecAutomation', 'acmeDependencies', 'certificate', 'services', 'hsts', 'gate', 'limitations'], label);
  if (review.schema !== 'whoisleuth.domain-change.review' || review.version !== 1) fail(label);
  iso(review.generatedAt, `${label} generatedAt`);
  domain(review.domain, `${label} domain`);
  enumeration(review.state, ['ready', 'review'], `${label} state`);
  validateReviewMatrix(review.authoritativeRecordMatrix, `${label} authority matrix`);
  validateReviewMatrix(review.resolverDivergenceMatrix, `${label} resolver matrix`);
  const automation = exact(review.dnssecAutomation, ['state', 'cdsObserved', 'cdnskeyObserved', 'csyncObserved', 'conflictingTypes', 'detail'], `${label} DNSSEC automation`);
  enumeration(automation.state, ['not_observed', 'conflict', 'partial', 'review_ready'], `${label} DNSSEC automation`);
  boolean(automation.cdsObserved, `${label} CDS observed`);
  boolean(automation.cdnskeyObserved, `${label} CDNSKEY observed`);
  boolean(automation.csyncObserved, `${label} CSYNC observed`);
  strings(automation.conflictingTypes, `${label} conflicting types`, 3, 16).forEach((item) => enumeration(item, ['CDS', 'CDNSKEY', 'CSYNC'], `${label} conflicting type`));
  text(automation.detail, `${label} DNSSEC detail`, 600);
  for (const candidate of array(review.acmeDependencies, `${label} ACME dependencies`, 64)) {
    const dependency = exact(candidate, ['method', 'owner', 'target', 'provider', 'state'], `${label} ACME dependency`);
    enumeration(dependency.method, ['dns-01', 'http-01', 'tls-alpn-01'], `${label} ACME method`);
    text(dependency.owner, `${label} ACME owner`, 253);
    optionalText(dependency.target, `${label} ACME target`, 253);
    optionalText(dependency.provider, `${label} ACME provider`, 120);
    enumeration(dependency.state, ['confirmed', 'partial', 'unknown'], `${label} ACME state`);
  }
  const certificate = exact(review.certificate, ['state', 'continuity', 'findings'], `${label} certificate`);
  enumeration(certificate.state, ['not_supplied', 'observed', 'partial', 'unavailable'], `${label} certificate state`);
  enumeration(certificate.continuity, ['unknown', 'retained', 'changes'], `${label} certificate continuity`);
  strings(certificate.findings, `${label} certificate findings`, 8, 600);
  for (const candidate of array(review.services, `${label} services`, 1_000)) {
    const service = exact(candidate, ['owner', 'value', 'source', 'state', 'observedAt'], `${label} service`);
    text(service.owner, `${label} service owner`, 253);
    text(service.value, `${label} service value`, 16_384);
    text(service.source, `${label} service source`, 240);
    enumeration(service.state, ['observed', 'partial', 'unavailable'], `${label} service state`);
    iso(service.observedAt, `${label} service observedAt`);
  }
  if (review.hsts !== null) {
    const hsts = exact(review.hsts, ['state', 'observedAt', 'header', 'preloadState', 'source'], `${label} HSTS`);
    enumeration(hsts.state, ['observed', 'partial', 'unavailable'], `${label} HSTS state`);
    iso(hsts.observedAt, `${label} HSTS observedAt`);
    optionalText(hsts.header, `${label} HSTS header`, 1_024);
    enumeration(hsts.preloadState, ['listed', 'not_listed', 'unavailable'], `${label} HSTS preload`);
    text(hsts.source, `${label} HSTS source`, 240);
  }
  const gate = exact(review.gate, ['pass', 'reasons'], `${label} gate`);
  boolean(gate.pass, `${label} gate`);
  const reasons = strings(gate.reasons, `${label} gate reasons`, 2_000, 600);
  if (gate.pass !== (reasons.length === 0) || review.state !== (gate.pass ? 'ready' : 'review')) fail(`${label} gate`);
  strings(review.limitations, `${label} limitations`, 8, 600);
  return review;
}

function validatePlannedAssurance(value: unknown, label: string): UnknownRecord {
  const assurance = exact(value, ['schema', 'version', 'generatedAt', 'result', 'limitations'], label);
  if (assurance.schema !== 'whoisleuth.domain-assurance' || assurance.version !== 2) fail(label);
  iso(assurance.generatedAt, `${label} generatedAt`);
  const result = exact(assurance.result, ['kind', 'domain', 'reference', 'window', 'milestones', 'rollbackCriteria', 'postChangeChecks', 'review'], `${label} result`);
  if (result.kind !== 'planned-change') fail(`${label} result`);
  domain(result.domain, `${label} domain`);
  text(result.reference, `${label} reference`, 120);
  const window = exact(result.window, ['startsAt', 'endsAt'], `${label} window`);
  iso(window.startsAt, `${label} startsAt`);
  iso(window.endsAt, `${label} endsAt`);
  if (Date.parse(window.endsAt as string) <= Date.parse(window.startsAt as string)) fail(`${label} window`);
  const ids = new Set<string>();
  for (const candidate of array(result.milestones, `${label} milestones`, 24, 1)) {
    const item = exact(candidate, ['id', 'label', 'expectedBy', 'evidenceSource', 'state', 'observedAt', 'evidenceReference'], `${label} milestone`);
    const id = text(item.id, `${label} milestone id`, 64);
    if (ids.has(id)) fail(`${label} item ids`); ids.add(id);
    text(item.label, `${label} milestone label`, 180);
    iso(item.expectedBy, `${label} milestone expectedBy`);
    text(item.evidenceSource, `${label} milestone source`, 120);
    const state = enumeration(item.state, ['missed', 'not_checked', 'observed', 'planned'], `${label} milestone state`);
    iso(item.observedAt, `${label} milestone observedAt`, true);
    optionalText(item.evidenceReference, `${label} milestone reference`, 300);
    if (['observed', 'missed'].includes(state) !== (item.observedAt !== null && item.evidenceReference !== null)) fail(`${label} milestone evidence`);
  }
  for (const candidate of array(result.rollbackCriteria, `${label} rollback criteria`, 16, 1)) {
    const item = exact(candidate, ['id', 'condition', 'owner', 'state'], `${label} rollback criterion`);
    const id = text(item.id, `${label} rollback id`, 64);
    if (ids.has(id)) fail(`${label} item ids`); ids.add(id);
    text(item.condition, `${label} rollback condition`, 240);
    text(item.owner, `${label} rollback owner`, 120);
    enumeration(item.state, ['met', 'not_checked', 'not_met'], `${label} rollback state`);
  }
  for (const candidate of array(result.postChangeChecks, `${label} post-change checks`, 24, 1)) {
    const item = exact(candidate, ['id', 'label', 'expectedState', 'evidenceSource', 'state', 'evidenceReference'], `${label} post-change check`);
    const id = text(item.id, `${label} post-change id`, 64);
    if (ids.has(id)) fail(`${label} item ids`); ids.add(id);
    text(item.label, `${label} post-change label`, 180);
    text(item.expectedState, `${label} expected state`, 240);
    text(item.evidenceSource, `${label} post-change source`, 120);
    const state = enumeration(item.state, ['matched', 'not_checked', 'unexpected'], `${label} post-change state`);
    optionalText(item.evidenceReference, `${label} post-change reference`, 300);
    if ((state === 'not_checked') !== (item.evidenceReference === null)) fail(`${label} post-change evidence`);
  }
  const review = exact(result.review, ['state', 'reasons'], `${label} review`);
  enumeration(review.state, ['incomplete', 'needs_review', 'ready'], `${label} review state`);
  const reasons = strings(review.reasons, `${label} review reasons`, 20, 600);
  if ((review.state === 'ready') !== (reasons.length === 0)) fail(`${label} review`);
  strings(assurance.limitations, `${label} limitations`, 8, 600);
  return assurance;
}

function expectedDomainChangeSummary(
  before: UnknownRecord,
  after: UnknownRecord,
): Array<Readonly<{ owner: string; type: string; beforeValues: string[]; afterValues: string[] }>> {
  const rows = (review: UnknownRecord) => new Map(
    (review.authoritativeRecordMatrix as UnknownRecord[]).map((row) => [`${row.owner}\u0000${row.type}`, row]),
  );
  const beforeRows = rows(before);
  const afterRows = rows(after);
  const keys = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort();
  return keys.slice(0, 500).flatMap((key) => {
    const left = beforeRows.get(key);
    const right = afterRows.get(key);
    const values = (row: UnknownRecord | undefined) => [...new Set(
      ((row?.observations as UnknownRecord[] | undefined) ?? [])
        .flatMap((observation) => observation.values as string[]),
    )].sort();
    const beforeValues = values(left);
    const afterValues = values(right);
    if (sameValues(beforeValues, afterValues)) return [];
    const [owner, type] = key.split('\u0000');
    return [{ owner: owner ?? '', type: type ?? '', beforeValues, afterValues }];
  });
}

function validateDomainChangePacket(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'domain', 'reference', 'state', 'gate', 'summary', 'evidence', 'limitations', 'integrity'], 'Domain change packet');
  iso(root.generatedAt, 'Domain change packet generatedAt');
  domain(root.domain, 'Domain change packet domain');
  text(root.reference, 'Domain change packet reference', 200);
  enumeration(root.state, ['ready', 'review'], 'Domain change packet state');
  const gate = exact(root.gate, ['pass', 'reasons'], 'Domain change packet gate');
  boolean(gate.pass, 'Domain change packet gate');
  const gateReasons = strings(gate.reasons, 'Domain change packet gate reasons', 100, 700);
  if (gate.pass !== (gateReasons.length === 0) || root.state !== (gate.pass ? 'ready' : 'review')) fail('Domain change packet gate');
  const summary = exact(root.summary, ['changedAuthoritativeRecordSets', 'preChangeState', 'postChangeState', 'assuranceState'], 'Domain change packet summary');
  const changed = array(summary.changedAuthoritativeRecordSets, 'Domain change packet changes', 500);
  for (const candidate of changed) {
    const item = exact(candidate, ['owner', 'type', 'beforeValues', 'afterValues'], 'Domain change packet changed record set');
    text(item.owner, 'Domain change packet changed owner', 253);
    enumeration(item.type, DNS_TYPES, 'Domain change packet changed type');
    strings(item.beforeValues, 'Domain change packet before values', 500, 16_384);
    strings(item.afterValues, 'Domain change packet after values', 500, 16_384);
  }
  enumeration(summary.preChangeState, ['ready', 'review'], 'Domain change packet pre-change state');
  enumeration(summary.postChangeState, ['ready', 'review'], 'Domain change packet post-change state');
  enumeration(summary.assuranceState, ['incomplete', 'needs_review', 'ready'], 'Domain change packet assurance state');
  const evidence = exact(root.evidence, ['preChange', 'postChange', 'assurance'], 'Domain change packet evidence');
  const pre = validateDomainChangeReview(evidence.preChange, 'Domain change packet pre-change review');
  const post = validateDomainChangeReview(evidence.postChange, 'Domain change packet post-change review');
  const assurance = validatePlannedAssurance(evidence.assurance, 'Domain change packet assurance');
  const assuranceResult = assurance.result as UnknownRecord;
  if (pre.generatedAt !== root.generatedAt || post.generatedAt !== root.generatedAt || assurance.generatedAt !== root.generatedAt
    || pre.domain !== root.domain || post.domain !== root.domain || assuranceResult.domain !== root.domain
    || pre.state !== summary.preChangeState || post.state !== summary.postChangeState
    || (assuranceResult.review as UnknownRecord).state !== summary.assuranceState) fail('Domain change packet evidence linkage');
  const expectedReasons = [
    ...(pre.gate as UnknownRecord).reasons as string[],
  ].map((reason) => `Pre-change evidence: ${reason}`);
  expectedReasons.push(
    ...((post.gate as UnknownRecord).reasons as string[]).map((reason) => `Post-change evidence: ${reason}`),
    ...(((assuranceResult.review as UnknownRecord).reasons as string[]).map((reason) => `Change plan: ${reason}`)),
  );
  const boundedReasons = expectedReasons.slice(0, 100);
  if (!sameValues(gateReasons, boundedReasons)
    || gate.pass !== (boundedReasons.length === 0)
    || root.state !== (boundedReasons.length === 0 ? 'ready' : 'review')) fail('Domain change packet gate');
  const expectedChanges = expectedDomainChangeSummary(pre, post);
  if (changed.length !== expectedChanges.length || changed.some((candidate, index) => {
    const item = candidate as UnknownRecord;
    const expected = expectedChanges[index]!;
    return item.owner !== expected.owner || item.type !== expected.type
      || !sameValues(item.beforeValues as unknown[], expected.beforeValues)
      || !sameValues(item.afterValues as unknown[], expected.afterValues);
  })) fail('Domain change packet summary');
  strings(root.limitations, 'Domain change packet limitations', 8, 600);
  validateIntegrity(root.integrity, 'Domain change packet integrity', root.version, DOMAIN_CHANGE_PACKET_VERSION);
}

export function validateSignedDigestArtifactStructure(schema: string, value: UnknownRecord): void {
  if (value.schema !== schema) fail('Signed review artefact');
  if (schema === ACQUISITION_DECISION_PACKET_SCHEMA) validateAcquisition(value);
  else if (schema === LOOKUP_CLAIM_PASSPORT_SCHEMA) validateLookupClaimPassport(value);
  else if (schema === BULK_DOMAIN_COMPARISON_SCHEMA) validateDomainComparison(value);
  else if (schema === BULK_MAIL_EXPOSURE_SCHEMA) validateMailExposure(value);
  else if (schema === BULK_REVIEW_MANIFEST_SCHEMA) validateBulkReviewManifest(value);
  else if (schema === DOMAIN_CONTROL_MANIFEST_SCHEMA) {
    try { normalizeDomainControlManifestDocument(value); } catch { fail('Domain control manifest'); }
  }
  else if (schema === DOMAIN_CHANGE_PACKET_SCHEMA) validateDomainChangePacket(value);
  else if (schema === INVESTIGATION_MANIFEST_SCHEMA) validateInvestigationManifest(value);
  else fail('Signed review artefact');
}
