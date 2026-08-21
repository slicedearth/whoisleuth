// Dependency-neutral canonical Decision Fact v1 model. Facts remain a bounded
// derived runtime model; the separately versioned projection is the portable
// nested contract used by decision-surface exports.

export const DECISION_FACT_VERSION = 1 as const;
export const MAX_DECISION_FACTS = 40;
export const MAX_DECISION_FACT_CONTRIBUTORS = 24;
export const MAX_DECISION_FACT_REFERENCES = 24;
export const MAX_DECISION_FACT_CONTRADICTIONS = 16;
export const MAX_DECISION_FACT_LIMITATIONS = 8;
export const MAX_DECISION_FACT_NEXT_ACTIONS = 6;
export const DECISION_FACT_PROJECTION_VERSION = 1 as const;
export const MAX_DECISION_FACT_PROJECTION_FACTS = 12;
export const MAX_DECISION_FACT_PROJECTION_SOURCES = 8;
export const MAX_DECISION_FACT_PROJECTION_REFERENCES = 12;
export const MAX_DECISION_FACT_PROJECTION_SOURCE_REFERENCES = 6;
export const MAX_DECISION_FACT_PROJECTION_SOURCE_LIMITATIONS = 4;
export const MAX_DECISION_FACT_PROJECTION_CONTRADICTIONS = 8;
export const MAX_DECISION_FACT_PROJECTION_LIMITATIONS = 8;
export const MAX_DECISION_FACT_PROJECTION_NEXT_ACTIONS = 4;
export const MAX_DECISION_FACT_PROJECTION_BYTES = 48 * 1024;

export type DecisionFactEvidenceState =
  | 'observed'
  | 'not_observed_in_bounded_evidence'
  | 'not_collected'
  | 'partial'
  | 'unsupported'
  | 'unavailable'
  | 'unknown';

export type DecisionFactFreshness = 'current' | 'stale' | 'unknown' | 'not_applicable';
export type DecisionFactConsistency = 'consistent' | 'contradictory' | 'unknown' | 'not_applicable';
export type DecisionFactProvenance = 'direct_observation' | 'provider_reported' | 'analyst_supplied' | 'derived';
export type DecisionFactImportance = 'high' | 'medium' | 'low';
export type DecisionFactCompleteness =
  | 'complete'
  | 'partial'
  | 'not_collected'
  | 'unsupported'
  | 'unavailable'
  | 'unknown';
export type DecisionFactPresentationTone = 'neutral' | 'caution' | 'conflict';
export type DecisionFactPresentationIcon =
  | 'evidence-observed'
  | 'bounded-non-observation'
  | 'collection-not-run'
  | 'evidence-limited'
  | 'source-unsupported'
  | 'source-unavailable'
  | 'state-unknown'
  | 'observation-current'
  | 'observation-stale'
  | 'state-not-applicable'
  | 'source-agreement'
  | 'source-disagreement'
  | 'evidence-direct'
  | 'evidence-reported'
  | 'evidence-analyst-supplied'
  | 'evidence-derived';

export type DecisionFactPresentationDescriptor = Readonly<{
  label: string;
  explanation: string;
  tone: DecisionFactPresentationTone;
  icon: DecisionFactPresentationIcon;
  assistiveText: string;
}>;

export const DECISION_FACT_EVIDENCE_STATES = Object.freeze([
  'observed',
  'not_observed_in_bounded_evidence',
  'not_collected',
  'partial',
  'unsupported',
  'unavailable',
  'unknown',
] as const satisfies readonly DecisionFactEvidenceState[]);

export const DECISION_FACT_FRESHNESS_STATES = Object.freeze([
  'current',
  'stale',
  'unknown',
  'not_applicable',
] as const satisfies readonly DecisionFactFreshness[]);

export const DECISION_FACT_CONSISTENCY_STATES = Object.freeze([
  'consistent',
  'contradictory',
  'unknown',
  'not_applicable',
] as const satisfies readonly DecisionFactConsistency[]);

export const DECISION_FACT_PROVENANCE_STATES = Object.freeze([
  'direct_observation',
  'provider_reported',
  'analyst_supplied',
  'derived',
] as const satisfies readonly DecisionFactProvenance[]);

function presentationDescriptor(
  value: DecisionFactPresentationDescriptor,
): DecisionFactPresentationDescriptor {
  return Object.freeze(value);
}

