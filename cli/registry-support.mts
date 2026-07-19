import {
  registryStandardsCoverageSnapshot,
  type RegistryCompatibilityRow,
  type RegistryStandardsCoverageSnapshot,
} from '../lib/registry-capabilities.mts';

const REGISTRY_SUPPORT_SCHEMA = 'whoisleuth.cli.registry-support';
const REGISTRY_SUPPORT_SCHEMA_VERSION = 2;
const REGISTRY_STANDARDS_COVERAGE_SCHEMA = 'whoisleuth.registry-standards-coverage';
const MAX_REGISTRY_SUPPORT_TEXT_LENGTH = 2048;
const MAX_REGISTRY_SUPPORT_REFERENCES = 20;
const MAX_REGISTRY_SUPPORT_REFERENCE_LENGTH = 2048;

type RegistrySupportDocument = {
  schema: typeof REGISTRY_SUPPORT_SCHEMA;
  version: number;
  generatedAt: string;
  requestedInput: string;
  suffix: string;
  catalogueVersion: number;
  standardsCoverage: {
    schema: typeof REGISTRY_STANDARDS_COVERAGE_SCHEMA;
    version: number;
    verifiedAt: string;
    rootZoneVersion: string;
    rdapBootstrapPublication: string;
    genericAndRestricted: { total: number; rdapCovered: number };
    sponsored: { total: number; rdapCovered: number };
    infrastructure: { total: number; rdapCovered: number };
    interpretation: string;
  };
  profile: {
    id: string;
    explicitSuffixProfile: boolean;
    registryClass: string;
    coverageState: string;
    rdap: { discovery: string; accessProfile: string };
    whois: {
      discovery: string;
      accessProfile: string;
      queryProfile: string;
      queryScope: string;
      encodingProfile: string;
      parserProfile: string;
    };
    fallbackProfile: string | null;
  };
  verification: {
    fixtureScenarios: string[];
    files: string[];
    documentationUrls: string[];
  };
  limitation: string;
  interpretation: {
    authority: 'context_only';
    liveReachability: 'not_tested';
    statement: string;
  };
};

function boundedText(value: unknown, fallback = 'unknown', maximum = MAX_REGISTRY_SUPPORT_TEXT_LENGTH): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
  return normalized || fallback;
}

function boundedList(values: unknown, kind: 'token' | 'file' | 'url'): string[] {
  if (!Array.isArray(values)) return [];
  const output: string[] = [];
  for (const value of values.slice(0, MAX_REGISTRY_SUPPORT_REFERENCES)) {
    const text = boundedText(value, '', MAX_REGISTRY_SUPPORT_REFERENCE_LENGTH);
    if (!text) continue;
    if (kind === 'token' && !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(text)) continue;
    if (kind === 'file' && (text.startsWith('/') || text.includes('..') || !/^[a-z0-9_./-]+$/i.test(text))) continue;
    if (kind === 'url') {
      try {
        const url = new URL(text);
        if (url.protocol !== 'https:' || url.username || url.password) continue;
      } catch {
        continue;
      }
    }
    if (!output.includes(text)) output.push(text);
  }
  return output;
}

function boundedCount(value: unknown, maximum = 100000): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), maximum)
    : 0;
}

function projectStandardsCoverage(snapshot: RegistryStandardsCoverageSnapshot): RegistrySupportDocument['standardsCoverage'] {
  const counts = snapshot?.counts || {} as RegistryStandardsCoverageSnapshot['counts'];
  return {
    schema: REGISTRY_STANDARDS_COVERAGE_SCHEMA,
    version: boundedCount(snapshot?.version, 1000),
    verifiedAt: boundedText(snapshot?.verifiedAt, 'unknown', 32),
    rootZoneVersion: boundedText(snapshot?.sources?.rootZoneVersion, 'unknown', 64),
    rdapBootstrapPublication: boundedText(snapshot?.sources?.rdapBootstrapPublication, 'unknown', 64),
    genericAndRestricted: {
      total: boundedCount(counts.generic) + boundedCount(counts.genericRestricted),
      rdapCovered: boundedCount(counts.genericAndRestrictedRdapCovered),
    },
    sponsored: {
      total: boundedCount(counts.sponsored),
      rdapCovered: boundedCount(counts.sponsoredRdapCovered),
    },
    infrastructure: {
      total: boundedCount(counts.infrastructure),
      rdapCovered: boundedCount(counts.infrastructureRdapCovered),
    },
    interpretation: boundedText(snapshot?.interpretation),
  };
}

