import type { CaseRecord } from './case-record-contracts.mts';
import { PUBLIC_CASE_SCHEMA_VERSION } from '../contracts/case-portability.mts';
import { caseStatusIsClosed } from './case-record-operations.mts';

export type CaseAudience = 'internal' | 'public' | 'trusted';
export type CaseFieldTreatment = 'exclude' | 'preserve' | 'redact' | 'transform';

type CaseProjectionProfile = 'durable' | CaseAudience;
type CompleteCaseRecord = Required<CaseRecord>;
type CaseField = keyof CompleteCaseRecord;
type CaseAudienceExclusion = Readonly<{
  label: string;
  order: number;
}>;
type CaseFieldRule<K extends CaseField> = Readonly<{
  key: K;
  treatment: Readonly<Record<CaseProjectionProfile, CaseFieldTreatment>>;
  nestedSensitiveFields: readonly string[];
  audienceExclusions: Readonly<Partial<Record<CaseAudience, CaseAudienceExclusion>>>;
  value: (record: CaseRecord, profile: CaseProjectionProfile) => CompleteCaseRecord[K];
}>;
type CaseFieldRuleOptions = Readonly<{
  nestedSensitiveFields?: readonly string[];
  audienceExclusions?: Readonly<Partial<Record<CaseAudience, CaseAudienceExclusion>>>;
}>;

const PRESERVE = Object.freeze({
  durable: 'preserve', internal: 'preserve', trusted: 'preserve', public: 'preserve',
} as const satisfies Record<CaseProjectionProfile, CaseFieldTreatment>);
const PUBLIC_TRANSFORM = Object.freeze({ ...PRESERVE, public: 'transform' } as const);
const PUBLIC_EXCLUDE = Object.freeze({ ...PRESERVE, public: 'exclude' } as const);
const SHARED_EXCLUDE = Object.freeze({ ...PRESERVE, trusted: 'exclude', public: 'exclude' } as const);
const SHARED_REDACT = Object.freeze({ ...PRESERVE, trusted: 'redact', public: 'redact' } as const);
const TRUSTED_REDACT_PUBLIC_EXCLUDE = Object.freeze({
  ...PRESERVE, trusted: 'redact', public: 'exclude',
} as const);
const PUBLIC_REDACT = Object.freeze({ ...PRESERVE, public: 'redact' } as const);

function fieldRule<K extends CaseField>(
  key: K,
  treatment: Readonly<Record<CaseProjectionProfile, CaseFieldTreatment>>,
  value: CaseFieldRule<K>['value'],
  options: CaseFieldRuleOptions = {},
): CaseFieldRule<K> {
  const audienceExclusions = Object.freeze(Object.fromEntries(
    Object.entries(options.audienceExclusions ?? {}).map(([audience, exclusion]) => [
      audience,
      Object.freeze({ ...exclusion }),
    ]),
  )) as Readonly<Partial<Record<CaseAudience, CaseAudienceExclusion>>>;
  for (const audience of ['internal', 'trusted', 'public'] as const) {
    const requiresExplanation = treatment[audience] === 'exclude' || treatment[audience] === 'redact';
    if (requiresExplanation !== Boolean(audienceExclusions[audience])) {
      throw new TypeError(`Case field ${key} must explain every redacted or excluded ${audience} treatment exactly once.`);
    }
  }
  return Object.freeze({
    key,
    treatment,
    value,
    nestedSensitiveFields: Object.freeze([...(options.nestedSensitiveFields ?? [])]),
    audienceExclusions,
  });
}

function preservedField<K extends CaseField>(key: K): CaseFieldRule<K> {
  return fieldRule(key, PRESERVE, (record) => record[key] as CompleteCaseRecord[K]);
}

const PUBLIC_OBSERVED_EFFECT_LIMITATION = 'Independent observed-effect review records were excluded from this public Case pack.';
const PUBLIC_CLOSURE_LIMITATION = 'Deliberate closure records were excluded from this public Case pack.';

function publicObservedEffectHistory(preV13HistoryUnavailable: boolean): CaseRecord['observedEffects'] {
  return {
    reviews: [],
    omitted: 0,
    preV13HistoryUnavailable,
    limitations: [
      ...(preV13HistoryUnavailable
        ? ['Migrated from a pre-v13 Case; earlier independent observed-effect review history is unavailable.']
        : []),
      'Observed-effect reviews are independent point-in-time records; provider workflow events do not create or replace them.',
      PUBLIC_OBSERVED_EFFECT_LIMITATION,
    ].sort(),
  };
}