export const DECISION_FACT_PRESENTATION_DESCRIPTORS = Object.freeze({
  evidenceState: Object.freeze({
    observed: presentationDescriptor({
      label: 'Observed',
      explanation: 'The bounded evidence contains an observation for this fact.',
      tone: 'neutral',
      icon: 'evidence-observed',
      assistiveText: 'Bounded evidence contains an observation for this fact. The observation does not establish safety, legitimacy, ownership, or a favourable result.',
    }),
    not_observed_in_bounded_evidence: presentationDescriptor({
      label: 'Not observed in bounded evidence',
      explanation: 'The bounded collection did not retain a matching observation; this is not a generic absence claim.',
      tone: 'caution',
      icon: 'bounded-non-observation',
      assistiveText: 'No matching observation was retained within the bounded collection. Evidence outside that scope remains unknown.',
    }),
    not_collected: presentationDescriptor({
      label: 'Not collected',
      explanation: 'The source or check was not run for this fact.',
      tone: 'caution',
      icon: 'collection-not-run',
      assistiveText: 'This evidence was not collected, so there is no collection result to interpret.',
    }),
    partial: presentationDescriptor({
      label: 'Partial',
      explanation: 'The retained evidence is incomplete and its stated limitations still apply.',
      tone: 'caution',
      icon: 'evidence-limited',
      assistiveText: 'Only partial evidence is available. Review the attributed limitations before drawing a conclusion.',
    }),
    unsupported: presentationDescriptor({
      label: 'Unsupported',
      explanation: 'The selected source path does not support this evidence family.',
      tone: 'caution',
      icon: 'source-unsupported',
      assistiveText: 'This evidence family is unsupported by the selected source path and provides no result for interpretation.',
    }),
    unavailable: presentationDescriptor({
      label: 'Unavailable',
      explanation: 'The source or check could not provide a retained result.',
      tone: 'caution',
      icon: 'source-unavailable',
      assistiveText: 'The evidence source was unavailable. Its unavailable state does not establish a result about the target.',
    }),
    unknown: presentationDescriptor({
      label: 'Unknown',
      explanation: 'The retained evidence does not determine this state.',
      tone: 'caution',
      icon: 'state-unknown',
      assistiveText: 'The evidence state is unknown and supports no positive or negative conclusion.',
    }),
  } satisfies Readonly<Record<DecisionFactEvidenceState, DecisionFactPresentationDescriptor>>),
  freshness: Object.freeze({
    current: presentationDescriptor({
      label: 'Current',
      explanation: 'The observation is within the applicable freshness window.',
      tone: 'neutral',
      icon: 'observation-current',
      assistiveText: 'The observation is current under the configured freshness policy. Current evidence does not establish safety, correctness, or a favourable result.',
    }),
    stale: presentationDescriptor({
      label: 'Stale',
      explanation: 'The observation is outside the applicable freshness window.',
      tone: 'caution',
      icon: 'observation-stale',
      assistiveText: 'The observation is stale under the configured freshness policy and may no longer describe the current state.',
    }),
    unknown: presentationDescriptor({
      label: 'Freshness unknown',
      explanation: 'The retained evidence does not establish when this fact was observed.',
      tone: 'caution',
      icon: 'state-unknown',
      assistiveText: 'Freshness is unknown, so the retained evidence cannot establish whether this fact is current.',
    }),
    not_applicable: presentationDescriptor({
      label: 'Freshness not applicable',
      explanation: 'A freshness assessment does not apply to this fact state.',
      tone: 'neutral',
      icon: 'state-not-applicable',
      assistiveText: 'Freshness is not applicable to this fact state; this does not supply a missing observation.',
    }),
  } satisfies Readonly<Record<DecisionFactFreshness, DecisionFactPresentationDescriptor>>),
  consistency: Object.freeze({
    consistent: presentationDescriptor({
      label: 'Consistent',
      explanation: 'The separately attributed observations agree for this comparison.',
      tone: 'neutral',
      icon: 'source-agreement',
      assistiveText: 'The attributed observations are consistent for this comparison. Agreement does not establish correctness, authority, or safety.',
    }),
    contradictory: presentationDescriptor({
      label: 'Contradictory',
      explanation: 'Separately attributed observations disagree for this comparison.',
      tone: 'conflict',
      icon: 'source-disagreement',
      assistiveText: 'The attributed observations disagree. Source ordering does not decide which observation should govern the review.',
    }),
    unknown: presentationDescriptor({
      label: 'Consistency unknown',
      explanation: 'The retained evidence does not support an agreement or disagreement conclusion.',
      tone: 'caution',
      icon: 'state-unknown',
      assistiveText: 'Consistency remains unknown because the attributed evidence is incomplete or indeterminate.',
    }),
    not_applicable: presentationDescriptor({
      label: 'Consistency not applicable',
      explanation: 'A source-consistency comparison does not apply to this fact.',
      tone: 'neutral',
      icon: 'state-not-applicable',
      assistiveText: 'Consistency is not applicable because this fact is not a retained source comparison.',
    }),
  } satisfies Readonly<Record<DecisionFactConsistency, DecisionFactPresentationDescriptor>>),
  provenance: Object.freeze({
    direct_observation: presentationDescriptor({
      label: 'Direct observation',
      explanation: 'The contributor records a direct bounded observation.',
      tone: 'neutral',
      icon: 'evidence-direct',
      assistiveText: 'This contributor records a direct bounded observation with its own scope and limitations.',
    }),
    provider_reported: presentationDescriptor({
      label: 'Provider reported',
      explanation: 'The contributor reports data published by its named provider.',
      tone: 'neutral',
      icon: 'evidence-reported',
      assistiveText: 'This contributor retains provider-reported evidence without treating the provider statement as independently verified.',
    }),
    analyst_supplied: presentationDescriptor({
      label: 'Analyst supplied',
      explanation: 'The contributor was supplied through analyst-controlled context.',
      tone: 'neutral',
      icon: 'evidence-analyst-supplied',
      assistiveText: 'This contributor came from analyst-supplied context and retains that attribution.',
    }),
    derived: presentationDescriptor({
      label: 'Derived',
      explanation: 'The contributor was derived from retained inputs.',
      tone: 'neutral',
      icon: 'evidence-derived',
      assistiveText: 'This contributor is derived from retained inputs and does not gain authority beyond those inputs.',
    }),
  } satisfies Readonly<Record<DecisionFactProvenance, DecisionFactPresentationDescriptor>>),
});

