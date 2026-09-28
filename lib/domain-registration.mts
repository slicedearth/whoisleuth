// Registration authority, lifecycle dates and positive-only delegation evidence.
import { promises as dns } from 'node:dns';
import { abortable } from './abort.mts';
import { fetchRdapRecord } from './rdap.mts';
import { buildWhoisChain, parseWhoisChain } from './whois.mts';
import { featureDecision, networkFeaturePolicy } from './feature-policy.mts';
import { parseRegistryDate, registryDateIso } from './registry-dates.mts';
import { nonEmptyErrorMessage } from './error-detail.mts';
import { registryServiceAdmissionFor } from './registry-capabilities.mts';
import { recordOrEmpty as errorRecord } from './json-record.mts';

const DNS_DELEGATION_TIMEOUT_MS = 4000;
const MAX_DELEGATION_NAMESERVERS = 50;
const MISSING_DNS_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENONAME', 'NXDOMAIN']);

type UnknownRecord = Record<string, unknown>;
type CompactContact = {
  handle: unknown;
  ianaId?: unknown;
  name: unknown;
  org: unknown;
  email: unknown;
  phone: unknown;
  address?: unknown;
};
type DnsDelegation = {
  delegated: boolean;
  nameservers: string[];
  nameserversTruncated: boolean;
  error: string | null;
};
function registryStatusToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function rdapEventDate(events: UnknownRecord[], action: string): string | null {
  const date = events.find((event) => event.action === action)?.date;
  return typeof date === 'string' ? date : null;
}
export type RegistrationOptions = {
  signal?: AbortSignal;
  fast?: boolean;
  featurePolicy?: ReturnType<typeof networkFeaturePolicy>;
  rdapRecord?: unknown;
  whoisChain?: Awaited<ReturnType<typeof buildWhoisChain>> | null;
  rdapRecordPromise?: Promise<unknown>;
  whoisChainPromise?: Promise<Awaited<ReturnType<typeof buildWhoisChain>> | null>;
  dnsDelegation?: DnsDelegation | null;
  resolveNs?: (domain: string) => Promise<string[]>;
};
type RegistrationSource = 'rdap' | 'whois' | 'dns' | null;
type RegistrationConfidence = 'high' | 'medium';
function computeAgeDays(dateStr: unknown): number | null {
  const d = parseRegistryDate(dateStr);
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
}

function computeDaysUntil(dateStr: unknown): number | null {
  const d = parseRegistryDate(dateStr);
  return d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : null;
}

const PRIVACY_MARKERS = [
  /redacted for privacy/i,
  /data protected/i,
  /privacy\s*protect/i,
  /whoisguard/i,
  /domains by proxy/i,
  /perfect privacy/i,
  /contact privacy/i,
  /private registration/i,
  /identity protect/i,
  /not disclosed/i,
  /withheld for privacy/i,
];

// Explicit privacy/redaction markers establish a positive privacy signal.
// Usable public contact data establishes a negative one. A missing or blank
// contact can instead reflect registry policy, access tier, parser coverage,
// or ordinary omission, so it remains inconclusive rather than being promoted
// to an affirmative privacy claim.
function isPrivacyProtected(registrant: CompactContact | null): boolean | null {
  if (!registrant) return null;
  const blob = [registrant.name, registrant.org, registrant.email].filter(Boolean).join(' ');
  if (!blob) return null;
  return PRIVACY_MARKERS.some((re) => re.test(blob));
}

// RDAP Lookup retains a bounded multi-value contact inventory, but Bulk and
// watchlist availability records deliberately keep the historical compact
// shape. This prevents repeated contact arrays and registry links from
// expanding browser-local stores or flowing into case evidence implicitly.
function compactContact(contact: unknown): CompactContact | null {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return null;
  const value = contact as UnknownRecord;
  const compact = {
    handle: value.handle || null,
    name: value.name || null,
    org: value.org || null,
    email: value.email || null,
    phone: value.phone || null,
    address: value.address || null,
  };
  return Object.values(compact).some(Boolean) ? compact : null;
}

