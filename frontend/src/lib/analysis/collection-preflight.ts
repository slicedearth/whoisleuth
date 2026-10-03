import { plannedLookupSources } from '../../../../lib/lookup-progress.mts';
import { capabilityForSourceId } from '../../../../packages/contracts/capability-manifest.mts';
import type { Capability } from '../capabilities.ts';
import type { LookupTargetType } from './lookup-page-actions.ts';

export const COLLECTION_PREFLIGHT_VERSION = 1 as const;
export const MAX_COLLECTION_PREFLIGHT_SOURCES = 12;
export const MAX_COLLECTION_PREFLIGHT_NOTES = 6;

export type CollectionPreflightSourceState = 'included' | 'optional' | 'conditional' | 'disabled' | 'unavailable';

export interface CollectionPreflightSource {
  id: string;
  label: string;
  state: CollectionPreflightSourceState;
  disclosure: string;
}

export interface CollectionPreflight {
  version: typeof COLLECTION_PREFLIGHT_VERSION;
  kind: 'lookup' | 'bulk' | 'guided';
  heading: string;
  summary: string;
  targetCount: number;
  sources: CollectionPreflightSource[];
  persistence: string;
  controls: string[];
  cautions: string[];
}

interface LookupPreflightInput {
  mode: 'fast' | 'deep';
  targetCount: number;
  targetType?: LookupTargetType;
  capabilities?: readonly Capability[] | null;
  selectedUrl?: boolean;
  disabledSourceIds?: readonly string[];
  includeSecurityTxt?: boolean;
  includeExternalIntelligence?: boolean;
  includeMalwareHostIntelligence?: boolean;
  includeMalwareIocIntelligence?: boolean;
}

interface BulkPreflightInput {
  mode: 'fast' | 'deep';
  targetCount: number;
  concurrency: number;
  pacingLabel: string;
  disabledSourceIds?: readonly string[];
}

interface GuidedPreflightInput {
  label: string;
  requestImpact: string;
  prerequisite: string;
  requiresApproval: boolean;
  approved: boolean;
}

function normalizedIds(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).slice(0, MAX_COLLECTION_PREFLIGHT_SOURCES).map((value) => value.trim().toLowerCase()));
}

function source(
  id: string,
  label: string,
  disclosure: string,
  disabledIds: Set<string>,
  state: CollectionPreflightSourceState = 'included',
): CollectionPreflightSource {
  return {
    id,
    label,
    state: disabledIds.has(id) ? 'disabled' : state,
    disclosure: disabledIds.has(id) ? 'Disabled by deployment policy and not evaluated.' : disclosure,
  };
}

function boundedNotes(values: readonly string[]): string[] {
  return values.filter(Boolean).slice(0, MAX_COLLECTION_PREFLIGHT_NOTES);
}