export const DECISION_FACT_PRESENTATION_LABELS = Object.freeze({
  evidenceState: Object.freeze({
    observed: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.observed.label,
    not_observed_in_bounded_evidence: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.not_observed_in_bounded_evidence.label,
    not_collected: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.not_collected.label,
    partial: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.partial.label,
    unsupported: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.unsupported.label,
    unavailable: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.unavailable.label,
    unknown: DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState.unknown.label,
  } satisfies Readonly<Record<DecisionFactEvidenceState, string>>),
  freshness: Object.freeze({
    current: DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness.current.label,
    stale: DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness.stale.label,
    unknown: DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness.unknown.label,
    not_applicable: DECISION_FACT_PRESENTATION_DESCRIPTORS.freshness.not_applicable.label,
  } satisfies Readonly<Record<DecisionFactFreshness, string>>),
  consistency: Object.freeze({
    consistent: DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency.consistent.label,
    contradictory: DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency.contradictory.label,
    unknown: DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency.unknown.label,
    not_applicable: DECISION_FACT_PRESENTATION_DESCRIPTORS.consistency.not_applicable.label,
  } satisfies Readonly<Record<DecisionFactConsistency, string>>),
  provenance: Object.freeze({
    direct_observation: DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance.direct_observation.label,
    provider_reported: DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance.provider_reported.label,
    analyst_supplied: DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance.analyst_supplied.label,
    derived: DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance.derived.label,
  } satisfies Readonly<Record<DecisionFactProvenance, string>>),
  importance: Object.freeze({
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  } as const satisfies Readonly<Record<DecisionFactImportance, string>>),
  completeness: Object.freeze({
    complete: 'Complete bounded collection',
    partial: 'Partial',
    not_collected: 'Not collected',
    unsupported: 'Unsupported',
    unavailable: 'Unavailable',
    unknown: 'Unknown',
  } as const satisfies Readonly<Record<DecisionFactCompleteness, string>>),
});

export type DecisionFactContributor = Readonly<{
  id: string;
  label: string;
  provenance: DecisionFactProvenance;
  evidenceState: DecisionFactEvidenceState;
  references: readonly string[];
  observedAt: string | null;
  limitations: readonly string[];
}>;

export type DecisionFactNextAction = Readonly<{
  id: string;
  label: string;
  reason: string;
  expectedOutcome: string;
  href: `#${string}`;
  importance: DecisionFactImportance;
}>;

export type DecisionFact = Readonly<{
  version: typeof DECISION_FACT_VERSION;
  id: string;
  question: string;
  conclusion: string;
  importance: DecisionFactImportance;
  evidenceState: DecisionFactEvidenceState;
  freshness: DecisionFactFreshness;
  consistency: DecisionFactConsistency;
  contributors: readonly DecisionFactContributor[];
  contributorCount: number;
  references: readonly string[];
  contradictions: readonly string[];
  limitations: readonly string[];
  nextActions: readonly DecisionFactNextAction[];
}>;

