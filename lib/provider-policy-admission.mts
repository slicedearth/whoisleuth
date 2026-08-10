import type { ThreatIntelligenceProviderTerms } from './threat-intelligence-types.mts';

export const PROVIDER_POLICY_MAX_REVIEW_AGE_DAYS = 180;
export const PROVIDER_POLICY_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const DEPLOYMENT_PURPOSES = ['personal', 'internal', 'commercial'] as const;
export type DeploymentPurpose = typeof DEPLOYMENT_PURPOSES[number];

type EnvironmentInput = Record<string, unknown>;

export type ProviderPolicyAdmission = Readonly<{
  allowed: boolean;
  purpose: DeploymentPurpose | null;
  reviewAgeDays: number | null;
  reason: string | null;
}>;

function deploymentPurpose(value: unknown): DeploymentPurpose | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return DEPLOYMENT_PURPOSES.includes(normalized as DeploymentPurpose)
    ? normalized as DeploymentPurpose
    : null;
}

export function providerPolicyReviewAgeDays(reviewedAtValue: unknown, now: number): number | null {
  const reviewedAt = typeof reviewedAtValue === 'string' ? Date.parse(reviewedAtValue) : Number.NaN;
  if (!Number.isFinite(reviewedAt) || !Number.isFinite(now) || reviewedAt > now + PROVIDER_POLICY_MAX_FUTURE_SKEW_MS) {
    return null;
  }
  return Math.max(0, Math.floor((now - reviewedAt) / 86_400_000));
}

export function providerPolicyAdmission(
  terms: ThreatIntelligenceProviderTerms,
  env: EnvironmentInput | null | undefined = process.env,
  now = Date.now(),
): ProviderPolicyAdmission {
  const source = env && typeof env === 'object' ? env : {};
  const purpose = deploymentPurpose(source.WHOISLEUTH_DEPLOYMENT_PURPOSE);
  const reviewAgeDays = providerPolicyReviewAgeDays(terms.reviewedAt, now);
  if (!purpose) {
    return {
      allowed: false,
      purpose: null,
      reviewAgeDays,
      reason: 'Optional intelligence requires WHOISLEUTH_DEPLOYMENT_PURPOSE=personal, internal, or commercial.',
    };
  }
  if (reviewAgeDays === null || reviewAgeDays > PROVIDER_POLICY_MAX_REVIEW_AGE_DAYS) {
    return {
      allowed: false,
      purpose,
      reviewAgeDays,
      reason: `Optional intelligence provider policy review is older than ${PROVIDER_POLICY_MAX_REVIEW_AGE_DAYS} days or invalid.`,
    };
  }
  if (terms.commercialUse === 'unknown') {
    return {
      allowed: false,
      purpose,
      reviewAgeDays,
      reason: 'Optional intelligence commercial-use permission is unknown.',
    };
  }
  if (terms.commercialUse === 'restricted' && purpose !== 'personal') {
    return {
      allowed: false,
      purpose,
      reviewAgeDays,
      reason: `Optional intelligence is classified as restricted for the declared ${purpose} deployment purpose.`,
    };
  }
  return { allowed: true, purpose, reviewAgeDays, reason: null };
}
