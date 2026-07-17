import type { RegistryCompatibilityRow } from '../lib/registry-capabilities.mts';

const REGISTRY_SUPPORT_SCHEMA_VERSION = 1;
const MAX_REGISTRY_SUPPORT_TEXT_LENGTH = 2048;
const MAX_REGISTRY_SUPPORT_REFERENCES = 20;
const MAX_REGISTRY_SUPPORT_REFERENCE_LENGTH = 2048;

type RegistrySupportDocument = {
  schema: 'whoisleuth.cli.registry-support';
  version: number;
  generatedAt: string;
  requestedInput: string;
  suffix: string;
  catalogueVersion: number;
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

function buildRegistrySupportDocument(
  requestedInput: string,
  capability: RegistryCompatibilityRow,
  catalogueVersion: number,
  generatedAt = new Date().toISOString(),
): RegistrySupportDocument {
  const suffix = boundedText(capability.suffixes?.[0], '', 63).toLowerCase();
  if (!suffix || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(suffix)) {
    throw new TypeError('Registry capability did not provide a valid suffix.');
  }
  return {
    schema: 'whoisleuth.cli.registry-support',
    version: REGISTRY_SUPPORT_SCHEMA_VERSION,
    generatedAt: boundedText(generatedAt, '', 64),
    requestedInput: boundedText(requestedInput, '', 253),
    suffix,
    catalogueVersion: Number.isSafeInteger(catalogueVersion) && catalogueVersion > 0 ? catalogueVersion : 0,
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
  REGISTRY_SUPPORT_SCHEMA_VERSION,
  buildRegistrySupportDocument,
};
export type { RegistrySupportDocument };