export type DecisionFactContributorInput = Readonly<{
  id: string;
  label: string;
  provenance: DecisionFactProvenance;
  evidenceState: DecisionFactEvidenceState;
  references?: readonly string[];
  observedAt?: string | null;
  limitations?: readonly string[];
}>;

export type DecisionFactNextActionInput = Readonly<{
  id: string;
  label: string;
  reason: string;
  expectedOutcome: string;
  href: `#${string}`;
  importance: DecisionFactImportance;
}>;

export type DecisionFactInput = Readonly<{
  id: string;
  question: string;
  conclusion: string;
  importance: DecisionFactImportance;
  evidenceState: DecisionFactEvidenceState;
  freshness: DecisionFactFreshness;
  consistency: DecisionFactConsistency;
  contributors?: readonly DecisionFactContributorInput[];
  references?: readonly string[];
  contradictions?: readonly string[];
  limitations?: readonly string[];
  nextActions?: readonly DecisionFactNextActionInput[];
}>;

export type DecisionFactProjectionCollection<Value> = Readonly<{
  total: number;
  displayed: number;
  omitted: number;
  items: readonly Value[];
}>;

export type DecisionFactSourceProjection = Readonly<{
  id: string;
  label: string;
  provenance: DecisionFactProvenance;
  evidenceState: DecisionFactEvidenceState;
  observedAt: string | null;
  references: DecisionFactProjectionCollection<string>;
  limitations: DecisionFactProjectionCollection<string>;
}>;

export type DecisionFactProjection = Readonly<{
  version: typeof DECISION_FACT_VERSION;
  id: string;
  question: string;
  conclusion: string;
  importance: DecisionFactImportance;
  evidenceState: DecisionFactEvidenceState;
  completeness: DecisionFactCompleteness;
  freshness: DecisionFactFreshness;
  consistency: DecisionFactConsistency;
  dependencies: DecisionFactProjectionCollection<string>;
  sourceReferences: DecisionFactProjectionCollection<string>;
  sources: DecisionFactProjectionCollection<DecisionFactSourceProjection>;
  contradictions: DecisionFactProjectionCollection<string>;
  limitations: DecisionFactProjectionCollection<string>;
  safeNextActions: DecisionFactProjectionCollection<DecisionFactNextAction>;
}>;

export type DecisionFactProjectionSet = Readonly<{
  version: typeof DECISION_FACT_PROJECTION_VERSION;
  total: number;
  displayed: number;
  omitted: number;
  contradictory: number;
  unresolved: number;
  facts: readonly DecisionFactProjection[];
}>;

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_LABEL_LENGTH = 160;
const MAX_QUESTION_LENGTH = 320;
const MAX_CONCLUSION_LENGTH = 640;
const MAX_REFERENCE_LENGTH = 200;
const MAX_LIMITATION_LENGTH = 280;
const MAX_ACTION_DETAIL_LENGTH = 320;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_TEXT_INPUT_FACTOR = 4;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const HAS_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,199})$/u;
const HREF_PATTERN = /^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u;
const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,43})?(Z|[+-]\d{2}:\d{2})$/u;
const UTF8_ENCODER = new TextEncoder();

const EVIDENCE_STATES = new Set<DecisionFactEvidenceState>(DECISION_FACT_EVIDENCE_STATES);
const FRESHNESS_STATES = new Set<DecisionFactFreshness>(DECISION_FACT_FRESHNESS_STATES);
const CONSISTENCY_STATES = new Set<DecisionFactConsistency>(DECISION_FACT_CONSISTENCY_STATES);
const PROVENANCE_STATES = new Set<DecisionFactProvenance>(DECISION_FACT_PROVENANCE_STATES);
const IMPORTANCE_STATES = new Set<DecisionFactImportance>(['high', 'medium', 'low']);

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function descriptorsMatch(left: PropertyDescriptor | undefined, right: PropertyDescriptor | undefined): boolean {
  if (!left || !right) return left === right;
  if (left.configurable !== right.configurable || left.enumerable !== right.enumerable) return false;
  const leftIsData = 'value' in left;
  const rightIsData = 'value' in right;
  if (leftIsData !== rightIsData) return false;
  return leftIsData
    ? left.writable === right.writable && Object.is(left.value, right.value)
    : Object.is(left.get, right.get) && Object.is(left.set, right.set);
}

function stableOwnDescriptor(value: object, key: PropertyKey, label: string): PropertyDescriptor | undefined {
  try {
    const first = Object.getOwnPropertyDescriptor(value, key);
    const second = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptorsMatch(first, second)) throw new TypeError('unstable descriptor');
    return first;
  } catch {
    throw new TypeError(`${label} must expose stable ordinary data descriptors.`);
  }
}

