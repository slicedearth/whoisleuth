// Unified single-query orchestration shared by Express and Netlify.
//
// The browser used to call the RDAP, WHOIS, and availability functions
// separately. On serverless deployments those functions do not share an
// in-memory cache, so availability repeated registry work that RDAP/WHOIS had
// just performed. This module fetches each registration source once and feeds
// those exact results into availability classification.

import { fetchRdapRecord, fetchRegistrarRdapRecord } from './rdap.mts';
import { buildWhoisChain } from './whois.mts';
import { checkDomainAvailability } from './availability.mts';
import { abortable } from './abort.mts';
import {
  collectDnsIntelligence,
  collectReverseDnsIntelligence,
} from './dns-intelligence.mts';
import { createSelectedDnsResolvers } from './dns-resolver-selection.mts';
import { collectObservedNetworkContext } from './observed-network-context.mts';
import { collectSecurityTxt } from './security-txt.mts';
import type { ClassifiedQuery } from './classify.mts';
import { featureDecision, networkFeaturePolicy } from './feature-policy.mts';
import { lookupUrlscanDomain } from './urlscan-intelligence.mts';
import { lookupUrlhausDomain } from './urlhaus-intelligence.mts';
import { lookupThreatfoxDomain } from './threatfox-intelligence.mts';
import { inspectSslblCertificate } from './sslbl-intelligence.mts';
import type { ThreatIntelligenceResult } from './threat-intelligence-contract.mts';
import {
  normalizeLookupSourceSettlement,
  plannedLookupProgressSources,
  type LookupSourceSettlement,
} from './lookup-source-progress.mts';
import { buildUnifiedLookupResponse } from './lookup-response.mts';
import { createLookupTimingTracker } from './lookup-diagnostics.mts';
import type { LookupTimingSource } from './lookup-diagnostics.mts';

