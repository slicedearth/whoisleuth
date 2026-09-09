import { brandPostureObservationContext, type BrandProfile, type DesiredPostureObservation } from '../packages/workspace/brand-profile-model.mts';
import type { DomainPostureSourceContext } from '../packages/evidence/domain-posture-context.mts';

export function postureSource(source: DomainPostureSourceContext['source'], observedAt: string, state: DomainPostureSourceContext['state'] = 'complete'): DomainPostureSourceContext {
  return { version: 1, source, observedAt, state, omittedRecords: state === 'complete' ? 0 : null };
}

/** Attach a fixture's declared collection context, without changing its source evidence. */
export function postureObservation(profile: BrandProfile, domain: string, value: DesiredPostureObservation): DesiredPostureObservation {
  return { ...value, context: brandPostureObservationContext(profile, domain) };
}