function stablePrototype(value: object, expected: object | null, label: string): void {
  try {
    const first = Object.getPrototypeOf(value);
    const second = Object.getPrototypeOf(value);
    if (first !== second || first !== expected) throw new TypeError('unexpected prototype');
  } catch {
    throw new TypeError(`${label} must use an ordinary prototype.`);
  }
}

function dataRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw new TypeError(`${label} must be a plain object.`);
  }
  if (!value || typeof value !== 'object' || isArray) throw new TypeError(`${label} must be a plain object.`);
  const prototype = (() => {
    try {
      return Object.getPrototypeOf(value);
    } catch {
      throw new TypeError(`${label} must use an ordinary prototype.`);
    }
  })();
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object.`);
  stablePrototype(value, prototype, label);
  for (const behaviour of ['toJSON', Symbol.iterator] as const) {
    if (stableOwnDescriptor(value, behaviour, label)) {
      throw new TypeError(`${label} must not define custom serialisation or iteration.`);
    }
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = stableOwnDescriptor(value, field, label);
    if (!descriptor) continue;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must use enumerable ordinary data fields.`);
    }
    output[field] = descriptor.value;
  }
  return output;
}

function boundedDataArray(value: unknown, maximum: number, label: string): unknown[] {
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw new TypeError(`${label} must be an ordinary array.`);
  }
  if (!isArray || !value || typeof value !== 'object') throw new TypeError(`${label} must be an ordinary array.`);
  stablePrototype(value, Array.prototype, label);
  if (stableOwnDescriptor(value, Symbol.iterator, label) || stableOwnDescriptor(value, 'toJSON', label)) {
    throw new TypeError(`${label} must not define custom iteration or serialisation.`);
  }
  const lengthDescriptor = stableOwnDescriptor(value, 'length', label);
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
  if (!lengthDescriptor
    || lengthDescriptor.enumerable
    || !Number.isSafeInteger(length)
    || Number(length) < 0) {
    throw new TypeError(`${label} must have a stable non-negative length.`);
  }
  const retainedLength = Math.min(Number(length), maximum);
  const output: unknown[] = [];
  for (let index = 0; index < retainedLength; index += 1) {
    const descriptor = stableOwnDescriptor(value, String(index), label);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must contain dense ordinary indexed data.`);
    }
    output.push(descriptor.value);
  }
  return output;
}

function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length > maximum * MAX_TEXT_INPUT_FACTOR) {
    throw new TypeError(`${label} must be bounded text.`);
  }
  const normalized = value
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum)
    .trim();
  if (!normalized) throw new TypeError(`${label} must be non-empty bounded text.`);
  return normalized;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new TypeError(`${label} must be a bounded stable identifier.`);
  }
  const normalized = boundedText(value, MAX_IDENTIFIER_LENGTH, label);
  if (!IDENTIFIER_PATTERN.test(normalized)) throw new TypeError(`${label} must be a stable identifier.`);
  return normalized;
}

function stateValue<Value extends string>(
  value: unknown,
  allowed: ReadonlySet<Value>,
  label: string,
): Value {
  if (typeof value !== 'string' || !allowed.has(value as Value)) {
    throw new TypeError(`${label} has an unsupported state.`);
  }
  return value as Value;
}

function canonicalTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_TIMESTAMP_LENGTH
    || HAS_CONTROL_CHARACTERS.test(value)) return null;
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || calendar.getUTCHours() !== hour
    || calendar.getUTCMinutes() !== minute
    || calendar.getUTCSeconds() !== second) return null;
  const zone = match[8] ?? '';
  if (zone !== 'Z') {
    const zoneHours = Number(zone.slice(1, 3));
    const zoneMinutes = Number(zone.slice(4, 6));
    if (zoneHours > 23 || zoneMinutes > 59) return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = new Date(parsed);
  return normalized.getUTCFullYear() >= 1 && normalized.getUTCFullYear() <= 9_999
    ? normalized.toISOString()
    : null;
}

function normalizedTextList(
  value: unknown,
  maximumItems: number,
  maximumText: number,
  label: string,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  const source = boundedDataArray(value, maximumItems, label);
  const retained = source.map((item) => boundedText(item, maximumText, `${label} entry`));
  return Object.freeze([...new Set(retained)].sort(compareCodeUnits));
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeContributor(value: unknown): DecisionFactContributor {
  const source = dataRecord(value, [
    'id',
    'label',
    'provenance',
    'evidenceState',
    'references',
    'observedAt',
    'limitations',
  ], 'Decision Fact contributor');
  return Object.freeze({
    id: identifier(source.id, 'Decision Fact contributor identifier'),
    label: boundedText(source.label, MAX_LABEL_LENGTH, 'Decision Fact contributor label'),
    provenance: stateValue(source.provenance, PROVENANCE_STATES, 'Decision Fact contributor provenance'),
    evidenceState: stateValue(source.evidenceState, EVIDENCE_STATES, 'Decision Fact contributor evidence'),
    references: normalizedTextList(
      source.references,
      MAX_DECISION_FACT_REFERENCES,
      MAX_REFERENCE_LENGTH,
      'Decision Fact contributor references',
    ),
    observedAt: canonicalTimestamp(source.observedAt),
    limitations: normalizedTextList(
      source.limitations,
      MAX_DECISION_FACT_LIMITATIONS,
      MAX_LIMITATION_LENGTH,
      'Decision Fact contributor limitations',
    ),
  });
}

function normalizeContributors(value: unknown): readonly DecisionFactContributor[] {
  if (value === undefined) return Object.freeze([]);
  const source = boundedDataArray(value, MAX_DECISION_FACT_CONTRIBUTORS, 'Decision Fact contributors');
  const retained = new Map<string, DecisionFactContributor>();
  for (const item of source) {
    const contributor = normalizeContributor(item);
    const existing = retained.get(contributor.id);
    if (existing && !sameCanonicalValue(existing, contributor)) {
      throw new TypeError(`Decision Fact contributor identifier is ambiguous: ${contributor.id}.`);
    }
    if (!existing) retained.set(contributor.id, contributor);
  }
  return Object.freeze([...retained.values()].sort((left, right) => compareCodeUnits(left.id, right.id)));
}

function normalizeNextAction(value: unknown): DecisionFactNextAction {
  const source = dataRecord(value, [
    'id',
    'label',
    'reason',
    'expectedOutcome',
    'href',
    'importance',
  ], 'Decision Fact next action');
  const href = boundedText(source.href, 160, 'Decision Fact next action destination');
  if (!HREF_PATTERN.test(href)) {
    throw new TypeError('Decision Fact next action destination must be an internal review fragment.');
  }
  return Object.freeze({
    id: identifier(source.id, 'Decision Fact next action identifier'),
    label: boundedText(source.label, MAX_LABEL_LENGTH, 'Decision Fact next action label'),
    reason: boundedText(source.reason, MAX_ACTION_DETAIL_LENGTH, 'Decision Fact next action reason'),
    expectedOutcome: boundedText(
      source.expectedOutcome,
      MAX_ACTION_DETAIL_LENGTH,
      'Decision Fact next action expected outcome',
    ),
    href: href as `#${string}`,
    importance: stateValue(source.importance, IMPORTANCE_STATES, 'Decision Fact next action importance'),
  });
}

