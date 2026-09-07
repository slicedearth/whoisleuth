export const CRITICAL_MUTATION_MANIFEST_VERSION = 1;
export const MAX_CRITICAL_MUTANTS = 12;
export const MAX_CRITICAL_MUTATION_TEXT_BYTES = 2_048;
export const MAX_CRITICAL_MUTATION_TIMEOUT_MS = 30_000;
export const MAX_CRITICAL_MUTATION_OUTPUT_BYTES = 64 * 1024;

export type CriticalMutant = Readonly<{
  id: string;
  area:
    | 'authority_availability'
    | 'schema_refusal'
    | 'privacy_projection'
    | 'missing_evidence_scoring'
    | 'unreviewed_evidence_scoring'
    | 'public_address_enforcement'
    | 'artifact_structure_integrity'
    | 'local_mutation_outcome'
    | 'evidence_completeness'
    | 'protocol_null_mx'
    | 'observation_time_order'
    | 'comparison_source_qualification';
  file: string;
  search: string;
  replacement: string;
  focusedTests: readonly string[];
  timeoutMs: number;
}>;

export function assertUniqueCriticalMutationPattern(source: string, search: string, label = 'Critical mutation'): void {
  const offset = search ? source.indexOf(search) : -1;
  if (offset < 0 || source.indexOf(search, offset + 1) !== -1) {
    throw new TypeError(`${label} must match one unique source pattern.`);
  }
}

export const CRITICAL_MUTATION_MANIFEST: readonly CriticalMutant[] = Object.freeze([
  Object.freeze({
    id: 'authority-dns-delegation-required',
    area: 'authority_availability',
    file: 'lib/availability.mts',
    search: 'if (!rdapFound && !hasWhoisRegistrationData && !dnsDelegated) {',
    replacement: 'if (!rdapFound && !hasWhoisRegistrationData) {',
    focusedTests: Object.freeze(['test/availability-dns.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'schema-future-version-descriptor-refusal',
    area: 'schema_refusal',
    file: 'packages/contracts/schema-lifecycle.mts',
    search: '          : contract.futureVersionBehaviour !== descriptor.futureVersionBehavior)\n',
    replacement: '          : false)\n',
    focusedTests: Object.freeze(['test/schema-lifecycle-v4.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'privacy-notes-require-opt-in',
    area: 'privacy_projection',
    file: 'packages/cases/case-report.mts',
    search: '  const includeNotes = options.includeNotes === true;',
    replacement: '  const includeNotes = true;',
    focusedTests: Object.freeze(['test/case-report.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'scoring-missing-coverage-stays-unknown',
    area: 'missing_evidence_scoring',
    file: 'lib/scoring-evidence-quality.mts',
    search: "  if (!coverage.length || depth === 'unknown') state = 'unknown';",
    replacement: "  if (depth === 'unknown') state = 'unknown';",
    focusedTests: Object.freeze(['test/scoring.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'scoring-unreviewed-page-match-remains-neutral',
    area: 'unreviewed_evidence_scoring',
    file: 'lib/risk-scoring.mts',
    search: '  includePageBaselineMatch: false,',
    replacement: '  includePageBaselineMatch: true,',
    focusedTests: Object.freeze(['test/scoring.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'ssrf-unrecognised-literal-fails-closed',
    area: 'public_address_enforcement',
    file: 'lib/safe-fetch.mts',
    search: '  return true; // not a recognizable IP literal - fail closed',
    replacement: '  return false; // mutant must be killed by fail-closed regression coverage',
    focusedTests: Object.freeze(['test/safe-fetch.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'artifact-projection-count-matches-items',
    area: 'artifact_structure_integrity',
    file: 'cli/artifact-validation/investigation-capsule.mts',
    search: '  if (displayed > total || omitted !== total - displayed || items.length !== displayed) fail(label);',
    replacement: '  if (displayed > total || omitted !== total - displayed) fail(label);',
    focusedTests: Object.freeze(['test/artifact-verify.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'local-mutation-draft-requires-commit',
    area: 'local_mutation_outcome',
    file: 'frontend/src/lib/local-mutation-outcome.ts',
    search: "  return outcome === 'committed';",
    replacement: '  return true;',
    focusedTests: Object.freeze(['test/local-mutation-outcome.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'domain-change-requires-complete-evidence',
    area: 'evidence_completeness',
    file: 'lib/domain-change-packet.mts',
    search: "    if (beforeEvidence.state !== 'complete' || afterEvidence.state !== 'complete') {",
    replacement: "    if (beforeEvidence.state !== 'complete' && afterEvidence.state !== 'complete') {",
    focusedTests: Object.freeze(['test/domain-change-packet.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'null-mx-requires-zero-preference',
    area: 'protocol_null_mx',
    file: 'lib/zone-intent-review.mts',
    search: "    if (exchangeToken === '.' && preference !== 0) throw new TypeError('A Null MX exchange must use preference 0.');",
    replacement: "    if (false) throw new TypeError('A Null MX exchange must use preference 0.');",
    focusedTests: Object.freeze(['test/zone-intent-review.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'observation-cannot-follow-review',
    area: 'observation_time_order',
    file: 'tools/maintainer-tool-helpers.mts',
    search: '  if (Date.parse(observedAt) > Date.parse(reviewedAt)) {',
    replacement: '  if (false) {',
    focusedTests: Object.freeze(['test/technology-fixture-review.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'comparison-requires-complete-sources',
    area: 'comparison_source_qualification',
    file: 'packages/comparison/comparison-ledger-bulk.mts',
    search: '  if (!completeBulkSourceState(earlierState) || !completeBulkSourceState(laterState)) {',
    replacement: '  if (false) {',
    focusedTests: Object.freeze(['test/comparison-ledger.test.mts']),
    timeoutMs: 20_000,
  }),
]);