// A number of ccTLD registries publish neither an RDAP bootstrap entry nor a
// generally reachable port-43 WHOIS service. A positive NS answer cannot
// replace registry registration data, but it does prove that the registrable
// domain has an active DNS delegation. Use that as a bounded, positive-only
// fallback: no answer is never interpreted as availability because registered
// domains can legitimately be undelegated.
async function checkDnsDelegation(domain: string, options: {
  resolver?: (domain: string) => Promise<string[]>;
  signal?: AbortSignal;
} = {}): Promise<DnsDelegation> {
  options.signal?.throwIfAborted();
  // Cancel only this lookup's c-ares requests, never the shared DNS resolver.
  const ownedResolver = options.resolver ? null : new dns.Resolver();
  const resolve = options.resolver || ((name: string) => ownedResolver!.resolveNs(name));
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const cancel = () => ownedResolver?.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('DNS delegation lookup timed out')), DNS_DELEGATION_TIMEOUT_MS);
  try {
    const records = await abortable(() => resolve(domain), signal);
    const validNameservers = [...new Set((Array.isArray(records) ? records : [])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim().replace(/\.+$/, '').toLowerCase())
      .filter((value) => value.length > 0 && value.length <= 253)
      .filter((value) => value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))]
      .sort();
    const normalized = validNameservers.slice(0, MAX_DELEGATION_NAMESERVERS);
    return {
      delegated: normalized.length > 0,
      nameservers: normalized,
      nameserversTruncated: validNameservers.length > MAX_DELEGATION_NAMESERVERS,
      error: null,
    };
  } catch (err) {
    options.signal?.throwIfAborted();
    const error = errorRecord(err);
    if (typeof error.code === 'string' && MISSING_DNS_CODES.has(error.code)) {
      return { delegated: false, nameservers: [], nameserversTruncated: false, error: null };
    }
    return {
      delegated: false,
      nameservers: [],
      nameserversTruncated: false,
      error: nonEmptyErrorMessage(err, String(err)).slice(0, 180),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
function registryPolicyDetail(domain: string, fast: boolean): string {
  const details: string[] = [];
  const rdapAdmission = registryServiceAdmissionFor(domain, 'rdap');
  if (rdapAdmission && !rdapAdmission.allowed) {
    details.push('RDAP was not queried because the registry access policy does not permit collection.');
  }
  const whoisAdmission = fast ? null : registryServiceAdmissionFor(domain, 'whois');
  if (whoisAdmission && !whoisAdmission.allowed) {
    details.push(whoisAdmission.state === 'permission_required'
      ? 'WHOIS was not queried because registry permission or source authorisation is required.'
      : 'WHOIS was not queried because IANA publishes no domain WHOIS service for this suffix.');
  }
  return details.length ? ` ${details.join(' ')}` : '';
}

// fast: true skips the WHOIS fallback (no TCP:43 chain) and the homepage
// fetch (no for-sale/parking detection) - just RDAP plus the signals
// derivable from it (age, expiry proximity, privacy). Meant for scanning
// large sourcing candidate lists quickly and gently on registry rate
// limits; anything it can't resolve (state "unknown") is meant to get a
// follow-up deep check (fast: false, the default) on the shortlist only.
async function resolveDomainRegistration(domain: string, options: RegistrationOptions, featurePolicy: ReturnType<typeof networkFeaturePolicy>) {
  options.signal?.throwIfAborted();
  const fast = options.fast === true;
  const rdapEnabled = featureDecision('rdap', featurePolicy).enabled;
  const whoisEnabled = featureDecision('whois', featurePolicy).enabled;
  const dnsIntelligenceEnabled = featureDecision('dns_intelligence', featurePolicy).enabled;
  const hasPreloadedRdap = Object.prototype.hasOwnProperty.call(options, 'rdapRecord');
  const hasPreloadedWhois = Object.prototype.hasOwnProperty.call(options, 'whoisChain');
  const hasPreloadedRdapPromise = Object.prototype.hasOwnProperty.call(options, 'rdapRecordPromise');
  const hasPreloadedWhoisPromise = Object.prototype.hasOwnProperty.call(options, 'whoisChainPromise');
  const hasPreloadedDnsDelegation = Object.prototype.hasOwnProperty.call(options, 'dnsDelegation');
  let nameservers: string[] = [];
  let statuses: string[] = [];
  let rdapServer: string | null = null;
  let rdapFound = false;
  let registrar: CompactContact | null = null;
  let registrant: CompactContact | null = null;
  let abuse: CompactContact | null = null;
  let createdDate: string | null = null;
  let expiryDate: string | null = null;
  let createdDateIso: string | null = null;
  let expiryDateIso: string | null = null;
  let registrationSource: RegistrationSource = null;
  let registrationConfidence: RegistrationConfidence = 'high';
  let dnssec: string | null = null;
  let registryDnsEvidence: unknown = null;
  const assessment = <T extends { state: string; confidence: string; detail: string }>(registration: T) => ({
    registration, registryDnsEvidence, nameservers, dnssec,
  });

  if (rdapEnabled) {
    try {
      // Shared with /api/rdap (lib/rdap.mts's fetchRdapRecord) rather than a
      // separate fetch+parse here - same registry data either way, and this
      // also picks up that function's short-TTL cache (lib/lookup-cache.mts)
      // and upstream timeout for free.
      const recordValue = hasPreloadedRdapPromise
        ? await abortable(() => options.rdapRecordPromise!, options.signal)
        : hasPreloadedRdap
          ? options.rdapRecord
          : await fetchRdapRecord('domain', domain, options.signal ? { signal: options.signal } : {});
      options.signal?.throwIfAborted();
      const record = errorRecord(recordValue);
      const recordRdapServer = typeof record.rdapServer === 'string' ? record.rdapServer : null;
      const upstreamStatus = typeof record.upstreamStatus === 'number' ? record.upstreamStatus : null;
      if (Object.keys(record).length) {
        rdapServer = recordRdapServer;
        if (upstreamStatus === 404) {
          return assessment({
            state: 'available',
            confidence: 'high',
            detail: 'The registry\'s RDAP service has no record for this domain.',
            source: 'rdap',
            rdapServer: recordRdapServer,
          });
        }
        const parsed = errorRecord(record.parsed);
        if (Object.keys(parsed).length) {
          registryDnsEvidence = parsed;
          statuses = Array.isArray(parsed.statuses)
            ? parsed.statuses.filter((status: unknown): status is string => typeof status === 'string').map((status: string) => status.toLowerCase())
            : [];
          nameservers = Array.isArray(parsed.nameservers)
            ? parsed.nameservers.filter((nameserver: unknown): nameserver is string => typeof nameserver === 'string')
            : [];
          registrar = compactContact(parsed.registrar);
          registrant = compactContact(parsed.registrant);
          abuse = compactContact(parsed.abuse);
          const events = Array.isArray(parsed.events)
            ? parsed.events.map(errorRecord)
            : [];
          const lifecycle = errorRecord(parsed.lifecycle);
          createdDate = typeof lifecycle.createdDate === 'string'
            ? lifecycle.createdDate
            : rdapEventDate(events, 'registration');
          expiryDate = typeof lifecycle.expiryDate === 'string'
            ? lifecycle.expiryDate
            : rdapEventDate(events, 'expiration');
          createdDateIso = typeof lifecycle.createdDateIso === 'string'
            ? lifecycle.createdDateIso
            : registryDateIso(createdDate);
          expiryDateIso = typeof lifecycle.expiryDateIso === 'string'
            ? lifecycle.expiryDateIso
            : registryDateIso(expiryDate);
          dnssec = typeof parsed.dnssec === 'string' ? parsed.dnssec : null;
          rdapFound = true;
          registrationSource = 'rdap';
        }
      }
    } catch {
      options.signal?.throwIfAborted();
      /* fall through to WHOIS-based detection (deep mode only) */
    }
  }

  const dnsDelegationPromise = !rdapFound && dnsIntelligenceEnabled
    ? hasPreloadedDnsDelegation
      ? Promise.resolve(options.dnsDelegation)
      : checkDnsDelegation(domain, {
          ...(options.resolveNs ? { resolver: options.resolveNs } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        })
    : null;

  // DNS may settle while the independent WHOIS source is still pending. Keep
  // its rejection observed even if WHOIS supplies an early conclusive return.
  void dnsDelegationPromise?.catch(() => {});

  let whoisChain: Awaited<ReturnType<typeof buildWhoisChain>> | null = null;
  let whoisParsed: ReturnType<typeof parseWhoisChain> | null = null;
  if (!rdapFound && !fast && whoisEnabled) {
    try {
      whoisChain = (hasPreloadedWhoisPromise
        ? await abortable(() => options.whoisChainPromise!, options.signal)
        : hasPreloadedWhois
          ? options.whoisChain
          : await buildWhoisChain(domain, options.signal ? { signal: options.signal } : {})) ?? null;
      options.signal?.throwIfAborted();
      if (!Array.isArray(whoisChain)) throw new Error('WHOIS chain unavailable');
      const parsed = parseWhoisChain(whoisChain, domain);
      whoisParsed = parsed;
      if (parsed.notFound) {
        return assessment({
          state: 'available',
          confidence: 'medium',
          detail: `WHOIS reports no matching record for this domain${parsed.notFoundSource ? ` (per ${parsed.notFoundSource})` : ''}.`,
          source: 'whois',
        });
      }
      if (parsed.registrationStatus === 'registered') {
        if (parsed.nameservers.length) nameservers = parsed.nameservers;
        if (parsed.statuses.length) statuses = parsed.statuses.map((status: string) => status.toLowerCase());
        if (parsed.registrar) {
          registrar = {
            handle: null,
            ianaId: parsed.registrarIanaId || null,
            name: parsed.registrar,
            org: null,
            email: parsed.abuseEmail || null,
            phone: parsed.abusePhone || null,
          };
        }
        if (parsed.registrantName || parsed.registrantOrg || parsed.registrantEmail || parsed.registrantPhone) {
          registrant = {
            handle: null,
            name: parsed.registrantName || null,
            org: parsed.registrantOrg || null,
            email: parsed.registrantEmail || null,
            phone: parsed.registrantPhone || null,
          };
        }
        if (parsed.abuseEmail || parsed.abusePhone) {
          abuse = { handle: null, name: null, org: parsed.registrar || null, email: parsed.abuseEmail || null, phone: parsed.abusePhone || null };
        }
        createdDate = parsed.createdDate || null;
        expiryDate = parsed.expiryDate || null;
        createdDateIso = parsed.createdDateIso || parsed.lifecycle?.createdDateIso || registryDateIso(createdDate);
        expiryDateIso = parsed.expiryDateIso || parsed.lifecycle?.expiryDateIso || registryDateIso(expiryDate);
        if (!dnssec) dnssec = parsed.dnssec || null;
        registrationSource = 'whois';
      }
    } catch {
      options.signal?.throwIfAborted();
      /* if both RDAP and WHOIS fail, we simply can't determine availability */
    }
  }

  // WHOIS ran and was not a confirmed not-found, but produced no positive
  // registration evidence either - e.g. the registry answered inconclusively
  // or every referral hop failed/rate-limited. Report "unknown" rather than
  // fabricating "registered" from an empty record.
  const hasWhoisRegistrationData = whoisParsed?.registrationStatus === 'registered';
  let dnsDelegated = false;
  if (!rdapFound && !hasWhoisRegistrationData && dnsDelegationPromise) {
    const delegation = await dnsDelegationPromise;
    if (delegation && delegation.delegated === true && Array.isArray(delegation.nameservers) && delegation.nameservers.length) {
      dnsDelegated = true;
      nameservers = delegation.nameservers;
      registrationSource = 'dns';
      registrationConfidence = 'medium';
    }
  }
  options.signal?.throwIfAborted();

  if (!rdapFound && !hasWhoisRegistrationData && !dnsDelegated) {
    const disabledSources = [
      !rdapEnabled ? 'RDAP' : null,
      !fast && !whoisEnabled ? 'WHOIS' : null,
      !dnsIntelligenceEnabled ? 'DNS intelligence' : null,
    ].filter(Boolean);
    const disabledDetail = disabledSources.length
      ? ` ${disabledSources.join(', ')} ${disabledSources.length === 1 ? 'is' : 'are'} disabled by deployment policy.`
      : '';
    const policyDetail = registryPolicyDetail(domain, fast);
    return assessment({
      state: 'unknown',
      confidence: 'low',
      detail: fast
        ? `No enabled registration source produced a record or authoritative delegation. A fast scan cannot determine registration status.${disabledDetail}${policyDetail}`
        : whoisParsed && whoisParsed.failedHop
        ? `WHOIS was inconclusive - a referral hop did not answer conclusively (${whoisParsed.failedHop}).${policyDetail}`
        : `No enabled registration source returned conclusive data or an authoritative DNS delegation.${disabledDetail}${policyDetail}`,
      ...(!fast && whoisEnabled ? { source: 'whois' } : {}),
    });
  }

  const domainAgeDays = computeAgeDays(createdDateIso || createdDate);
  const expiresInDays = computeDaysUntil(expiryDateIso || expiryDate);
  // DNS proves delegation only; it says nothing about whether registry
  // contact data is privacy-protected or merely unavailable.
  const privacyProtected = registrationSource === 'dns' ? null : isPrivacyProtected(registrant);

  const baseInfo = {
    nameservers,
    statuses,
    registrar,
    registrant,
    abuse,
    createdDate,
    expiryDate,
    createdDateIso,
    expiryDateIso,
    rdapServer,
    domainAgeDays,
    expiresInDays,
    privacyProtected,
    dnssec,
    source: registrationSource,
  };

  if (statuses.some((status) => {
    const normalizedStatus = registryStatusToken(status);
    return normalizedStatus.includes('pendingdelete') || normalizedStatus.includes('redemptionperiod');
  })) {
    return assessment({
      state: 'expiring',
      confidence: 'medium',
      detail: 'Domain is in redemption/pending-delete status and may become available soon.',
      ...baseInfo,
    });
  }

  return assessment({
      state: 'registered',
      confidence: registrationConfidence,
      detail: registrationSource === 'dns'
        ? 'Authoritative DNS delegation confirms the domain is registered, but RDAP/WHOIS registration details were unavailable.'
        : 'Domain is registered. Run a deep check for parking/for-sale detection.',
      ...baseInfo,
    });
}

export { resolveDomainRegistration, checkDnsDelegation, isPrivacyProtected };
export type RegistrationAssessment = Awaited<ReturnType<typeof resolveDomainRegistration>>;