function normalizeNextActions(value: unknown): readonly DecisionFactNextAction[] {
  if (value === undefined) return Object.freeze([]);
  const source = boundedDataArray(value, MAX_DECISION_FACT_NEXT_ACTIONS, 'Decision Fact next actions');
  const retained = new Map<string, DecisionFactNextAction>();
  for (const item of source) {
    const action = normalizeNextAction(item);
    const existing = retained.get(action.id);
    if (existing && !sameCanonicalValue(existing, action)) {
      throw new TypeError(`Decision Fact next action identifier is ambiguous: ${action.id}.`);
    }
    if (!existing) retained.set(action.id, action);
  }
  return Object.freeze([...retained.values()].sort((left, right) => compareCodeUnits(left.id, right.id)));
}

export function createDecisionFact(value: unknown): DecisionFact {
  const source = dataRecord(value, [
    'id',
    'question',
    'conclusion',
    'importance',
    'evidenceState',
    'freshness',
    'consistency',
    'contributors',
    'references',
    'contradictions',
    'limitations',
    'nextActions',
  ], 'Decision Fact');
  const contributors = normalizeContributors(source.contributors);
  return Object.freeze({
    version: DECISION_FACT_VERSION,
    id: identifier(source.id, 'Decision Fact identifier'),
    question: boundedText(source.question, MAX_QUESTION_LENGTH, 'Decision Fact question'),
    conclusion: boundedText(source.conclusion, MAX_CONCLUSION_LENGTH, 'Decision Fact conclusion'),
    importance: stateValue(source.importance, IMPORTANCE_STATES, 'Decision Fact importance'),
    evidenceState: stateValue(source.evidenceState, EVIDENCE_STATES, 'Decision Fact evidence'),
    freshness: stateValue(source.freshness, FRESHNESS_STATES, 'Decision Fact freshness'),
    consistency: stateValue(source.consistency, CONSISTENCY_STATES, 'Decision Fact consistency'),
    contributors,
    contributorCount: contributors.length,
    references: normalizedTextList(
      source.references,
      MAX_DECISION_FACT_REFERENCES,
      MAX_REFERENCE_LENGTH,
      'Decision Fact references',
    ),
    contradictions: normalizedTextList(
      source.contradictions,
      MAX_DECISION_FACT_CONTRADICTIONS,
      MAX_CONCLUSION_LENGTH,
      'Decision Fact contradictions',
    ),
    limitations: normalizedTextList(
      source.limitations,
      MAX_DECISION_FACT_LIMITATIONS,
      MAX_LIMITATION_LENGTH,
      'Decision Fact limitations',
    ),
    nextActions: normalizeNextActions(source.nextActions),
  });
}

