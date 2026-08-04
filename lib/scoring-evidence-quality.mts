export const SCORE_EVIDENCE_QUALITY_VERSION = 1;

const MAX_SOURCES = 24;
const MAX_FAMILIES = 12;
const SOURCE_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/u;
const COMPLETE_STATES = new Set(['complete', 'not_found', 'success']);
const LIMITED_STATES = new Set(['partial', 'unknown']);
const UNAVAILABLE_STATES = new Set(['error', 'rate_limited', 'unavailable']);
const SKIPPED_STATES = new Set(['skipped', 'unsupported']);
const ACCEPTED_SOURCE_STATES = new Set([
  ...COMPLETE_STATES,
  ...LIMITED_STATES,
  ...UNAVAILABLE_STATES,
  ...SKIPPED_STATES,
]);

export type ScoreEvidenceQualityState = 'complete' | 'limited' | 'partial' | 'unknown';
export type ScoreEvidenceFreshness = 'observed' | 'unknown';
export type ScoreEvidenceQuality = Readonly<{
  version: typeof SCORE_EVIDENCE_QUALITY_VERSION;
  state: ScoreEvidenceQualityState;
  scanDepth: 'deep' | 'fast' | 'unknown';
  freshness: ScoreEvidenceFreshness;
  completeSources: number;
  limitedSources: number;
  unavailableSources: number;
  skippedSources: number;
  observedFamilies: readonly string[];
  missingFamilies: readonly string[];
  limitations: readonly string[];
}>;

export type ScoreEvidenceQualityInput = Readonly<{
  scanDepth?: unknown;
  observedAt?: unknown;
  sourceCoverage?: unknown;
}>;

type SourceCoverage = Readonly<{ source: string; state: string }>;

function boundedFamilyList(value: readonly string[]): string[] {
  const output = new Set<string>();
  for (const item of value.slice(0, MAX_FAMILIES * 2)) {
    const normalized = String(item).trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').slice(0, 64);
    if (SOURCE_ID_RE.test(normalized)) output.add(normalized);
    if (output.size >= MAX_FAMILIES) break;
  }
  return [...output].sort();
}

function sourceCoverage(value: unknown): SourceCoverage[] {
  if (!Array.isArray(value)) return [];
  const output: SourceCoverage[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, MAX_SOURCES * 4)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const source = typeof item.source === 'string' ? item.source.trim().toLowerCase() : '';
    const state = typeof item.state === 'string' ? item.state.trim().toLowerCase() : '';
    if (!SOURCE_ID_RE.test(source) || seen.has(source)) continue;
    if (!ACCEPTED_SOURCE_STATES.has(state)) continue;
    seen.add(source);
    output.push({ source, state });
    if (output.length >= MAX_SOURCES) break;
  }
  return output;
}

function scanDepth(value: unknown): 'deep' | 'fast' | 'unknown' {
  return value === 'deep' || value === 'fast' ? value : 'unknown';
}

function observedFreshness(value: unknown): ScoreEvidenceFreshness {
  if (typeof value !== 'string' || value.length > 64) return 'unknown';
  return Number.isFinite(Date.parse(value)) ? 'observed' : 'unknown';
}

export function buildScoreEvidenceQuality(
  input: ScoreEvidenceQualityInput,
  options: Readonly<{
    expectedDepth: 'deep' | 'fast';
    observedFamilies?: readonly string[];
    expectedFamilies?: readonly string[];
  }>,
): ScoreEvidenceQuality {
  const depth = scanDepth(input.scanDepth);
  const coverage = sourceCoverage(input.sourceCoverage);
  const completeSources = coverage.filter((item) => COMPLETE_STATES.has(item.state)).length;
  const limitedSources = coverage.filter((item) => LIMITED_STATES.has(item.state)).length;
  const unavailableSources = coverage.filter((item) => UNAVAILABLE_STATES.has(item.state)).length;
  const skippedSources = coverage.filter((item) => SKIPPED_STATES.has(item.state)).length;
  const observedFamilies = boundedFamilyList(options.observedFamilies ?? []);
  const expectedFamilies = boundedFamilyList(options.expectedFamilies ?? []);
  const observedSet = new Set(observedFamilies);
  const missingFamilies = expectedFamilies.filter((family) => !observedSet.has(family));
  const limitations: string[] = [];

  let state: ScoreEvidenceQualityState = 'complete';
  if (!coverage.length || depth === 'unknown') state = 'unknown';
  else if (unavailableSources || limitedSources) state = 'partial';
  else if (options.expectedDepth === 'deep' && depth !== 'deep') state = 'limited';
  if (missingFamilies.length && state === 'complete') state = 'limited';

  if (options.expectedDepth === 'deep' && depth !== 'deep') {
    limitations.push('A fast or unknown-depth observation does not evaluate every website and mail scoring family.');
  }
  if (limitedSources || unavailableSources) {
    limitations.push('One or more score-relevant sources were partial, unavailable, or indeterminate.');
  }
  if (skippedSources) {
    limitations.push('One or more reported sources were skipped or unsupported and did not contribute to the score.');
  }
  if (!coverage.length) limitations.push('Source-level coverage was not supplied with this score.');
  if (missingFamilies.length) limitations.push(`No usable observation was supplied for: ${missingFamilies.join(', ')}.`);
  const boundedLimitations = [
    ...limitations.slice(0, 5),
    'Evidence coverage qualifies the score; it never adds points or turns missing evidence into a negative finding.',
  ];

  return Object.freeze({
    version: SCORE_EVIDENCE_QUALITY_VERSION,
    state,
    scanDepth: depth,
    freshness: observedFreshness(input.observedAt),
    completeSources,
    limitedSources,
    unavailableSources,
    skippedSources,
    observedFamilies: Object.freeze(observedFamilies),
    missingFamilies: Object.freeze(missingFamilies),
    limitations: Object.freeze(boundedLimitations),
  });
}