function buildRegistrySupportDocument(
  requestedInput: string,
  capability: RegistryCompatibilityRow,
  catalogueVersion: number,
  generatedAt = new Date().toISOString(),
  standardsSnapshot = registryStandardsCoverageSnapshot(),
): RegistrySupportDocument {
  const suffix = boundedText(capability.suffixes?.[0], '', 63).toLowerCase();
  if (!suffix || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(suffix)) {
    throw new TypeError('Registry capability did not provide a valid suffix.');
  }
  return {
    schema: REGISTRY_SUPPORT_SCHEMA,
    version: REGISTRY_SUPPORT_SCHEMA_VERSION,
    generatedAt: boundedText(generatedAt, '', 64),
    requestedInput: boundedText(requestedInput, '', 253),
    suffix,
    catalogueVersion: Number.isSafeInteger(catalogueVersion) && catalogueVersion > 0 ? catalogueVersion : 0,
    standardsCoverage: projectStandardsCoverage(standardsSnapshot),
    profile: {
      id: boundedText(capability.id, 'unknown', 128),
      explicitSuffixProfile: capability.explicitSuffixProfile === true,
      registryClass: boundedText(capability.registryClass, 'unknown', 64),
      coverageState: boundedText(capability.coverageState, 'unknown', 64),
      rdap: {
        discovery: boundedText(capability.rdapDiscovery, 'unknown', 64),
        accessProfile: boundedText(capability.rdapAccessProfile, 'unknown', 128),
      },
      whois: {
        discovery: boundedText(capability.whoisDiscovery, 'unknown', 64),
        accessProfile: boundedText(capability.whoisAccessProfile, 'unknown', 128),
        queryProfile: boundedText(capability.whoisQueryProfile, 'unknown', 128),
        queryScope: boundedText(capability.whoisQueryScope, 'unknown', 64),
        encodingProfile: boundedText(capability.whoisEncodingProfile, 'unknown', 64),
        parserProfile: boundedText(capability.whoisParserProfile, 'unknown', 128),
      },
      fallbackProfile: capability.fallbackProfile
        ? boundedText(capability.fallbackProfile, 'unknown', 128)
        : null,
    },
    verification: {
      fixtureScenarios: boundedList(capability.fixtureScenarios, 'token'),
      files: boundedList(capability.verificationFiles, 'file'),
      documentationUrls: boundedList(capability.documentationUrls, 'url'),
    },
    limitation: boundedText(capability.limitation),
    interpretation: {
      authority: 'context_only',
      liveReachability: 'not_tested',
      statement: 'Catalogue coverage does not test current live reachability or decide registration, availability, ownership, safety, or maliciousness.',
    },
  };
}

export {
  MAX_REGISTRY_SUPPORT_REFERENCE_LENGTH,
  MAX_REGISTRY_SUPPORT_REFERENCES,
  MAX_REGISTRY_SUPPORT_TEXT_LENGTH,
  REGISTRY_STANDARDS_COVERAGE_SCHEMA,
  REGISTRY_SUPPORT_SCHEMA,
  REGISTRY_SUPPORT_SCHEMA_VERSION,
  buildRegistrySupportDocument,
  projectStandardsCoverage,
};
export type { RegistrySupportDocument };