export function buildDecisionFacts(value: unknown): readonly DecisionFact[] {
  const source = boundedDataArray(value, MAX_DECISION_FACTS, 'Decision Facts');
  const retained = new Map<string, DecisionFact>();
  for (const item of source) {
    const fact = createDecisionFact(item);
    const existing = retained.get(fact.id);
    if (existing && !sameCanonicalValue(existing, fact)) {
      throw new TypeError(`Decision Fact identifier is ambiguous: ${fact.id}.`);
    }
    if (!existing) retained.set(fact.id, fact);
  }
  return Object.freeze([...retained.values()].sort((left, right) => compareCodeUnits(left.id, right.id)));
}

function canonicalFactShape(fact: DecisionFact): string {
  return JSON.stringify({
    version: fact.version,
    id: fact.id,
    question: fact.question,
    conclusion: fact.conclusion,
    importance: fact.importance,
    evidenceState: fact.evidenceState,
    freshness: fact.freshness,
    consistency: fact.consistency,
    contributors: fact.contributors.map((contributor) => ({
      id: contributor.id,
      label: contributor.label,
      provenance: contributor.provenance,
      evidenceState: contributor.evidenceState,
      references: [...contributor.references],
      observedAt: contributor.observedAt,
      limitations: [...contributor.limitations],
    })),
    contributorCount: fact.contributorCount,
    references: [...fact.references],
    contradictions: [...fact.contradictions],
    limitations: [...fact.limitations],
    nextActions: fact.nextActions.map((action) => ({
      id: action.id,
      label: action.label,
      reason: action.reason,
      expectedOutcome: action.expectedOutcome,
      href: action.href,
      importance: action.importance,
    })),
  });
}

export function canonicalDecisionFacts(value: readonly DecisionFact[]): readonly DecisionFact[] {
  const canonical = buildDecisionFacts(value);
  if (value.length > MAX_DECISION_FACTS || canonical.length !== value.length) {
    throw new TypeError('Decision Facts must not contain duplicate or over-limit identifiers.');
  }
  const canonicalById = new Map(canonical.map((fact) => [fact.id, fact]));
  for (const fact of value) {
    const rebuilt = canonicalById.get(fact.id);
    if (!rebuilt
      || fact.version !== DECISION_FACT_VERSION
      || !Number.isSafeInteger(fact.contributorCount)
      || fact.contributorCount !== fact.contributors.length
      || fact.contributors.length !== rebuilt.contributors.length
      || fact.references.length !== rebuilt.references.length
      || fact.contradictions.length !== rebuilt.contradictions.length
      || fact.limitations.length !== rebuilt.limitations.length
      || fact.nextActions.length !== rebuilt.nextActions.length
      || fact.contributors.some((contributor, index) => {
        const canonicalContributor = rebuilt.contributors[index];
        return !canonicalContributor
          || contributor.references.length !== canonicalContributor.references.length
          || contributor.limitations.length !== canonicalContributor.limitations.length;
      })
      || canonicalFactShape(fact) !== canonicalFactShape(rebuilt)) {
      throw new TypeError('Decision Facts must be canonical Decision Fact values.');
    }
  }
  return canonical;
}

export function decisionFactCompleteness(
  state: DecisionFactEvidenceState,
): DecisionFactCompleteness {
  if (state === 'observed' || state === 'not_observed_in_bounded_evidence') return 'complete';
  if (state === 'partial') return 'partial';
  if (state === 'not_collected') return 'not_collected';
  if (state === 'unsupported') return 'unsupported';
  if (state === 'unavailable') return 'unavailable';
  return 'unknown';
}

