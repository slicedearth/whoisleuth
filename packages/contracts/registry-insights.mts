/** Version 1 is retained for exact historical evidence verification. */
export const LEGACY_REGISTRY_INSIGHTS_VERSION = 1;
export const REGISTRY_INSIGHTS_VERSION = 2;
export type RegistryInsightsVersion = typeof LEGACY_REGISTRY_INSIGHTS_VERSION | typeof REGISTRY_INSIGHTS_VERSION;

export function isSupportedRegistryInsightsVersion(value: unknown): value is RegistryInsightsVersion {
  return value === LEGACY_REGISTRY_INSIGHTS_VERSION || value === REGISTRY_INSIGHTS_VERSION;
}
