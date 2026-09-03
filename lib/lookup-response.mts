// Lookup result shaping after the source plan has settled. This module starts no
// collection and preserves compact, diagnostics and enrichment response shapes.

import { buildBulkComparisonEvidence } from './bulk-comparison-evidence.mts';
import {
  failedReverseDnsIntelligence,
  skippedReverseDnsIntelligence,
} from './dns-intelligence.mts';
import {
  LOOKUP_DIAGNOSTICS_VERSION,
  LOOKUP_ERROR_CODES,
  LOOKUP_LEGACY_DIAGNOSTICS_VERSION,
  boundedSourceDetail,
  errorMessage,
} from './lookup-diagnostics.mts';
import { createThreatIntelligenceResult } from './threat-intelligence-contract.mts';
import {
  THREATFOX_PROVIDER,
  URLHAUS_PROVIDER,
  URLSCAN_PROVIDER,
} from './lookup-threat-provider-inventory.mts';
import { THREAT_INTELLIGENCE_ENVELOPE_VERSION } from './threat-intelligence-types.mts';
import { registryAccessDiagnosticFor } from './registry-capabilities.mts';
import { buildRegistryInsights } from './registry-insights.mts';
import { buildRegistrarStanding } from './registrar-standing.mts';
import { resolveRegistrarIanaId } from './registrar-standing-contract.mts';
import { securityTxtUnavailable } from './security-txt.mts';
import { parseWhoisChain } from './whois.mts';
import type { checkDomainAvailability } from './availability.mts';
import type { ClassifiedQuery } from './classify.mts';
import type { collectReverseDnsIntelligence } from './dns-intelligence.mts';
import type { createLookupTimingTracker } from './lookup-diagnostics.mts';
import type { collectObservedNetworkContext } from './observed-network-context.mts';
import type { fetchRdapRecord, fetchRegistrarRdapRecord } from './rdap.mts';
import type { collectSecurityTxt } from './security-txt.mts';
import type { inspectSslblCertificate } from './sslbl-intelligence.mts';
import type { ThreatIntelligenceResult } from './threat-intelligence-contract.mts';
import type { lookupThreatfoxDomain } from './threatfox-intelligence.mts';
import type { lookupUrlhausDomain } from './urlhaus-intelligence.mts';
import type { lookupUrlscanDomain } from './urlscan-intelligence.mts';
import type { buildWhoisChain } from './whois.mts';

type RegistrarRdap = Awaited<ReturnType<typeof fetchRegistrarRdapRecord>>;
type WhoisEnvelope = {
  skipped?: boolean;
  detail?: string;
  error?: string;
  chain?: unknown[];
  parsed?: ReturnType<typeof parseWhoisChain>;
};
type AvailabilityEnvelope = {
  applicable: boolean;
  type?: string;
  state?: string;
  [key: string]: unknown;
};
type LookupResponseOptions = {
  signal?: AbortSignal;
  sslblSnapshot?: unknown;
  sslblNow?: string | number | Date;
};
type LookupResponseContext = {
  classified: ClassifiedQuery;
  options: LookupResponseOptions;
  fast: boolean;
  compact: boolean;
  rdapEnabled: boolean;
  whoisEnabled: boolean;
  availabilityEnabled: boolean;
  dnsIntelligenceEnabled: boolean;
  reverseDnsEligible: boolean;
  skipWhois: boolean;
  timing: ReturnType<typeof createLookupTimingTracker>;
  inspectCertificateWarningData: typeof inspectSslblCertificate;
  rdapPromise: Promise<Awaited<ReturnType<typeof fetchRdapRecord>> | null>;
  whoisPromise: Promise<Awaited<ReturnType<typeof buildWhoisChain>> | null>;
  availabilityPromise: Promise<Awaited<ReturnType<typeof checkDomainAvailability>>> | null;
  reverseDnsPromise: Promise<Awaited<ReturnType<typeof collectReverseDnsIntelligence>>> | null;
  registrarRdapPromise: Promise<RegistrarRdap | null> | null;
  networkContextPromise: Promise<Awaited<ReturnType<typeof collectObservedNetworkContext>>> | null;
  securityTxtPromise: Promise<Awaited<ReturnType<typeof collectSecurityTxt>>> | null;
  urlscanIntelligencePromise: Promise<Awaited<ReturnType<typeof lookupUrlscanDomain>> | null> | null;
  urlhausIntelligencePromise: Promise<Awaited<ReturnType<typeof lookupUrlhausDomain>> | null> | null;
  threatfoxIntelligencePromise: Promise<Awaited<ReturnType<typeof lookupThreatfoxDomain>> | null> | null;
};

function withoutNestedPublicationMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = { ...(value as Record<string, unknown>) };
  delete output.publicationMetadata;
  return output;
}

function withoutNestedDeliveryMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = { ...(value as Record<string, unknown>) };
  if (output.response && typeof output.response === 'object' && !Array.isArray(output.response)) {
    const response = { ...(output.response as Record<string, unknown>) };
    delete response.deliveryMetadata;
    output.response = response;
  }
  return output;
}

async function buildUnifiedLookupResponse(context: LookupResponseContext) {
  const {
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
  } = context;
  const [rdapResult, whoisResult, availabilityResult, reverseDnsResult, registrarRdapResult, networkContextResult, securityTxtResult, urlscanIntelligenceResult, urlhausIntelligenceResult, threatfoxIntelligenceResult] = await Promise.allSettled([
    rdapPromise,
    whoisPromise,
    availabilityPromise,
    reverseDnsPromise,
    registrarRdapPromise,
    networkContextPromise,
    securityTxtPromise,
    urlscanIntelligencePromise,
    urlhausIntelligencePromise,
    threatfoxIntelligencePromise,
  ]);
  options.signal?.throwIfAborted();

  const rdapRecord = rdapResult.status === 'fulfilled' ? rdapResult.value : null;
  const whoisChain = whoisResult.status === 'fulfilled' ? whoisResult.value : null;
  const rdapAttempts = rdapRecord && Array.isArray(rdapRecord.attempts)
    ? rdapRecord.attempts
    : rdapResult.status === 'rejected' && Array.isArray(rdapResult.reason?.attempts)
      ? rdapResult.reason.attempts
      : [];

  let registrarRdap: RegistrarRdap | null = null;
  const registryRdapUsable = rdapRecord && rdapRecord.upstreamStatus === 200 && rdapRecord.parsed;
  if (classified.type === 'domain' && rdapEnabled && !compact && registryRdapUsable) {
    if (fast) {
      registrarRdap = {
        status: 'skipped',
        detail: 'Registrar RDAP is omitted in fast RDAP-only mode.',
        endpoint: null,
        transportSecurity: null,
        upstreamStatus: null,
        fetchedAt: null,
        attempt: null,
      };
    } else if (registrarRdapResult.status === 'fulfilled') {
      registrarRdap = registrarRdapResult.value;
    } else {
      registrarRdap = registrarRdapResult.reason?.registrarRdap || {
        status: 'error',
        detail: boundedSourceDetail(registrarRdapResult.reason, 'Registrar RDAP lookup failed'),
        endpoint: null,
        transportSecurity: null,
        upstreamStatus: null,
        fetchedAt: null,
        attempt: null,
      };
    }
  }

  const rdap = !rdapEnabled
    ? { skipped: true, detail: 'RDAP is disabled by deployment policy.' }
    : rdapRecord
    ? { ...rdapRecord, ...(registrarRdap ? { registrarRdap } : {}) }
    : {
        error: rdapResult.status === 'rejected'
          ? boundedSourceDetail(rdapResult.reason, 'RDAP lookup failed')
          : 'No RDAP registry found for this query via IANA bootstrap',
        attempts: rdapAttempts,
      };

  let whois: WhoisEnvelope;
  if (!whoisEnabled) {
    whois = { skipped: true, detail: 'WHOIS is disabled by deployment policy.' };
  } else if (skipWhois) {
    whois = { skipped: true, detail: 'WHOIS is omitted in fast RDAP-only mode.' };
  } else if (Array.isArray(whoisChain)) {
    whois = { chain: whoisChain, parsed: parseWhoisChain(whoisChain) };
  } else {
    whois = {
      error: whoisResult.status === 'rejected'
        ? boundedSourceDetail(whoisResult.reason, 'WHOIS lookup failed')
        : 'WHOIS returned no referral chain',
    };
  }

  let availability: AvailabilityEnvelope = { applicable: false, type: classified.type };
  if (classified.type === 'domain') {
    if (!availabilityEnabled) {
      availability = {
        applicable: true,
        domain: classified.value,
        state: 'unknown',
        confidence: 'low',
        disabled: true,
        detail: 'Availability analysis is disabled by deployment policy.',
      };
    } else if (availabilityResult.status === 'fulfilled') {
      const result = availabilityResult.value;
      availability = {
        applicable: true,
        domain: classified.value,
        inputHostname: classified.inputHostname,
        registrableDomain: classified.registrableDomain,
        isSubdomain: classified.isSubdomain,
        ...result,
      };
    } else {
      availability = {
        applicable: true,
        domain: classified.value,
        state: 'unknown',
        confidence: 'low',
        detail: errorMessage(availabilityResult.reason, 'Availability lookup failed'),
      };
    }
  }

  const rdapStatus = !rdapEnabled
    ? 'disabled'
    : rdapResult.status === 'rejected'
    ? 'error'
    : !rdapRecord
      ? 'unsupported'
      : rdapRecord.upstreamStatus === 404 ? 'not_found' : 'success';
  const whoisStatus = !whoisEnabled
    ? 'disabled'
    : skipWhois
    ? 'skipped'
    : whoisResult.status === 'rejected' || !Array.isArray(whoisChain)
      ? 'error'
      : whoisChain.length === 1
        ? 'unsupported'
      : whois.parsed && whois.parsed.chainStatus === 'complete' ? 'complete' : 'partial';
  const availabilityStatus = classified.type !== 'domain'
    ? 'not_applicable'
    : !availabilityEnabled ? 'disabled'
    : availabilityResult.status === 'rejected' ? 'error' : 'complete';
  const reverseDns = reverseDnsEligible
    ? !dnsIntelligenceEnabled
      ? skippedReverseDnsIntelligence()
      : reverseDnsResult.status === 'fulfilled' && reverseDnsResult.value
        ? reverseDnsResult.value
        : failedReverseDnsIntelligence(
            reverseDnsResult.status === 'rejected'
              ? reverseDnsResult.reason
              : 'Reverse DNS lookup returned no result',
          )
    : null;
  // This is static access-policy context only. It performs no network work and
  // is deliberately excluded from compact Bulk responses and from every
  // availability input.
  const registryAccess = classified.type === 'domain' && !compact
    ? registryAccessDiagnosticFor(classified.value)
    : null;
  const networkContext = networkContextPromise && networkContextResult.status === 'fulfilled'
    ? networkContextResult.value
    : null;
  const securityTxt = securityTxtPromise
    ? securityTxtResult.status === 'fulfilled'
      ? securityTxtResult.value
      : securityTxtUnavailable(classified.inputHostname, securityTxtResult.reason)
    : null;
  // SSLBL comparison is an exact, local, deep-only enrichment over the leaf
  // certificate already observed by the bounded TLS collector. It performs no
  // request, never contributes to availability, and is omitted from compact
  // Bulk and monitoring responses.
  const sslbl = classified.type === 'domain' && !fast && !compact
    ? inspectCertificateWarningData(
        availability && typeof availability.tls === 'object' ? availability.tls : null,
        {
          ...(options.sslblSnapshot === undefined ? {} : { snapshot: options.sslblSnapshot }),
          ...(options.sslblNow === undefined ? {} : { now: options.sslblNow }),
        },
      )
    : null;
  const networkContextRdap = networkContext && typeof networkContext.rdap === 'object' && networkContext.rdap
    ? networkContext.rdap as Record<string, unknown>
    : null;
  const networkContextEndpoint = networkContext && typeof networkContext.endpoint === 'object' && networkContext.endpoint
    ? networkContext.endpoint as Record<string, unknown>
    : null;

  const lookupTiming = timing.snapshot();
  const diagnostics = {
    version: lookupTiming ? LOOKUP_DIAGNOSTICS_VERSION : LOOKUP_LEGACY_DIAGNOSTICS_VERSION,
    ...(lookupTiming ? { timing: lookupTiming } : {}),
    ...(registryAccess ? { registryAccess } : {}),
    rdap: {
      status: rdapStatus,
      errorCode: rdapStatus === 'disabled'
        ? LOOKUP_ERROR_CODES.FEATURE_DISABLED
        : rdapStatus === 'error'
        ? LOOKUP_ERROR_CODES.RDAP_UPSTREAM_FAILED
        : rdapStatus === 'unsupported' ? LOOKUP_ERROR_CODES.RDAP_UNSUPPORTED : null,
      endpoint: rdapRecord ? rdapRecord.rdapServer || null : null,
      transportSecurity: rdapRecord ? rdapRecord.transportSecurity || null : null,
      httpStatus: rdapRecord ? rdapRecord.upstreamStatus ?? null : null,
      fetchedAt: rdapRecord ? rdapRecord.fetchedAt || null : null,
      attempts: rdapAttempts,
      ...(registrarRdap ? {
        registrar: {
          status: registrarRdap.status,
          endpoint: registrarRdap.endpoint || null,
          transportSecurity: registrarRdap.transportSecurity || null,
          httpStatus: registrarRdap.upstreamStatus ?? null,
          fetchedAt: registrarRdap.fetchedAt || null,
          attempt: registrarRdap.attempt || null,
        },
      } : {}),
    },
    whois: {
      status: whoisStatus,
      errorCode: whoisStatus === 'disabled'
        ? LOOKUP_ERROR_CODES.FEATURE_DISABLED
        : whoisStatus === 'error' ? LOOKUP_ERROR_CODES.WHOIS_UPSTREAM_FAILED : null,
      queriedAt: Array.isArray(whoisChain) && whoisChain[0] ? whoisChain[0].queriedAt || null : null,
      authoritativeHop: whois.parsed ? whois.parsed.authoritativeHop || null : null,
      failedHop: whois.parsed ? whois.parsed.failedHop || null : null,
      conflictingHop: whois.parsed ? whois.parsed.conflictingHop || null : null,
    },
    availability: {
      status: availabilityStatus,
      errorCode: availabilityStatus === 'disabled'
        ? LOOKUP_ERROR_CODES.FEATURE_DISABLED
        : availabilityStatus === 'error' ? LOOKUP_ERROR_CODES.AVAILABILITY_CHECK_FAILED : null,
      resultState: availability.applicable === true ? availability.state || 'unknown' : null,
    },
    ...(reverseDns ? {
      reverseDns: {
        status: reverseDns.status,
        observedAt: reverseDns.observedAt,
        complete: reverseDns.complete,
        truncated: reverseDns.truncated,
      },
    } : {}),
    ...(networkContext ? {
      network: {
        status: networkContext.status,
        address: networkContextEndpoint?.address || null,
        family: networkContextEndpoint?.family || null,
        addressSource: networkContextEndpoint?.selectedFrom || null,
        endpoint: networkContextRdap?.endpoint || null,
        transportSecurity: networkContextRdap?.transportSecurity || null,
        httpStatus: networkContextRdap?.httpStatus ?? null,
        fetchedAt: networkContextRdap?.fetchedAt || null,
        attempts: networkContextRdap?.attempts || [],
      },
    } : {}),
    ...(securityTxt ? {
      securityTxt: {
        status: securityTxt.status,
        state: securityTxt.state,
        endpoint: securityTxt.finalUrl,
        httpStatus: securityTxt.httpStatus,
        observedAt: securityTxt.observedAt,
        complete: securityTxt.complete,
        truncated: securityTxt.truncated,
      },
    } : {}),
    ...(sslbl ? {
      sslbl: {
        status: sslbl.status,
        verdict: sslbl.verdict,
        observedAt: sslbl.observedAt,
        complete: sslbl.complete,
        snapshotUpdatedAt: sslbl.snapshot.sourceUpdatedAt,
      },
    } : {}),
  };

  // Bulk triage only consumes the derived availability evidence and source
  // diagnostics. Omitting raw RDAP JSON and multi-hop WHOIS bodies from that
  // opt-in response prevents large scans from downloading and retaining the
  // same registry payloads the backend already used to build `availability`.
  if (compact) {
    const bulkComparison = !fast
      ? buildBulkComparisonEvidence(availability)
      : null;
    const {
      credentialSurfaceProfile: _credentialSurfaceProfile,
      structuredDataIdentity: _structuredDataIdentity,
      technologyProfile: _technologyProfile,
      pageRoleProfile: _pageRoleProfile,
      clientBehaviorProfile: _clientBehaviorProfile,
      securityPosture: _securityPosture,
      pageIdentity: richPageIdentity,
      http: richHttp,
      ...compactAvailability
    } = availability;
    return {
      availability: {
        ...compactAvailability,
        ...(richPageIdentity !== undefined ? { pageIdentity: withoutNestedPublicationMetadata(richPageIdentity) } : {}),
        ...(richHttp !== undefined ? { http: withoutNestedDeliveryMetadata(richHttp) } : {}),
        ...(bulkComparison ? { bulkComparison } : {}),
      },
      diagnostics,
    };
  }
  const targetDomain = classified.registrableDomain || classified.value;
  const threatIntelligenceProviders: ThreatIntelligenceResult[] = [];
  if (urlscanIntelligencePromise) {
    threatIntelligenceProviders.push(urlscanIntelligenceResult.status === 'fulfilled' && urlscanIntelligenceResult.value
      ? urlscanIntelligenceResult.value
      : createThreatIntelligenceResult(
          URLSCAN_PROVIDER,
          { type: 'domain', value: targetDomain },
          { state: 'error', detail: 'Archived provider intelligence could not be completed.' },
        ));
  }
  if (urlhausIntelligencePromise) {
    threatIntelligenceProviders.push(urlhausIntelligenceResult.status === 'fulfilled' && urlhausIntelligenceResult.value
      ? urlhausIntelligenceResult.value
      : createThreatIntelligenceResult(
          URLHAUS_PROVIDER,
          { type: 'domain', value: targetDomain },
          { state: 'error', detail: 'Malware-host intelligence could not be completed.' },
        ));
  }
  if (threatfoxIntelligencePromise) {
    threatIntelligenceProviders.push(threatfoxIntelligenceResult.status === 'fulfilled' && threatfoxIntelligenceResult.value
      ? threatfoxIntelligenceResult.value
      : createThreatIntelligenceResult(
          THREATFOX_PROVIDER,
          { type: 'domain', value: targetDomain },
          { state: 'error', detail: 'Malware-IOC intelligence could not be completed.' },
        ));
  }
  const threatIntelligence = threatIntelligenceProviders.length
    ? { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers: threatIntelligenceProviders }
    : null;
  const registrarRdapParsed = registrarRdap
    && typeof registrarRdap.parsed === 'object'
    && registrarRdap.parsed
    && !Array.isArray(registrarRdap.parsed)
    ? registrarRdap.parsed
    : null;
  const registryInsights = classified.type === 'domain' && !fast && !compact
    ? buildRegistryInsights({
        rdapParsed: rdapRecord?.parsed,
        rdapStatus,
        rdapFetchedAt: rdapRecord?.fetchedAt,
        whoisParsed: whois.parsed,
        whoisStatus,
        whoisQueriedAt: Array.isArray(whoisChain) && whoisChain[0] ? whoisChain[0].queriedAt : null,
        registrarRdapParsed,
        registrarRdapStatus: registrarRdap?.status,
        registrarRdapFetchedAt: registrarRdap?.fetchedAt,
      })
    : null;
  const registrarStanding = classified.type === 'domain' && !compact
    ? buildRegistrarStanding({
        registrarIanaId: resolveRegistrarIanaId(rdapRecord?.parsed, whois.parsed),
      })
    : null;
  return {
    rdap,
    whois,
    availability,
    diagnostics,
    ...(registryInsights ? { registryInsights } : {}),
    ...(registrarStanding ? { registrarStanding } : {}),
    ...(reverseDns ? { reverseDns } : {}),
    ...(networkContext ? { networkContext } : {}),
    ...(securityTxt ? { securityTxt } : {}),
    ...(sslbl ? { sslbl } : {}),
    ...(threatIntelligence ? { threatIntelligence } : {}),
  };
}

export { buildUnifiedLookupResponse };