export function buildLookupCollectionPreflight(input: LookupPreflightInput): CollectionPreflight {
  const targetCount = Math.max(0, Math.min(2_000, Math.floor(input.targetCount)));
  const disabledIds = normalizedIds(input.disabledSourceIds);
  const targetType = input.targetType ?? 'domain';
  const planned = new Set(targetType === 'unknown' ? [] : plannedLookupSources(targetType, input.mode));
  const domain = planned.has('domain_evidence');
  function lookupSource(id: string, label: string, disclosure: string, state: CollectionPreflightSourceState = 'included', dependencies: readonly string[] = [], capabilityId?: string): CollectionPreflightSource {
    const definition = capabilityForSourceId(capabilityId ?? id);
    const policyIds = [...new Set(['lookup', ...dependencies, ...(definition?.legacyCapability ? [definition.id] : definition?.featurePolicyId ? [definition.featurePolicyId] : [])])];
    if (policyIds.some(value => disabledIds.has(value))) return source(id, label, disclosure, new Set([id]), state);
    if (input.capabilities !== undefined) {
      const features = policyIds.map(value => input.capabilities?.find(item => item.id === value));
      const disabled = features.find(item => item?.status === 'disabled');
      if (disabled) return { id, label, state: 'disabled', disclosure: disabled.reason || 'Disabled by deployment policy and not evaluated.' };
      if (features.some(item => !item || item.status !== 'supported' || !item.scanModes.includes(input.mode))) {
        const unavailable = features.find(item => item && item.status !== 'supported');
        return { id, label, state: 'unavailable', disclosure: unavailable?.reason || 'Source configuration or eligibility is unavailable. This plan does not test it or authorise collection.' };
      }
    }
    return source(id, label, disclosure, disabledIds, state);
  }
  const sources = targetType === 'unknown' || targetCount !== 1 ? [] : input.mode === 'fast'
    ? [
        ...(domain ? [lookupSource('availability', 'Authority routing', 'Uses registry authority and bootstrap evidence. If registration evidence needs a DNS authority fallback, the resolver receives questions for the registrable domain; this is not a full DNS review.')] : []),
        lookupSource('rdap', 'RDAP', 'Collects registration or allocation evidence from the selected RDAP authority when supported.'),
      ]
    : [
        lookupSource('rdap', 'Registry RDAP', 'Collects structured registration or allocation evidence from the selected registry route.'),
        lookupSource('whois', 'WHOIS', 'Uses bounded referral-aware WHOIS collection when a usable service is published.'),
        ...(planned.has('reverse_dns') ? [lookupSource('reverse_dns', 'Reverse DNS', 'The resolver receives a bounded PTR question for an eligible public IP address. PTR labels do not establish hosting control or identity.', 'conditional', ['dns_intelligence'])] : []),
        ...(domain ? [
        lookupSource('dns_intelligence', 'DNS', 'Collects bounded registration, delegation, mail, and network records.', 'included', ['availability']),
        lookupSource('website_probe', 'Website', input.selectedUrl
          ? 'Sends the explicitly selected URL path and query to the website; fragments are not sent. Redirects and response handling remain bounded.'
          : 'Requests the exact public hostname with redirect revalidation and bounded response handling.', 'included', ['availability']),
        lookupSource('tls_intelligence', 'TLS', 'Collects bounded certificate and negotiated-connection evidence for eligible public endpoints.', 'included', ['availability']),
        lookupSource('registrar_rdap', 'Registrar RDAP', 'The registrable domain is sent to at most one eligible registry-advertised registrar service; the publication stays separate.', 'conditional', ['rdap']),
        lookupSource('network_context', 'Observed endpoint network context', 'One observed public address may be sent to RDAP. It does not establish every route or an origin host.', 'conditional', ['rdap', 'availability']),
        lookupSource('security_txt', 'security.txt', 'Requests the standardised disclosure-contact path on the exact hostname only when explicitly selected.', input.includeSecurityTxt ? 'included' : 'optional', ['website_probe']),
        lookupSource('external_intelligence', 'Archived web intelligence', 'Sends only the registrable domain to the selected archived-verdict search; no scan or report is submitted.', input.includeExternalIntelligence ? 'included' : 'optional', [], 'urlscan_search'),
        lookupSource('malware_host_intelligence', 'Malware host intelligence', 'Sends only the registrable domain to the selected host-record search; no URL, sample or report is submitted.', input.includeMalwareHostIntelligence ? 'included' : 'optional'),
        lookupSource('malware_ioc_intelligence', 'Malware infrastructure intelligence', 'Sends only the registrable domain to the selected retained-indicator search; no indicator or sample is submitted.', input.includeMalwareIocIntelligence ? 'included' : 'optional'),
        ] : []),
      ];
  return {
    version: COLLECTION_PREFLIGHT_VERSION,
    kind: 'lookup',
    heading: 'Collection preflight',
    summary: targetCount > 1
      ? `${targetCount} unique targets will be handed to Bulk without collecting. Review its separate plan before starting the queue.`
      : targetType === 'unknown' || !targetCount ? 'Enter one supported domain, IP address or ASN to review its eligible collection families.'
      : `${input.mode === 'deep' ? 'Deep' : 'Fast'} Lookup plans the eligible source families shown below for one ${targetType === 'domain' ? 'domain / hostname' : targetType === 'asn' ? 'ASN' : 'IP address'}.`,
    targetCount,
    sources: sources.slice(0, MAX_COLLECTION_PREFLIGHT_SOURCES),
    persistence: 'The request itself is not saved. Only an explicit case, watchlist, snapshot, or export action retains normalised evidence.',
    controls: boundedNotes([
      'Cancel stops this browser from waiting; server work already admitted may finish within existing limits.',
      'Optional third-party sources remain off unless selected.',
      'Use existing investigation templates or CLI configuration profiles to repeat supported choices. Website-only optional selections do not transfer to a CLI Lookup command.',
    ]),
    cautions: boundedNotes([
      'Redirects, referrals, source eligibility, and retries mean the exact request count cannot be known in advance.',
      'Unavailable or disabled sources remain unevaluated and are not treated as evidence of absence or safety.',
      'Live availability, remaining quota, cost and result fan-out are not measured by this offline plan. Review source quality and dated source refreshes after collection.',
    ]),
  };
}