type LookupOptions = {
  fetchRdapRecord?: typeof fetchRdapRecord;
  fetchRegistrarRdapRecord?: typeof fetchRegistrarRdapRecord;
  buildWhoisChain?: typeof buildWhoisChain;
  checkDomainAvailability?: typeof checkDomainAvailability;
  collectReverseDnsIntelligence?: typeof collectReverseDnsIntelligence;
  collectObservedNetworkContext?: typeof collectObservedNetworkContext;
  collectSecurityTxt?: typeof collectSecurityTxt;
  lookupUrlscanDomain?: typeof lookupUrlscanDomain;
  lookupUrlhausDomain?: typeof lookupUrlhausDomain;
  lookupThreatfoxDomain?: typeof lookupThreatfoxDomain;
  inspectSslblCertificate?: typeof inspectSslblCertificate;
  sslblSnapshot?: unknown;
  sslblNow?: string | number | Date;
  fast?: boolean;
  compact?: boolean;
  externalIntelligence?: boolean;
  malwareHostIntelligence?: boolean;
  malwareIocIntelligence?: boolean;
  securityTxt?: boolean;
  featurePolicy?: ReturnType<typeof networkFeaturePolicy>;
  now?: () => number;
  onSourceSettled?: (settlement: LookupSourceSettlement) => void;
  signal?: AbortSignal;
  dnsResolverServers?: readonly string[];
};
async function runUnifiedLookup(classified: ClassifiedQuery, options: LookupOptions = {}) {
  const fetchRdap = options.fetchRdapRecord || fetchRdapRecord;
  const fetchRegistrarRdap = options.fetchRegistrarRdapRecord || fetchRegistrarRdapRecord;
  const fetchWhois = options.buildWhoisChain || buildWhoisChain;
  const checkAvailability = options.checkDomainAvailability || checkDomainAvailability;
  const selectedDnsResolvers = options.dnsResolverServers?.length
    ? createSelectedDnsResolvers(options.dnsResolverServers)
    : null;
  const collectReverseDns = options.collectReverseDnsIntelligence || collectReverseDnsIntelligence;
  const collectNetworkContext = options.collectObservedNetworkContext || collectObservedNetworkContext;
  const collectDisclosureContacts = options.collectSecurityTxt || collectSecurityTxt;
  const fetchUrlscanIntelligence = options.lookupUrlscanDomain || lookupUrlscanDomain;
  const fetchUrlhausIntelligence = options.lookupUrlhausDomain || lookupUrlhausDomain;
  const fetchThreatfoxIntelligence = options.lookupThreatfoxDomain || lookupThreatfoxDomain;
  const inspectCertificateWarningData = options.inspectSslblCertificate || inspectSslblCertificate;
  const fast = options.fast === true;
  const compact = options.compact === true;
  const externalIntelligence = options.externalIntelligence === true;
  const malwareHostIntelligence = options.malwareHostIntelligence === true;
  const malwareIocIntelligence = options.malwareIocIntelligence === true;
  const securityTxtRequested = options.securityTxt === true;
  const featurePolicy = options.featurePolicy || networkFeaturePolicy();
  const timing = createLookupTimingTracker(!fast && !compact, options.now || Date.now);
  const measure = <T,>(source: LookupTimingSource, operation: () => Promise<T> | T) => (
    timing.measure(source, () => abortable(operation, options.signal))
  );
  const rdapEnabled = featureDecision('rdap', featurePolicy).enabled;
  const whoisEnabled = featureDecision('whois', featurePolicy).enabled;
  const availabilityEnabled = featureDecision('availability', featurePolicy).enabled;
  const websiteProbeEnabled = featureDecision('website_probe', featurePolicy).enabled;
  const dnsIntelligenceEnabled = featureDecision('dns_intelligence', featurePolicy).enabled;
  const skipWhois = fast || !whoisEnabled;

  const rdapPromise = rdapEnabled
    ? measure('rdap', () => fetchRdap(classified.type, classified.value))
    : Promise.resolve(null);
  const whoisPromise = skipWhois
    ? Promise.resolve(null)
    : measure('whois', () => fetchWhois(classified.value));
  // Registrar RDAP is a separately attributed deep-lookup enrichment. It may
  // overlap the WHOIS chain, but it never joins the promises used to decide
  // availability and can add up to its own bounded timeout to a deep lookup.
  const registrarRdapPromise = classified.type === 'domain' && rdapEnabled && !fast && !compact
    ? rdapPromise.then((record) => record && record.upstreamStatus === 200 && record.parsed
        ? measure('registrar_rdap', () => fetchRegistrarRdap(classified.value, record))
        : null)
    : null;
  const availabilityPromise = classified.type === 'domain' && availabilityEnabled
    ? measure('domain_evidence', () => checkAvailability(classified.value, {
        fast,
        includeExtendedDnsContext: !compact,
        includeInheritedCaa: !fast && !compact,
        includeCredentialSurfaceProfile: !fast && !compact,
        includePublicationMetadata: !fast && !compact,
        includeDeliveryMetadata: !fast && !compact,
        includeStructuredDataIdentity: !fast && !compact,
        includeTechnologyProfile: !fast,
        includeSecurityPosture: !compact,
        featurePolicy,
        rdapRecordPromise: rdapPromise,
        whoisChainPromise: whoisPromise,
        ...(selectedDnsResolvers ? {
          dnsResolvers: selectedDnsResolvers,
          resolveNs: selectedDnsResolvers.resolveNs as (domain: string) => Promise<string[]>,
          collectDnsIntelligence,
        } : {}),
      }))
    : null;
  // Reverse DNS is separately attributed operator context for deep public-IP
  // lookups. It is never used by RDAP, WHOIS, availability, Risk, fast,
  // compact, Bulk, or monitoring contracts.
  const reverseDnsEligible = (classified.type === 'ipv4' || classified.type === 'ipv6')
    && !fast
    && !compact;
  const reverseDnsPromise = reverseDnsEligible && dnsIntelligenceEnabled
    ? measure('reverse_dns', () => collectReverseDns(classified.value))
    : null;
  // Network registration is an additive deep-only source. It starts only
  // after availability has produced the existing TLS/DNS observations and
  // never joins the evidence used to decide domain availability. The shared
  // RDAP helper supplies its existing three-minute cache and safe transport.
  const networkContextPromise = classified.type === 'domain'
    && rdapEnabled
    && availabilityEnabled
    && !fast
    && !compact
    && availabilityPromise
    ? availabilityPromise.then(
        (availability) => measure(
          'network_context',
          () => collectNetworkContext(availability, { fetchRdapRecord: fetchRdap }),
        ),
        () => measure(
          'network_context',
          () => collectNetworkContext({}, { fetchRdapRecord: fetchRdap }),
        ),
      )
    : null;
  // security.txt is an explicit, additive deep-lookup action. It uses the
  // exact queried hostname because RFC 9116 scopes a file to that hostname;
  // the result never joins registration, availability, or Risk inputs.
  const securityTxtPromise = securityTxtRequested
    && classified.type === 'domain'
    && websiteProbeEnabled
    && !fast
    && !compact
    ? measure('security_txt', () => collectDisclosureContacts(classified.inputHostname))
    : null;
  const urlscanIntelligencePromise: Promise<ThreatIntelligenceResult | null> | null = externalIntelligence
    && classified.type === 'domain'
    && !fast
    && !compact
    ? measure(
        'external_intelligence',
        () => fetchUrlscanIntelligence(classified.registrableDomain || classified.value),
      )
    : null;
  const urlhausIntelligencePromise: Promise<ThreatIntelligenceResult | null> | null = malwareHostIntelligence
    && classified.type === 'domain'
    && !fast
    && !compact
    ? measure(
        'malware_host_intelligence',
        () => fetchUrlhausIntelligence(classified.registrableDomain || classified.value),
      )
    : null;
  const threatfoxIntelligencePromise: Promise<ThreatIntelligenceResult | null> | null = malwareIocIntelligence
    && classified.type === 'domain'
    && !fast
    && !compact
    ? measure(
        'malware_ioc_intelligence',
        () => fetchThreatfoxIntelligence(classified.registrableDomain || classified.value),
      )
    : null;

  // Optional incremental presentation observes the same promises used by the
  // ordinary Lookup result. It starts no additional collection and cannot
  // alter, reject, or persist a source result. The callback receives only a
  // bounded source-health summary; raw payloads remain inside the final
  // response path.
  if (!fast && !compact && options.onSourceSettled) {
    const sourcePromises = new Map<
      Parameters<typeof normalizeLookupSourceSettlement>[0],
      Promise<unknown> | null
    >([
      ['rdap', rdapPromise],
      ['whois', whoisPromise],
      ['domain_evidence', availabilityPromise],
      ['reverse_dns', reverseDnsPromise],
      ['registrar_rdap', registrarRdapPromise],
      ['network_context', networkContextPromise],
      ['security_txt', securityTxtPromise],
      ['external_intelligence', urlscanIntelligencePromise],
      ['malware_host_intelligence', urlhausIntelligencePromise],
      ['malware_ioc_intelligence', threatfoxIntelligencePromise],
]);

    const notify = (
      source: Parameters<typeof normalizeLookupSourceSettlement>[0],
      outcome: 'fulfilled' | 'rejected',
      value: unknown,
    ) => {
      try {
        options.onSourceSettled?.(
          normalizeLookupSourceSettlement(source, outcome, value),
        );
      } catch {
        // Presentation callbacks must never change evidence collection.
      }
    };
    for (const source of plannedLookupProgressSources(classified, {
      externalIntelligence,
      malwareHostIntelligence,
      malwareIocIntelligence,
      securityTxt: securityTxtRequested,
    })) {
      const sourcePromise = sourcePromises.get(source) ?? null;
      void Promise.resolve(sourcePromise).then(
        (value) => notify(source, 'fulfilled', value),
        (error) => notify(source, 'rejected', error),
      );
    }
  }

  return buildUnifiedLookupResponse({
    availabilityEnabled,
    availabilityPromise,
    classified,
    compact,
    dnsIntelligenceEnabled,
    fast,
    inspectCertificateWarningData,
    networkContextPromise,
    options,
    rdapEnabled,
    rdapPromise,
    registrarRdapPromise,
    reverseDnsEligible,
    reverseDnsPromise,
    securityTxtPromise,
    skipWhois,
    threatfoxIntelligencePromise,
    timing,
    urlhausIntelligencePromise,
    urlscanIntelligencePromise,
    whoisEnabled,
    whoisPromise,
  });
}

export { runUnifiedLookup };
export {
  LOOKUP_DIAGNOSTICS_VERSION,
  LOOKUP_LEGACY_DIAGNOSTICS_VERSION,
  LOOKUP_TIMING_VERSION,
  MAX_LOOKUP_TIMING_MS,
  LOOKUP_ERROR_CODES,
} from './lookup-diagnostics.mts';
export type {
  LookupOptions,
  LookupSourceSettlement,
};
