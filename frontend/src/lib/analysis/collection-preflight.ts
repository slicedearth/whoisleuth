export const COLLECTION_PREFLIGHT_VERSION = 1 as const;
export const MAX_COLLECTION_PREFLIGHT_SOURCES = 12;
export const MAX_COLLECTION_PREFLIGHT_NOTES = 6;

export type CollectionPreflightSourceState = 'included' | 'optional' | 'disabled';

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
  const sources = input.mode === 'fast'
    ? [
        source('availability', 'Authority routing', 'Uses registry authority and bootstrap evidence to select an authoritative registration route.', disabledIds),
        source('rdap', 'RDAP', 'Collects registration evidence from the selected RDAP authority when supported.', disabledIds),
      ]
    : [
        source('rdap', 'Registry RDAP', 'Collects structured registration evidence from the selected registry route.', disabledIds),
        source('whois', 'WHOIS', 'Uses bounded referral-aware WHOIS collection when the registry publishes a usable service.', disabledIds),
        source('dns_intelligence', 'DNS', 'Collects bounded registration, delegation, mail, and network records.', disabledIds),
        source('website_probe', 'Website', 'Requests the exact public hostname with redirect revalidation and bounded response handling.', disabledIds),
        source('tls_intelligence', 'TLS', 'Collects bounded certificate and negotiated-connection evidence for eligible public endpoints.', disabledIds),
        source('security_txt', 'security.txt', 'Requests the standardized disclosure-contact path only when explicitly selected.', disabledIds, input.includeSecurityTxt ? 'included' : 'optional'),
        source('external_intelligence', 'Selected third-party intelligence', 'Sends only the registrable domain to each explicitly selected search provider; no scan or report is submitted.', disabledIds,
          input.includeExternalIntelligence || input.includeMalwareHostIntelligence || input.includeMalwareIocIntelligence ? 'included' : 'optional'),
      ];
  return {
    version: COLLECTION_PREFLIGHT_VERSION,
    kind: 'lookup',
    heading: 'Collection preflight',
    summary: targetCount > 1
      ? `${targetCount} unique targets will be handed to Bulk instead of starting a single Lookup request.`
      : `${input.mode === 'deep' ? 'Deep' : 'Fast'} Lookup will collect the eligible source families shown below for one target.`,
    targetCount,
    sources: sources.slice(0, MAX_COLLECTION_PREFLIGHT_SOURCES),
    persistence: 'The request itself is not saved. Only an explicit case, watchlist, snapshot, or export action retains normalized evidence.',
    controls: boundedNotes([
      'Cancel stops this browser from waiting; server work already admitted may finish within existing limits.',
      'Optional third-party sources remain off unless selected.',
    ]),
    cautions: boundedNotes([
      'Redirects, referrals, source eligibility, and retries mean the exact request count cannot be known in advance.',
      'Unavailable or disabled sources remain unevaluated and are not treated as evidence of absence or safety.',
    ]),
  };
}

export function buildBulkCollectionPreflight(input: BulkPreflightInput): CollectionPreflight {
  const targetCount = Math.max(0, Math.min(2_000, Math.floor(input.targetCount)));
  const disabledIds = normalizedIds(input.disabledSourceIds);
  const sources = input.mode === 'fast'
    ? [
        source('availability', 'Authority routing', 'Selects authoritative registration routes for each queued domain.', disabledIds),
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
