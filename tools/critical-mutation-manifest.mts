export const CRITICAL_MUTATION_MANIFEST_VERSION = 1;
export const MAX_CRITICAL_MUTANTS = 12;
export const MAX_CRITICAL_MUTATION_TEXT_BYTES = 2_048;
export const MAX_CRITICAL_MUTATION_TIMEOUT_MS = 30_000;
export const MAX_CRITICAL_MUTATION_OUTPUT_BYTES = 64 * 1024;

export type CriticalMutant = Readonly<{
  id: string;
  area: 'authority_availability' | 'schema_refusal' | 'privacy_projection' | 'missing_evidence_scoring' | 'unreviewed_evidence_scoring' | 'public_address_enforcement' | 'artifact_structure_integrity';
  file: string;
  line: number;
  search: string;
  replacement: string;
  focusedTests: readonly string[];
  timeoutMs: number;
}>;

export const CRITICAL_MUTATION_MANIFEST: readonly CriticalMutant[] = Object.freeze([
  Object.freeze({
    id: 'authority-dns-delegation-required',
    area: 'authority_availability',
    file: 'lib/availability.mts',
    line: 611,
    search: 'if (!rdapFound && !hasWhoisRegistrationData && !dnsDelegated) {',
    replacement: 'if (!rdapFound && !hasWhoisRegistrationData) {',
    focusedTests: Object.freeze(['test/availability-dns.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'schema-future-version-descriptor-refusal',
    area: 'schema_refusal',
    file: 'packages/contracts/schema-lifecycle.mts',
    line: 1449,
    search: '          : contract.futureVersionBehaviour !== descriptor.futureVersionBehavior)\n',
    replacement: '          : false)\n',
    focusedTests: Object.freeze(['test/schema-lifecycle-v4.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'privacy-notes-require-opt-in',
    area: 'privacy_projection',
    file: 'packages/cases/case-report.mts',
    line: 248,
    search: '  const includeNotes = options.includeNotes === true;',
    replacement: '  const includeNotes = true;',
    focusedTests: Object.freeze(['test/case-report.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'scoring-missing-coverage-stays-unknown',
    area: 'missing_evidence_scoring',
    file: 'lib/scoring-evidence-quality.mts',
    line: 99,
    search: "  if (!coverage.length || depth === 'unknown') state = 'unknown';",
    replacement: "  if (depth === 'unknown') state = 'unknown';",
    focusedTests: Object.freeze(['test/scoring.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'scoring-unreviewed-page-match-remains-neutral',
    area: 'unreviewed_evidence_scoring',
    file: 'lib/risk-scoring.mts',
    line: 86,
    search: '  includePageBaselineMatch: false,',
    replacement: '  includePageBaselineMatch: true,',
    focusedTests: Object.freeze(['test/scoring.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'ssrf-unrecognised-literal-fails-closed',
    area: 'public_address_enforcement',
    file: 'lib/safe-fetch.mts',
    line: 212,
    search: '  return true; // not a recognizable IP literal - fail closed',
    replacement: '  return false; // mutant must be killed by fail-closed regression coverage',
    focusedTests: Object.freeze(['test/safe-fetch.test.mts']),
    timeoutMs: 20_000,
  }),
  Object.freeze({
    id: 'artifact-projection-count-matches-items',
    area: 'artifact_structure_integrity',
    file: 'cli/artifact-validation/investigation-capsule.mts',
    line: 151,
    search: '  if (displayed > total || omitted !== total - displayed || items.length !== displayed) fail(label);',
    replacement: '  if (displayed > total || omitted !== total - displayed) fail(label);',
    focusedTests: Object.freeze(['test/artifact-verify.test.mts']),
    timeoutMs: 20_000,
  }),
]);
