#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDER_POLICY_MAX_REVIEW_AGE_DAYS } from '../lib/provider-policy-admission.mts';
import { THREATFOX_PROVIDER } from '../lib/threatfox-intelligence.mts';
import type { ThreatIntelligenceProviderDefinition } from '../lib/threat-intelligence-types.mts';
import { URLHAUS_PROVIDER } from '../lib/urlhaus-intelligence.mts';
import { URLSCAN_PROVIDER } from '../lib/urlscan-intelligence.mts';

type WritableLike = { write(value: string): unknown };

export const PROVIDER_POLICY_FRESHNESS_SCHEMA = 'whoisleuth.provider-policy-freshness';
export const PROVIDER_POLICY_FRESHNESS_VERSION = 1;

export function buildProviderPolicyFreshnessReport(
  providers: readonly ThreatIntelligenceProviderDefinition[],
  now = new Date(),
) {
  const generatedAt = new Date(now).toISOString();
  const generatedTime = Date.parse(generatedAt);
  const entries = providers.map((provider) => {
    const reviewedTime = Date.parse(provider.terms.reviewedAt);
    const reviewAgeDays = Number.isFinite(reviewedTime)
      ? Math.max(0, Math.floor((generatedTime - reviewedTime) / 86_400_000))
      : null;
    return {
      id: provider.id,
      reviewedAt: provider.terms.reviewedAt,
      reviewAgeDays,
      state: reviewAgeDays !== null && reviewAgeDays <= PROVIDER_POLICY_MAX_REVIEW_AGE_DAYS ? 'fresh' as const : 'stale' as const,
      commercialUse: provider.terms.commercialUse,
      termsUrl: provider.terms.termsUrl,
      privacyUrl: provider.terms.privacyUrl,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema: PROVIDER_POLICY_FRESHNESS_SCHEMA,
    version: PROVIDER_POLICY_FRESHNESS_VERSION,
    generatedAt,
    maximumReviewAgeDays: PROVIDER_POLICY_MAX_REVIEW_AGE_DAYS,
    state: entries.every((entry) => entry.state === 'fresh') ? 'pass' as const : 'fail' as const,
    entries,
  };
}

export function providerPolicyFreshnessMain({
  stdout = process.stdout,
  stderr = process.stderr,
  now = new Date(),
}: {
  stdout?: WritableLike;
  stderr?: WritableLike;
  now?: Date;
} = {}): number {
  try {
    const report = buildProviderPolicyFreshnessReport([
      URLSCAN_PROVIDER,
      URLHAUS_PROVIDER,
      THREATFOX_PROVIDER,
    ], now);
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.state === 'pass' ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Provider policy freshness check failed.'}\n`);
    return 1;
  }
}

const isEntryPoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isEntryPoint) process.exitCode = providerPolicyFreshnessMain();