function publicClosureHistory(preV13HistoryUnavailable: boolean): CaseRecord['closures'] {
  return {
    records: [],
    omitted: 0,
    preV13HistoryUnavailable,
    limitations: [
      ...(preV13HistoryUnavailable
        ? ['Migrated from a pre-v13 Case; earlier deliberate closure history is unavailable.']
        : []),
      'Closure records are deliberate analyst actions and do not establish absence, safety, provider performance, or legal sufficiency.',
      PUBLIC_CLOSURE_LIMITATION,
    ].sort(),
  };
}

/**
 * The complete current Case field policy. Browser persistence and ordinary
 * exports deliberately share the `durable` projection. Case-pack audiences
 * must classify every field here before a new Case property can compile.
 */
const CASE_FIELD_RULES = Object.freeze({
  id: preservedField('id'),
  domain: preservedField('domain'),
  status: fieldRule('status', PUBLIC_TRANSFORM, (record, profile) => (
    profile === 'public' && caseStatusIsClosed(record.status) && record.closures.records.length
      ? 'reviewing'
      : record.status
  )),
  disposition: preservedField('disposition'),
  reviewReasonCode: fieldRule('reviewReasonCode', PRESERVE, (record) => record.reviewReasonCode ?? null),
  brandProfileIds: fieldRule('brandProfileIds', PUBLIC_EXCLUDE, (record, profile) => (
    profile === 'public' ? [] : [...record.brandProfileIds]
  ), {
    audienceExclusions: { public: { label: 'Brand Profile references', order: 2 } },
  }),
  tags: fieldRule('tags', PRESERVE, (record) => [...record.tags]),
  notes: fieldRule('notes', SHARED_EXCLUDE, (record, profile) => (
    profile === 'trusted' || profile === 'public'
      ? []
      : record.notes.map((item) => ({ ...item }))
  ), {
    audienceExclusions: {
      trusted: { label: 'Case notes', order: 1 },
      public: { label: 'Case notes', order: 1 },
    },
  }),
  source: preservedField('source'),
  evidenceHistory: fieldRule('evidenceHistory', PRESERVE, (record) => structuredClone(record.evidenceHistory)),
  evidencePins: fieldRule('evidencePins', PRESERVE, (record) => structuredClone(record.evidencePins)),
  decisions: fieldRule('decisions', PRESERVE, (record) => structuredClone(record.decisions)),
  actions: fieldRule('actions', TRUSTED_REDACT_PUBLIC_EXCLUDE, (record, profile) => (
    profile === 'public'
      ? []
      : profile === 'trusted'
        ? structuredClone(record.actions).map((item) => ({ ...item, recipient: '[redacted]' }))
        : structuredClone(record.actions)
  ), {
    nestedSensitiveFields: ['recipient'],
    audienceExclusions: {
      trusted: { label: 'Recipient values', order: 2 },
      public: { label: 'Actions and recipient values', order: 3 },
    },
  }),
  assertions: fieldRule('assertions', PUBLIC_EXCLUDE, (record, profile) => (
    profile === 'public' ? [] : structuredClone(record.assertions)
  ), {
    audienceExclusions: { public: { label: 'Analyst assertions', order: 4 } },
  }),
  manualTrail: fieldRule('manualTrail', SHARED_REDACT, (record, profile) => (
    profile === 'trusted' || profile === 'public'
      ? structuredClone(record.manualTrail).map((item) => ({ ...item, target: null }))
      : structuredClone(record.manualTrail)
  ), {
    nestedSensitiveFields: ['target'],
    audienceExclusions: {
      trusted: { label: 'Manual trail targets', order: 3 },
      public: { label: 'Manual trail targets', order: 6 },
    },
  }),
  sightings: fieldRule('sightings', PRESERVE, (record) => structuredClone(record.sightings)),
  observedEffects: fieldRule('observedEffects', PUBLIC_REDACT, (record, profile) => (
    profile === 'public'
      ? publicObservedEffectHistory(record.observedEffects.preV13HistoryUnavailable)
      : structuredClone(record.observedEffects)
  ), {
    audienceExclusions: {
      public: { label: 'Independent observed-effect reviews and closure history', order: 8 },
    },
  }),
  closures: fieldRule('closures', PUBLIC_REDACT, (record, profile) => (
    profile === 'public'
      ? publicClosureHistory(record.closures.preV13HistoryUnavailable)
      : structuredClone(record.closures)
  ), {
    audienceExclusions: {
      public: { label: 'Independent observed-effect reviews and closure history', order: 8 },
    },
  }),
  branches: fieldRule('branches', PUBLIC_EXCLUDE, (record, profile) => (
    profile === 'public' ? [] : structuredClone(record.branches ?? [])
  ), {
    audienceExclusions: { public: { label: 'Investigation branches', order: 5 } },
  }),
  createdAt: preservedField('createdAt'),
  updatedAt: preservedField('updatedAt'),
} satisfies { [K in CaseField]: CaseFieldRule<K> });

