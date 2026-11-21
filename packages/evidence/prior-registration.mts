// Compares the current registration's creation date with independently dated
// public observations of the same registrable domain. A logged certificate or
// archive capture well before that date suggests the name was registered
// before; it never identifies an owner, a transfer or intent, and the absence
// of an earlier observation never establishes a first registration.

import { certificateChronologyEligibility, sourceEligibility } from './evidence-eligibility.mts';
import { normalizeExplicitIsoTimestamp } from './observation.mts';
import { registryDateIso } from './registry-dates.mts';

export const PRIOR_REGISTRATION_REVIEW_VERSION = 1;
/** Creation dates and observation clocks can differ by time zone and logging delay. */
export const PRIOR_REGISTRATION_TOLERANCE_HOURS = 48;
export const MAX_PRIOR_REGISTRATION_OBSERVATIONS = 8;

export type PriorRegistrationSource = 'certificate_log' | 'certificate_validity' | 'web_archive';
export type PriorRegistrationState = 'earlier_observation' | 'no_earlier_observation' | 'not_comparable';

export type PriorRegistrationObservation = Readonly<{
  source: PriorRegistrationSource;
  label: string;
  observedAt: string;
  /** Whole days before the current creation date, or null when not earlier beyond the tolerance. */
  daysBeforeRegistration: number | null;
  /**
   * Context only: a certificate validity start dates a certificate, not a
   * public observation of the name, so it never decides the review state.
   */
  context: boolean;
}>;

export type PriorRegistrationReview = Readonly<{
  version: typeof PRIOR_REGISTRATION_REVIEW_VERSION;
  state: PriorRegistrationState;
  registrationCreatedAt: string | null;
  observations: readonly PriorRegistrationObservation[];
  limitations: readonly string[];
}>;

const SOURCE_LABELS: Readonly<Record<PriorRegistrationSource, string>> = Object.freeze({
  certificate_log: 'Earliest logged certificate',
  // Context only, used when the certificate source published no log entry time.
  certificate_validity: 'Earliest certificate validity start',
  web_archive: 'Earliest web archive capture',
});
const CONTEXT_SOURCES: ReadonlySet<PriorRegistrationSource> = new Set(['certificate_validity']);
export const PRIOR_REGISTRATION_CONTEXT_LIMITATION = 'Certificate validity starts are context only. They date a certificate, not a public observation of the name, so they do not show an earlier registration.';
const DAY_MS = 86_400_000;
const TOLERANCE_MS = PRIOR_REGISTRATION_TOLERANCE_HOURS * 3_600_000;

export type RegistrationCreationCandidate = Readonly<{
  source: string;
  value: string | null;
  sourceState: string;
  complete: boolean | null;
}>;

/**
 * The first creation date reported by a successful, complete registration
 * source. A value retained from a failed, partial or incomplete source is shown
 * to the analyst elsewhere, but it is not evidence for this comparison.
 */
export function selectRegistrationCreation(candidates: readonly RegistrationCreationCandidate[]): Readonly<{ createdAt: string; source: string }> | null {
  for (const candidate of candidates) {
    if (!sourceEligibility({ state: candidate.sourceState, complete: candidate.complete }).eligible) continue;
    const createdAt = registryDateIso(candidate.value);
    if (createdAt) return Object.freeze({ createdAt, source: candidate.source });
  }
  return null;
}

/**
 * Comparison inputs from certificate-log provenance: the earliest eligible log
 * observation, plus the earliest validity start as context when the source
 * published no log time for some certificates. Shared by Lookup, Bulk and the
 * CLI so they compare the same evidence.
 */
export function certificatePriorRegistrationObservations(
  provenance: Readonly<{ firstObservedAt: string | null; chronologyContradicted?: boolean; firstValidFrom?: string }> | null | undefined,
): Readonly<{ source: PriorRegistrationSource; observedAt: string }>[] {
  if (!provenance) return [];
  return [
    ...(certificateChronologyEligibility(provenance).eligible && provenance.firstObservedAt
      ? [{ source: 'certificate_log' as const, observedAt: provenance.firstObservedAt }] : []),
    ...(provenance.firstValidFrom ? [{ source: 'certificate_validity' as const, observedAt: provenance.firstValidFrom }] : []),
  ];
}

export const PRIOR_REGISTRATION_STATE_LABELS: Readonly<Record<PriorRegistrationState, string>> = Object.freeze({
  earlier_observation: 'Observed before the current registration',
  no_earlier_observation: 'No earlier observation found',
  not_comparable: 'Not comparable',
});

export function reviewPriorRegistration(input: Readonly<{
  registrationCreatedAt: unknown;
  observations: readonly Readonly<{ source: PriorRegistrationSource; observedAt: unknown }>[];
}>): PriorRegistrationReview {
  const createdAt = registryDateIso(input.registrationCreatedAt);
  const created = createdAt === null ? null : Date.parse(createdAt);
  const observations = input.observations
    .slice(0, MAX_PRIOR_REGISTRATION_OBSERVATIONS)
    .filter((item) => Object.hasOwn(SOURCE_LABELS, item.source))
    .flatMap((item) => {
      const observedAt = normalizeExplicitIsoTimestamp(item.observedAt);
      if (observedAt === null) return [];
      const lead = created === null ? null : created - Date.parse(observedAt);
      return [Object.freeze({
        source: item.source,
        label: SOURCE_LABELS[item.source],
        observedAt,
        daysBeforeRegistration: lead !== null && lead > TOLERANCE_MS ? Math.floor(lead / DAY_MS) : null,
        context: CONTEXT_SOURCES.has(item.source),
      })];
    })
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));

  // Only historical observations (log entries and archive captures) decide
  // the state; validity-start context is reported beside them.
  const observed = observations.filter((item) => !item.context);
  const state: PriorRegistrationState = created === null || !observed.length ? 'not_comparable'
    : observed.some((item) => item.daysBeforeRegistration !== null) ? 'earlier_observation' : 'no_earlier_observation';
  const limitations = state === 'earlier_observation'
    ? ['An earlier logged certificate or archive capture suggests an earlier registration of this name. It does not identify a previous or current owner, a transfer or intent.']
    : state === 'no_earlier_observation'
      ? ['Certificate logs and web archives are incomplete, so this does not show that the current registration is the first.']
      : [createdAt === null
        ? 'No creation date is available from a successful, complete registration source.'
        : 'No dated certificate log or archive observation is available for comparison.'];
  if (observations.some((item) => item.context)) limitations.push(PRIOR_REGISTRATION_CONTEXT_LIMITATION);
  return Object.freeze({
    version: PRIOR_REGISTRATION_REVIEW_VERSION,
    state,
    registrationCreatedAt: createdAt,
    observations: Object.freeze(observations),
    limitations: Object.freeze(limitations),
  });
}