export function buildBulkCollectionPreflight(input: BulkPreflightInput): CollectionPreflight {
  const targetCount = Math.max(0, Math.min(2_000, Math.floor(input.targetCount)));
  const disabledIds = normalizedIds(input.disabledSourceIds);
  const sources = input.mode === 'fast'
    ? [
        source('availability', 'Authority routing', 'Selects authoritative registration routes. If registration evidence needs a DNS authority fallback, the resolver receives questions for the registrable domain; this is not a full DNS review.', disabledIds),
        source('rdap', 'RDAP', 'Collects registration-first evidence without deep web or TLS enrichment.', disabledIds),
      ]
    : [
        source('rdap', 'Registration', 'Collects compact RDAP and eligible WHOIS evidence for triage.', disabledIds),
        source('whois', 'WHOIS', 'Collects bounded compact WHOIS evidence where supported.', disabledIds),
        source('dns_intelligence', 'DNS and mail', 'Collects compact DNS, delegation, and mail-posture signals.', disabledIds),
        source('website_probe', 'Website', 'Collects compact redirect, HTTP, identity, and technology signals.', disabledIds),
        source('tls_intelligence', 'TLS', 'Collects compact certificate and connection signals.', disabledIds),
      ];
  const concurrency = Math.max(1, Math.min(12, Math.floor(input.concurrency)));
  return {
    version: COLLECTION_PREFLIGHT_VERSION,
    kind: 'bulk',
    heading: 'Collection preflight',
    summary: `${targetCount} unique domain${targetCount === 1 ? '' : 's'} queued in ${input.mode === 'deep' ? 'Deep' : 'Fast'} mode.`,
    targetCount,
    sources: sources.slice(0, MAX_COLLECTION_PREFLIGHT_SOURCES),
    persistence: 'Results remain in this browser until explicitly saved to Monitor, a case, a snapshot, or an export.',
    controls: boundedNotes([
      `${input.pacingLabel}; at most ${concurrency} ${concurrency === 1 ? 'lookup runs' : 'lookups run'} in parallel.`,
      'Pause stops admitting new work. Cancel stops the queue after requests already in flight settle.',
    ]),
    cautions: boundedNotes([
      'Referrals, redirects, eligibility, caching and retries can change the number of requests; target and concurrency limits are not request quotas.',
      'Bulk Deep is a compact triage contract, not the complete single-domain Deep Lookup contract.',
      'Incomplete sources remain explicit and do not become negative findings.',
    ]),
  };
}

export function buildGuidedCollectionPreflight(input: GuidedPreflightInput): CollectionPreflight {
  return {
    version: COLLECTION_PREFLIGHT_VERSION,
    kind: 'guided',
    heading: 'Request review',
    summary: input.requestImpact.trim() || `Opening ${input.label} may start bounded collection.`,
    targetCount: 1,
    sources: [],
    persistence: 'Opening the tool does not itself retain evidence. The guide records progress locally; saving or exporting remains a separate analyst action.',
    controls: boundedNotes([
      input.requiresApproval
        ? input.approved ? 'Collection was approved for this guide step.' : 'Collection does not start until you approve and open this step.'
        : 'This step can open without an additional collection approval.',
    ]),
    cautions: boundedNotes([
      input.prerequisite.trim() || 'Confirm the target and collection authority before continuing.',
      'A completed guide step records analyst progress, not a claim that every source succeeded.',
    ]),
  };
}