function projectCase(record: CaseRecord, profile: CaseProjectionProfile): CompleteCaseRecord {
  const projected: Partial<CompleteCaseRecord> = {};
  for (const key of Object.keys(CASE_FIELD_RULES) as CaseField[]) {
    const rule = CASE_FIELD_RULES[key] as CaseFieldRule<typeof key>;
    Object.defineProperty(projected, key, {
      configurable: true,
      enumerable: true,
      value: rule.value(record, profile),
      writable: true,
    });
  }
  return projected as CompleteCaseRecord;
}

export function projectCaseForDurableWrite(record: CaseRecord): CaseRecord {
  return projectCase(record, 'durable');
}

export function projectCaseForAudience(record: CaseRecord, audience: CaseAudience): CaseRecord {
  return projectCase(record, audience);
}

/** Field names used by the bounded hidden-copy defence, derived from policy. */
export const CASE_AUDIENCE_SENSITIVE_FIELD_NAMES = Object.freeze([...new Set(
  Object.entries(CASE_FIELD_RULES).flatMap(([key, rule]) => {
    const audienceTreatments = [rule.treatment.trusted, rule.treatment.public];
    const sensitive = audienceTreatments.some((value) => value === 'exclude' || value === 'redact');
    return sensitive ? [key, ...rule.nestedSensitiveFields] : [];
  }),
)]);
export const CASE_RECORD_FIELD_NAMES = Object.freeze(Object.values(CASE_FIELD_RULES).map((rule) => rule.key));

const OUTSIDE_SCHEMA_EXCLUSIONS = Object.freeze({
  internal: Object.freeze({ label: 'Raw upstream payloads and credentials are outside the case schema.', order: 1 }),
  trusted: Object.freeze({ label: 'Raw upstream payloads and credentials', order: 4 }),
  public: Object.freeze({ label: 'Raw upstream payloads and credentials', order: 7 }),
} as const satisfies Record<CaseAudience, CaseAudienceExclusion>);

function currentAudienceExclusions(audience: CaseAudience): readonly string[] {
  const entries = [
    ...Object.values(CASE_FIELD_RULES).flatMap((rule) => (
      rule.audienceExclusions[audience] ? [rule.audienceExclusions[audience]] : []
    )),
    OUTSIDE_SCHEMA_EXCLUSIONS[audience],
  ] as CaseAudienceExclusion[];
  const orderByLabel = new Map<string, number>();
  const labelByOrder = new Map<number, string>();
  for (const entry of entries) {
    if (!entry.label || entry.label.length > 160 || entry.label.trim() !== entry.label
      || !Number.isSafeInteger(entry.order) || entry.order < 1 || entry.order > 64) {
      throw new TypeError('Case audience exclusion metadata is malformed or exceeds its bound.');
    }
    const prior = orderByLabel.get(entry.label);
    if (prior !== undefined && prior !== entry.order) {
      throw new TypeError(`Case audience exclusion ${entry.label} has conflicting presentation order.`);
    }
    const priorLabel = labelByOrder.get(entry.order);
    if (priorLabel !== undefined && priorLabel !== entry.label) {
      throw new TypeError(`Case audience exclusions ${priorLabel} and ${entry.label} share a presentation order.`);
    }
    orderByLabel.set(entry.label, entry.order);
    labelByOrder.set(entry.order, entry.label);
  }
  return Object.freeze([...orderByLabel]
    .sort((left, right) => left[1] - right[1])
    .map(([label]) => label));
}

const CURRENT_AUDIENCE_EXCLUSIONS = Object.freeze({
  internal: currentAudienceExclusions('internal'),
  trusted: currentAudienceExclusions('trusted'),
  public: currentAudienceExclusions('public'),
} as const satisfies Record<CaseAudience, readonly string[]>);

// Schema 12 is an immutable public compatibility contract and deliberately
// remains independent of the current field-policy projection.
const PUBLIC_V12_EXCLUSIONS = Object.freeze([
  'Case notes',
  'Brand Profile references',
  'Actions and recipient values',
  'Analyst assertions',
  'Investigation branches',
  'Manual trail targets',
  'Raw upstream payloads and credentials',
]);

export function caseAudienceExclusions(
  audience: CaseAudience,
  caseVersion: number,
): readonly string[] {
  return audience === 'public' && caseVersion === PUBLIC_CASE_SCHEMA_VERSION
    ? PUBLIC_V12_EXCLUSIONS
    : CURRENT_AUDIENCE_EXCLUSIONS[audience];
}

export { CASE_FIELD_RULES };