function projectionCollection<Input, Output>(
  values: readonly Input[],
  maximum: number,
  project: (value: Input) => Output,
): DecisionFactProjectionCollection<Output> {
  const items = Object.freeze(values.slice(0, maximum).map(project));
  const total = values.length;
  const displayed = items.length;
  const omitted = total - displayed;
  if (total !== displayed + omitted) {
    throw new RangeError('Decision Fact projection counts did not reconcile.');
  }
  return Object.freeze({ total, displayed, omitted, items });
}

function sourceProjection(source: DecisionFactContributor): DecisionFactSourceProjection {
  return Object.freeze({
    id: source.id,
    label: source.label,
    provenance: source.provenance,
    evidenceState: source.evidenceState,
    observedAt: source.observedAt,
    references: projectionCollection(
      source.references,
      MAX_DECISION_FACT_PROJECTION_SOURCE_REFERENCES,
      (reference) => reference,
    ),
    limitations: projectionCollection(
      source.limitations,
      MAX_DECISION_FACT_PROJECTION_SOURCE_LIMITATIONS,
      (limitation) => limitation,
    ),
  });
}

function factProjection(fact: DecisionFact): DecisionFactProjection {
  const sources = projectionCollection(
    fact.contributors,
    MAX_DECISION_FACT_PROJECTION_SOURCES,
    sourceProjection,
  );
  const dependencies = projectionCollection(
    fact.contributors.map((source) => source.id),
    MAX_DECISION_FACT_PROJECTION_SOURCES,
    (dependency) => dependency,
  );
  if (sources.total !== dependencies.total
    || sources.displayed !== dependencies.displayed
    || sources.omitted !== dependencies.omitted) {
    throw new RangeError(`Decision Fact ${fact.id} source and dependency counts did not reconcile.`);
  }
  return Object.freeze({
    version: fact.version,
    id: fact.id,
    question: fact.question,
    conclusion: fact.conclusion,
    importance: fact.importance,
    evidenceState: fact.evidenceState,
    completeness: decisionFactCompleteness(fact.evidenceState),
    freshness: fact.freshness,
    consistency: fact.consistency,
    dependencies,
    sourceReferences: projectionCollection(
      fact.references,
      MAX_DECISION_FACT_PROJECTION_REFERENCES,
      (reference) => reference,
    ),
    sources,
    contradictions: projectionCollection(
      fact.contradictions,
      MAX_DECISION_FACT_PROJECTION_CONTRADICTIONS,
      (contradiction) => contradiction,
    ),
    limitations: projectionCollection(
      fact.limitations,
      MAX_DECISION_FACT_PROJECTION_LIMITATIONS,
      (limitation) => limitation,
    ),
    safeNextActions: projectionCollection(
      fact.nextActions,
      MAX_DECISION_FACT_PROJECTION_NEXT_ACTIONS,
      (action) => Object.freeze({ ...action }),
    ),
  });
}

export function projectDecisionFacts(value: readonly DecisionFact[]): DecisionFactProjectionSet {
  const canonical = canonicalDecisionFacts(value);
  const total = canonical.length;
  const contradictory = canonical.filter((fact) => fact.consistency === 'contradictory').length;
  const unresolved = canonical.filter((fact) => fact.consistency === 'unknown').length;
  const retained: DecisionFactProjection[] = [];
  for (const fact of canonical) {
    if (retained.length >= MAX_DECISION_FACT_PROJECTION_FACTS) break;
    const projected = factProjection(fact);
    const candidateFacts = [...retained, projected];
    const candidate = {
      version: DECISION_FACT_PROJECTION_VERSION,
      total,
      displayed: candidateFacts.length,
      omitted: total - candidateFacts.length,
      contradictory,
      unresolved,
      facts: candidateFacts,
    };
    if (UTF8_ENCODER.encode(JSON.stringify(candidate)).byteLength <= MAX_DECISION_FACT_PROJECTION_BYTES) {
      retained.push(projected);
    }
  }
  const facts = Object.freeze(retained);
  const displayed = retained.length;
  const omitted = total - displayed;
  if (total !== displayed + omitted) {
    throw new RangeError('Decision Fact projection totals did not reconcile.');
  }
  const projection = Object.freeze({
    version: DECISION_FACT_PROJECTION_VERSION,
    total,
    displayed,
    omitted,
    contradictory,
    unresolved,
    facts,
  });
  if (UTF8_ENCODER.encode(JSON.stringify(projection)).byteLength > MAX_DECISION_FACT_PROJECTION_BYTES) {
    throw new RangeError('Decision Fact projection exceeded its byte limit.');
  }
  return projection;
}
