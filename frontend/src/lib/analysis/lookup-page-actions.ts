import {
  prioritizeLookupSectionLinks,
  type LookupSectionLink,
  type LookupTaskView,
} from './lookup-presentation.ts';
import { prepareLookupCollectionTarget } from '../../../../packages/evidence/lookup-target.mts';

export { prepareLookupCollectionTarget };

type LookupMode = 'fast' | 'deep';
export type LookupEvidenceFamilyId =
  | 'overview'
  | 'registry'
  | 'web-evidence'
  | 'relationships-history'
  | 'source-quality'
  | 'case-response'
  | 'advanced-evidence';

const REGISTRY_EVIDENCE_TARGETS = new Set([
  '#evidence-registry',
]);
const WEB_EVIDENCE_TARGETS = new Set([
  '#web-evidence',
  '#evidence-network',
  '#evidence-dns',
  '#evidence-reverse-dns',
  '#evidence-http',
  '#evidence-tls',
  '#evidence-page',
  '#evidence-structured-identity',
  '#evidence-security-txt',
  '#evidence-technology',
  '#evidence-posture',
  '#evidence-certificate-policy',
  '#evidence-credential-surface',
  '#evidence-page-role',
  '#evidence-sslbl',
]);

const LOOKUP_EVIDENCE_TARGET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  '#evidence-network-context': '#evidence-network',
  '#evidence-page-identity': '#evidence-page',
});

type LookupRequestSelection = Readonly<{
  mode: LookupMode;
  includeExternalIntelligence: boolean;
  externalIntelligenceSupported: boolean;
  includeMalwareHostIntelligence: boolean;
  malwareHostIntelligenceSupported: boolean;
  includeMalwareIocIntelligence: boolean;
  malwareIocIntelligenceSupported: boolean;
  includeSecurityTxt: boolean;
  websiteObservationSupported: boolean;
  securityTxtEligible: boolean;
}>;

/** UI eligibility uses collection admission; address safety remains server-owned. */
export function lookupSecurityTxtEligible(entries: readonly string[]): boolean {
  if (entries.length !== 1 || !entries[0]) return false;
  try {
    const host = prepareLookupCollectionTarget(entries[0]);
    return host.includes('.') && !host.includes(':') && !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host);
  } catch {
    return false;
  }
}

/** Retain the analyst's draft, but disclose and request only eligible selections. */
export function eligibleLookupOptionalSources(selection: Omit<LookupRequestSelection, 'mode'>) {
  return {
    includeExternalIntelligence: selection.includeExternalIntelligence && selection.externalIntelligenceSupported,
    includeMalwareHostIntelligence: selection.includeMalwareHostIntelligence && selection.malwareHostIntelligenceSupported,
    includeMalwareIocIntelligence: selection.includeMalwareIocIntelligence && selection.malwareIocIntelligenceSupported,
    includeSecurityTxt: selection.includeSecurityTxt && selection.websiteObservationSupported && selection.securityTxtEligible,
  };
}

export function buildLookupRequestUrl(
  target: string,
  selection: LookupRequestSelection,
): string {
  const params = new URLSearchParams({ q: prepareLookupCollectionTarget(target) });
  if (selection.mode === 'fast') params.set('fast', '1');
  if (selection.mode === 'deep') {
    const eligible = eligibleLookupOptionalSources(selection);
    if (eligible.includeExternalIntelligence) params.set('intelligence', '1');
    if (eligible.includeMalwareHostIntelligence) params.set('malware', '1');
    if (eligible.includeMalwareIocIntelligence) params.set('ioc', '1');
    if (eligible.includeSecurityTxt) params.set('security_txt', '1');
  }
  return `/api/lookup?${params}`;
}

export function lookupEvidenceFamilyForHref(href: string): LookupEvidenceFamilyId | null {
  const normalized = lookupEvidenceTargetForHref(href);
  if (normalized === '#overview') return 'overview';
  if (normalized === '#registry' || REGISTRY_EVIDENCE_TARGETS.has(normalized)) return 'registry';
  if (WEB_EVIDENCE_TARGETS.has(normalized)) return 'web-evidence';
  if (normalized === '#relationships-history') return 'relationships-history';
  if (normalized === '#source-quality' || normalized === '#evidence-quality') return 'source-quality';
  if (normalized === '#case-response') return 'case-response';
  if (['#advanced-evidence', '#external-intelligence', '#raw-data'].includes(normalized)) return 'advanced-evidence';
  return null;
}

export function lookupEvidenceTargetForHref(href: string): string {
  return Object.hasOwn(LOOKUP_EVIDENCE_TARGET_ALIASES, href)
    ? LOOKUP_EVIDENCE_TARGET_ALIASES[href] ?? href
    : href;
}

export function buildLookupSectionLinks(input: {
  hasWebEvidence: boolean;
  domainResult: boolean;
  hasExternalIntelligence: boolean;
  hasCaseSection: boolean;
}): Array<{ href: `#${string}`; label: string }> {
  return [
    { href: '#overview', label: 'Overview' },
    { href: '#registry', label: 'Registration' },
    ...(input.hasWebEvidence
      ? [
          {
            href: '#web-evidence' as const,
            label: input.domainResult ? 'Web & DNS' : 'DNS',
          },
        ]
      : []),
    { href: '#relationships-history', label: 'Relationships & history' },
    { href: '#source-quality', label: 'Source quality' },
    ...(input.hasCaseSection
      ? [{ href: '#case-response' as const, label: 'Case & response' }]
      : []),
    { href: '#advanced-evidence', label: input.hasExternalIntelligence ? 'External & raw' : 'Advanced' },
  ];
}

export function buildLookupResultSectionLinks(input: {
  hasWebEvidence: boolean;
  domainResult: boolean;
  hasExternalIntelligence: boolean;
  hasCaseSection: boolean;
  task: LookupTaskView;
}): LookupSectionLink[] {
  return prioritizeLookupSectionLinks(buildLookupSectionLinks(input), input.task);
}

export type { LookupMode, LookupRequestSelection };
