// Compares the current registration's creation date with independently dated
// public observations of the same registrable domain. A logged certificate or
// archive capture well before that date suggests the name was registered
// before; it never identifies an owner, a transfer or intent, and the absence
// of an earlier observation never establishes a first registration.

import { normalizeExplicitIsoTimestamp } from './observation.mts';
import { registryDateIso } from './registry-dates.mts';

export const PRIOR_REGISTRATION_REVIEW_VERSION = 1;
/** Creation dates and observation clocks can differ by time zone and logging delay. */
export const PRIOR_REGISTRATION_TOLERANCE_HOURS = 48;
export const MAX_PRIOR_REGISTRATION_OBSERVATIONS = 8;

export type PriorRegistrationSource = 'certificate_log' | 'web_archive';
export type PriorRegistrationState = 'earlier_observation' | 'no_earlier_observation' | 'not_comparable';

export type PriorRegistrationObservation = Readonly<{
  source: PriorRegistrationSource;
  label: string;
  observedAt: string;
  /** Whole days before the current creation date, or null when not earlier beyond the tolerance. */
  daysBeforeRegistration: number | null;
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
  web_archive: 'Earliest web archive capture',
});
const DAY_MS = 86_400_000;
const TOLERANCE_MS = PRIOR_REGISTRATION_TOLERANCE_HOURS * 3_600_000;

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
      })];
    })
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));

  const state: PriorRegistrationState = created === null || !observations.length ? 'not_comparable'
    : observations.some((item) => item.daysBeforeRegistration !== null) ? 'earlier_observation' : 'no_earlier_observation';
  const limitations = state === 'earlier_observation'
    ? ['An earlier certificate or archive capture suggests an earlier registration of this name. It does not identify a previous or current owner, a transfer or intent.']
    : state === 'no_earlier_observation'
      ? ['Certificate logs and web archives are incomplete, so this does not show that the current registration is the first.']
      : [createdAt === null
        ? 'The current registration creation date is unavailable.'
        : 'No dated certificate or archive observation is available for comparison.'];
  return Object.freeze({
    version: PRIOR_REGISTRATION_REVIEW_VERSION,
    state,
    registrationCreatedAt: createdAt,
    observations: Object.freeze(observations),
    limitations: Object.freeze(limitations),
  });
}
