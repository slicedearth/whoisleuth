// Privacy-minimized identity claims derived from JSON-LD script elements in
// the already-captured deep-Lookup homepage response. The bounded projection
// retains only curated schema types, labels, origins, hostnames, source health,
// and fixed limitations. Raw JSON-LD and arbitrary publisher properties are
// discarded immediately after analysis.

import { domainToASCII } from 'node:url';

import { createObservation } from '../packages/evidence/observation.mts';
import {
  MAX_STRUCTURED_DATA_ENTITIES,
  MAX_STRUCTURED_DATA_SAME_AS_HOSTS,
  STRUCTURED_DATA_IDENTITY_VERSION,
} from './lookup-child-profile-contract.mts';
import { isUriShapedLabel } from './portable-generator.mts';
import {
  analyzeStaticHtml,
  type StaticHtmlAnalysis,
} from './static-html-analysis.mts';

type UnknownRecord = Record<string, unknown>;
type StructuredDataEntity = {
  types: string[];
  name: string | null;
  declaredOrigin: string | null;
  sameAsHosts: string[];
};
type BoundedProjection<T> = { value: T; truncated: boolean };
type StructuredDataIdentityInput = {
  html?: unknown;
  htmlAnalysis?: StaticHtmlAnalysis;
  baseUrl?: unknown;
  observedAt?: unknown;
  sourceTruncated?: unknown;
};

const MAX_STRUCTURED_DATA_SCRIPTS = 8;
const MAX_STRUCTURED_DATA_SCRIPT_CHARS = 16_384;
const MAX_STRUCTURED_DATA_TOTAL_CHARS = 32_768;
const MAX_STRUCTURED_DATA_DEPTH = 16;
const MAX_STRUCTURED_DATA_OBJECTS = 256;
const MAX_STRUCTURED_DATA_ARRAY_ITEMS = 256;
const MAX_STRUCTURED_DATA_PROPERTIES = 64;
const MAX_STRUCTURED_DATA_TYPES = 8;
const MAX_STRUCTURED_DATA_NAME_LENGTH = 160;
const MAX_STRUCTURED_DATA_URL_LENGTH = 2_048;
const CONTROL_AND_DIRECTIONAL_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;
const CONTROL_AND_DIRECTIONAL_GLOBAL_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;
const CURATED_TYPES = new Map<string, string>([
  ['brand', 'Brand'],
  ['corporation', 'Corporation'],
  ['educationalorganization', 'EducationalOrganization'],
  ['governmentorganization', 'GovernmentOrganization'],
  ['localbusiness', 'LocalBusiness'],
  ['newsmediaorganization', 'NewsMediaOrganization'],
  ['ngo', 'NGO'],
  ['onlinebusiness', 'OnlineBusiness'],
  ['organization', 'Organization'],
  ['performinggroup', 'PerformingGroup'],
  ['project', 'Project'],
  ['sportsorganization', 'SportsOrganization'],
  ['webpage', 'WebPage'],
  ['website', 'WebSite'],
] as const);

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function boundedName(value: unknown): BoundedProjection<string | null> {
  if (typeof value !== 'string') return { value: null, truncated: false };
  if (value.length > MAX_STRUCTURED_DATA_URL_LENGTH) return { value: null, truncated: true };
  if (isUriShapedLabel(value)) return { value: null, truncated: false };
  const normalized = value
    .replace(CONTROL_AND_DIRECTIONAL_GLOBAL_RE, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return { value: null, truncated: false };
  return normalized.length <= MAX_STRUCTURED_DATA_NAME_LENGTH
    ? { value: normalized, truncated: false }
    : { value: `${normalized.slice(0, MAX_STRUCTURED_DATA_NAME_LENGTH - 1)}…`, truncated: true };
}

function safeBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_STRUCTURED_DATA_URL_LENGTH) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizedOrigin(value: unknown, baseUrl: string | null): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRUCTURED_DATA_URL_LENGTH) return null;
  if (CONTROL_AND_DIRECTIONAL_RE.test(value)) return null;
  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizedSameAsHost(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_STRUCTURED_DATA_URL_LENGTH
    || CONTROL_AND_DIRECTIONAL_RE.test(value)
  ) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
    const ascii = domainToASCII(parsed.hostname.toLowerCase().replace(/\.$/u, ''));
    return ascii && HOSTNAME_RE.test(ascii) ? ascii : null;
  } catch {
    return null;
  }
}

