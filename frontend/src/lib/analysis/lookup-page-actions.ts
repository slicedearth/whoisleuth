import {
  prioritizeLookupSectionLinks,
  type LookupSectionLink,
  type LookupTaskView,
} from './lookup-presentation.ts';

type LookupMode = 'fast' | 'deep';
export type LookupEvidenceFamilyId = 'registry' | 'web-evidence';

const REGISTRY_EVIDENCE_TARGETS = new Set([
  '#evidence-registry',
  '#evidence-network',
]);
const WEB_EVIDENCE_TARGETS = new Set([
  '#evidence-dns',
  '#evidence-reverse-dns',
  '#evidence-http',
  '#evidence-tls',
  '#evidence-page',
  '#evidence-structured-identity',
  '#evidence-security-txt',
  '#evidence-technology',
  '#evidence-posture',
]);

type LookupRequestSelection = Readonly<{
  mode: LookupMode;
  includeExternalIntelligence: boolean;
  externalIntelligenceSupported: boolean;
  includeMalwareHostIntelligence: boolean;
  malwareHostIntelligenceSupported: boolean;
  includeMalwareIocIntelligence: boolean;
  malwareIocIntelligenceSupported: boolean;
  includeSecurityTxt: boolean;
  securityTxtSupported: boolean;
  securityTxtEligible: boolean;
}>;

export function buildLookupRequestUrl(
  target: string,
  selection: LookupRequestSelection,
): string {
  const params = new URLSearchParams({ q: target });
  if (selection.mode === 'fast') params.set('fast', '1');
  if (
    selection.mode === 'deep' &&
    selection.includeExternalIntelligence &&
    selection.externalIntelligenceSupported
  ) {
    params.set('intelligence', '1');
  }
  if (
    selection.mode === 'deep' &&
    selection.includeMalwareHostIntelligence &&
    selection.malwareHostIntelligenceSupported
  ) {
    params.set('malware', '1');
  }
  if (
    selection.mode === 'deep' &&
    selection.includeMalwareIocIntelligence &&
    selection.malwareIocIntelligenceSupported
  ) {
    params.set('ioc', '1');
  }
  if (
    selection.mode === 'deep' &&
    selection.includeSecurityTxt &&
    selection.securityTxtSupported &&
    selection.securityTxtEligible
  ) {
    params.set('security_txt', '1');
  }
  return `/api/lookup?${params}`;
}

export function lookupEvidenceFamilyForHref(href: string): LookupEvidenceFamilyId | null {
  if (REGISTRY_EVIDENCE_TARGETS.has(href)) return 'registry';
  if (WEB_EVIDENCE_TARGETS.has(href)) return 'web-evidence';
  return null;
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
