// Converts already-returned, separately attributed external observations into
// a conservative Risk contribution. Unknown providers and lone publisher
// families never contribute. Two adapters operated by the same publisher are
// deliberately one corroboration source, even when their datasets differ.

export const EXTERNAL_INTELLIGENCE_CALIBRATION_VERSION = 1;
export const EXTERNAL_INTELLIGENCE_RECENT_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = DAY_MS;
const MAX_PROVIDERS = 10;
const MAX_FINDINGS_PER_PROVIDER = 100;
const POSITIVE_STATES = new Set(['success', 'partial']);
const QUALIFYING_CATEGORIES = new Set(['phishing', 'malware']);

// Only built-in provider IDs can affect the built-in score. The two community
// malware datasets share one publisher family and therefore cannot corroborate
// one another by themselves.
const PUBLISHER_FAMILIES = Object.freeze({
  urlscan_search: 'archived-scan-publisher',
  urlhaus_host: 'community-malware-publisher',
  threatfox_domain_ioc: 'community-malware-publisher',
});

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function providerEvidence(value) {
  const provider = record(value);
  const identity = record(provider?.provider);
  const observation = record(provider?.observation);
  const providerId = typeof identity?.id === 'string' ? identity.id : '';
  const publisherFamily = Object.hasOwn(PUBLISHER_FAMILIES, providerId)
    ? PUBLISHER_FAMILIES[providerId]
    : null;
  if (!publisherFamily || !POSITIVE_STATES.has(provider?.state) || !Array.isArray(provider?.findings)) return null;

  const observedAt = timestamp(observation?.observedAt);
  let latestFindingAt = null;
  let qualifyingFindings = 0;
  for (const item of provider.findings.slice(0, MAX_FINDINGS_PER_PROVIDER)) {
    const finding = record(item);
    if (!finding || !QUALIFYING_CATEGORIES.has(finding.category)) continue;
    qualifyingFindings += 1;
    const candidate = timestamp(finding.lastObservedAt) ?? timestamp(finding.firstObservedAt);
    if (candidate !== null && (latestFindingAt === null || candidate > latestFindingAt)) latestFindingAt = candidate;
  }
  if (!qualifyingFindings) return null;

  let ageDays = null;
  if (observedAt !== null && latestFindingAt !== null && latestFindingAt <= observedAt + MAX_CLOCK_SKEW_MS) {
    ageDays = Math.max(0, Math.floor((observedAt - latestFindingAt) / DAY_MS));
  }
  return {
    providerId,
    publisherFamily,
    qualifyingFindings,
    lastObservedAt: latestFindingAt === null ? null : new Date(latestFindingAt).toISOString(),
    ageDays,
    recent: ageDays !== null && ageDays <= EXTERNAL_INTELLIGENCE_RECENT_DAYS,
  };
}

export function calibrateExternalIntelligenceRisk(value) {
  const envelope = record(value);
  const providers = Array.isArray(envelope?.providers) ? envelope.providers.slice(0, MAX_PROVIDERS) : [];
  const byProvider = new Map();
  for (const item of providers) {
    const evidence = providerEvidence(item);
    if (!evidence || byProvider.has(evidence.providerId)) continue;
    byProvider.set(evidence.providerId, evidence);
  }

  const sources = [...byProvider.values()].sort((a, b) => a.providerId.localeCompare(b.providerId));
  const publisherFamilies = new Set(sources.map((source) => source.publisherFamily));
  const recentPublisherFamilies = new Set(sources.filter((source) => source.recent).map((source) => source.publisherFamily));
  const knownAges = sources.map((source) => source.ageDays).filter((age) => age !== null);
  const independentPublisherCount = publisherFamilies.size;
  const recentPublisherCount = recentPublisherFamilies.size;

  let contribution = 0;
  let factor = null;
  if (independentPublisherCount >= 2) {
    contribution = recentPublisherCount >= 2 ? 18 : 10;
    factor = {
      label: recentPublisherCount >= 2
        ? 'Corroborated recent external phishing/malware records'
        : 'Corroborated external phishing/malware records',
      delta: contribution,
    };
  }

  return {
    version: EXTERNAL_INTELLIGENCE_CALIBRATION_VERSION,
    contribution,
    factor,
    eligibleProviderCount: sources.length,
    independentPublisherCount,
    recentPublisherCount,
    freshestAgeDays: knownAges.length ? Math.min(...knownAges) : null,
    unknownAgeProviderCount: sources.filter((source) => source.ageDays === null).length,
    sources,
  };
}
