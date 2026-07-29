// One explicit inventory for optional threat-intelligence providers that can
// contribute to Deep Lookup. Runtime orchestration and the offline conformance
// suite both consume these exact definitions so adding a provider cannot omit
// the shared timeout, truncation, neutral-miss, and provenance checks silently.

import { THREATFOX_PROVIDER } from './threatfox-intelligence.mts';
import type { ThreatIntelligenceProviderDefinition } from './threat-intelligence-contract.mts';
import { URLHAUS_PROVIDER } from './urlhaus-intelligence.mts';
import { URLSCAN_PROVIDER } from './urlscan-intelligence.mts';

const LOOKUP_THREAT_INTELLIGENCE_PROVIDERS:
readonly ThreatIntelligenceProviderDefinition[] = Object.freeze([
  URLSCAN_PROVIDER,
  URLHAUS_PROVIDER,
  THREATFOX_PROVIDER,
]);

export {
  LOOKUP_THREAT_INTELLIGENCE_PROVIDERS,
  THREATFOX_PROVIDER,
  URLHAUS_PROVIDER,
  URLSCAN_PROVIDER,
};