function curatedType(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160) return null;
  const suffix = value.trim().split(/[\/#]/u).pop()?.replace(/[^a-z]/giu, '').toLowerCase() || '';
  return CURATED_TYPES.get(suffix) || null;
}

function curatedTypes(value: unknown): BoundedProjection<string[]> {
  const values = Array.isArray(value) ? value : [value];
  const types = new Set<string>();
  for (const candidate of values.slice(0, MAX_STRUCTURED_DATA_TYPES)) {
    const normalized = curatedType(candidate);
    if (normalized) types.add(normalized);
  }
  return { value: [...types].sort(), truncated: values.length > MAX_STRUCTURED_DATA_TYPES };
}

function sameAsHosts(value: unknown): BoundedProjection<string[]> {
  const values = Array.isArray(value) ? value : [value];
  const hosts = new Set<string>();
  for (const candidate of values.slice(0, MAX_STRUCTURED_DATA_SAME_AS_HOSTS)) {
    const host = normalizedSameAsHost(candidate);
    if (host) hosts.add(host);
  }
  return { value: [...hosts].sort(), truncated: values.length > MAX_STRUCTURED_DATA_SAME_AS_HOSTS };
}

function jsonStructureWithinBounds(value: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      depth += 1;
      if (depth > MAX_STRUCTURED_DATA_DEPTH) return false;
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return !inString && depth === 0;
}

function entityFromObject(value: UnknownRecord, baseUrl: string | null): {
  entity: StructuredDataEntity | null;
  nameTruncated: boolean;
  typesTruncated: boolean;
  sameAsTruncated: boolean;
} {
  const types = curatedTypes(value['@type']);
  const name = boundedName(value.name);
  const declaredOrigin = normalizedOrigin(value.url, baseUrl);
  const hosts = sameAsHosts(value.sameAs);
  const projection = {
    nameTruncated: name.truncated,
    typesTruncated: types.truncated,
    sameAsTruncated: hosts.truncated,
  };
  if (!types.value.length || (!name.value && !declaredOrigin && !hosts.value.length)) {
    return { entity: null, ...projection };
  }
  return {
    entity: { types: types.value, name: name.value, declaredOrigin, sameAsHosts: hosts.value },
    ...projection,
  };
}

function analyzeStructuredDataIdentity(input: StructuredDataIdentityInput = {}) {
  const htmlAnalysis = input.htmlAnalysis ?? analyzeStaticHtml(input.html);
  const baseUrl = safeBaseUrl(input.baseUrl);
  const scripts = htmlAnalysis.scripts.filter((script) => script.mediaType === 'application/ld+json');
  const selectedScripts = scripts.slice(0, MAX_STRUCTURED_DATA_SCRIPTS);
  const entities = new Map<string, StructuredDataEntity>();
  let charactersExamined = 0;
  let documentsParsed = 0;
  let malformedScripts = 0;
  let externalScriptsSkipped = 0;
  let objectsExamined = 0;
  let arrayItemsExamined = 0;
  let discardedProperties = 0;
  let truncatedNames = 0;
  let truncatedTypeLists = 0;
  let truncatedSameAsLists = 0;
  let entityLimitReached = false;
  let limitReached = scripts.length > MAX_STRUCTURED_DATA_SCRIPTS;

  for (const script of selectedScripts) {
    if (script.reference) {
      externalScriptsSkipped += 1;
      continue;
    }
    const remaining = MAX_STRUCTURED_DATA_TOTAL_CHARS - charactersExamined;
    if (
      script.inlineContent.length === 0
      || script.inlineContent.length > MAX_STRUCTURED_DATA_SCRIPT_CHARS
      || script.inlineContent.length > remaining
    ) {
      limitReached = true;
      continue;
    }
    charactersExamined += script.inlineContent.length;
    if (!jsonStructureWithinBounds(script.inlineContent)) {
      malformedScripts += 1;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(script.inlineContent);
      documentsParsed += 1;
    } catch {
      malformedScripts += 1;
      continue;
    }

    const pending: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
    while (pending.length) {
      const current = pending.pop();
      if (!current) break;
      if (current.depth > MAX_STRUCTURED_DATA_DEPTH) {
        limitReached = true;
        continue;
      }
      if (Array.isArray(current.value)) {
        if (arrayItemsExamined >= MAX_STRUCTURED_DATA_ARRAY_ITEMS) {
          limitReached = true;
          continue;
        }
        const remainingItems = MAX_STRUCTURED_DATA_ARRAY_ITEMS - arrayItemsExamined;
        const retained = current.value.slice(0, remainingItems);
        arrayItemsExamined += retained.length;
        if (retained.length < current.value.length) limitReached = true;
        for (const child of retained) pending.push({ value: child, depth: current.depth + 1 });
        continue;
      }
      const object = record(current.value);
      if (!object) continue;
      if (objectsExamined >= MAX_STRUCTURED_DATA_OBJECTS) {
        limitReached = true;
        continue;
      }
      objectsExamined += 1;
      const projection = entityFromObject(object, baseUrl);
      if (projection.nameTruncated) truncatedNames += 1;
      if (projection.typesTruncated) truncatedTypeLists += 1;
      if (projection.sameAsTruncated) truncatedSameAsLists += 1;
      if (projection.nameTruncated || projection.typesTruncated || projection.sameAsTruncated) limitReached = true;
      if (projection.entity) {
        const key = JSON.stringify(projection.entity);
        if (!entities.has(key)) {
          if (entities.size < MAX_STRUCTURED_DATA_ENTITIES) entities.set(key, projection.entity);
          else {
            entityLimitReached = true;
            limitReached = true;
          }
        }
      }

      const entries = Object.entries(object);
      const traversed = entries.slice(0, MAX_STRUCTURED_DATA_PROPERTIES);
      if (traversed.length < entries.length) {
        discardedProperties += entries.length - traversed.length;
        limitReached = true;
      }
      for (const [, child] of traversed) {
        if (child !== null && typeof child === 'object') {
          pending.push({ value: child, depth: current.depth + 1 });
        }
      }
    }
  }

  const truncated = input.sourceTruncated === true
    || htmlAnalysis.inputLimitReached
    || htmlAnalysis.scriptLimitReached
    || htmlAnalysis.inlineLimitReached
    || limitReached;
  const partial = truncated || malformedScripts > 0 || externalScriptsSkipped > 0;
  const limitations = [
    'Structured identity fields are publisher-declared metadata and do not prove identity, ownership, control, safety, or maliciousness.',
    'Only curated schema types, bounded labels, declared origins, and sameAs hostnames are retained; raw JSON-LD and arbitrary properties are discarded.',
    'Static response evidence cannot observe JSON-LD added later by JavaScript.',
  ];
  if (input.sourceTruncated === true || htmlAnalysis.inputLimitReached) {
    limitations.push('The captured homepage body was truncated, so structured identity evidence may be incomplete.');
  }
  if (htmlAnalysis.scriptLimitReached || scripts.length > MAX_STRUCTURED_DATA_SCRIPTS) {
    limitations.push(`Only the first ${MAX_STRUCTURED_DATA_SCRIPTS} JSON-LD script elements were eligible for analysis.`);
  }
  if (htmlAnalysis.inlineLimitReached || limitReached) {
    limitations.push(`JSON-LD analysis was bounded to ${MAX_STRUCTURED_DATA_SCRIPT_CHARS} characters per script and ${MAX_STRUCTURED_DATA_TOTAL_CHARS} characters in total.`);
  }
  if (malformedScripts > 0) limitations.push(`${malformedScripts} JSON-LD script${malformedScripts === 1 ? ' was' : 's were'} malformed or exceeded the nesting boundary.`);
  if (externalScriptsSkipped > 0) limitations.push('Referenced JSON-LD scripts were not fetched.');
  if (entityLimitReached) {
    limitations.push(`Only the first ${MAX_STRUCTURED_DATA_ENTITIES} structured identity entities were retained.`);
  }
  if (truncatedNames > 0) limitations.push(`${truncatedNames} structured identity label${truncatedNames === 1 ? ' was' : 's were'} shortened to the ${MAX_STRUCTURED_DATA_NAME_LENGTH}-character retention limit.`);
  if (truncatedTypeLists > 0) limitations.push(`${truncatedTypeLists} structured identity type list${truncatedTypeLists === 1 ? ' exceeded' : 's exceeded'} the ${MAX_STRUCTURED_DATA_TYPES}-item inspection limit.`);
  if (truncatedSameAsLists > 0) limitations.push(`${truncatedSameAsLists} structured identity sameAs list${truncatedSameAsLists === 1 ? ' exceeded' : 's exceeded'} the ${MAX_STRUCTURED_DATA_SAME_AS_HOSTS}-item inspection limit.`);

  return {
    structuredDataVersion: STRUCTURED_DATA_IDENTITY_VERSION,
    ...createObservation({
      status: partial ? 'partial' : 'success',
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'html',
      complete: !partial,
      truncated,
      limitations,
      diagnostics: {
        scriptsObserved: scripts.length,
        scriptsExamined: selectedScripts.length,
        charactersExamined,
        documentsParsed,
        malformedScripts,
        externalScriptsSkipped,
        objectsExamined,
        arrayItemsExamined,
        discardedProperties,
        truncatedNames,
        truncatedTypeLists,
        truncatedSameAsLists,
        entities: entities.size,
      },
    }),
    entities: [...entities.values()],
  };
}

export {
  MAX_STRUCTURED_DATA_ARRAY_ITEMS,
  MAX_STRUCTURED_DATA_DEPTH,
  MAX_STRUCTURED_DATA_ENTITIES,
  MAX_STRUCTURED_DATA_OBJECTS,
  MAX_STRUCTURED_DATA_SAME_AS_HOSTS,
  MAX_STRUCTURED_DATA_SCRIPT_CHARS,
  MAX_STRUCTURED_DATA_SCRIPTS,
  MAX_STRUCTURED_DATA_TOTAL_CHARS,
  STRUCTURED_DATA_IDENTITY_VERSION,
  analyzeStructuredDataIdentity,
};

export type {
  StructuredDataEntity,
  StructuredDataIdentityInput,
};
