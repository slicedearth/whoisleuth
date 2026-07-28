type LookupMode = 'fast' | 'deep';

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

export function buildLookupSectionLinks(input: {
  hasWebEvidence: boolean;
  domainResult: boolean;
  hasExternalIntelligence: boolean;
  hasCaseSection: boolean;
}): Array<{ href: `#${string}`; label: string }> {
  return [
    { href: '#overview', label: 'Overview' },
    ...(input.hasWebEvidence
      ? [
          {
            href: '#web-evidence' as const,
            label: input.domainResult ? 'Web & DNS' : 'DNS',
          },
        ]
      : []),
    { href: '#registry', label: 'Registry' },
    ...(input.hasExternalIntelligence
      ? [{ href: '#external-intelligence' as const, label: 'External intel' }]
      : []),
    ...(input.hasCaseSection
      ? [{ href: '#case-response' as const, label: 'Case & response' }]
      : []),
    { href: '#raw-data', label: 'Raw data' },
  ];
}

export type { LookupMode, LookupRequestSelection };
