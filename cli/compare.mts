import { CliUsageError } from './arguments.mts';
import {
  isRdapRegistryAccessProfile,
  isWhoisRegistryAccessProfile,
} from './registry-access.mts';
import {
  MAX_SAVED_LOOKUP_INPUT_BYTES,
  MAX_SAVED_LOOKUP_STRING_LENGTH,
  SAVED_LOOKUP_SCHEMA,
  SAVED_LOOKUP_SCHEMA_VERSION,
  parseSavedLookupDocument,
  readSavedLookupInputBounded,
} from './saved-lookup.mts';
import type { BoundedTextStream } from './bulk.mts';
import type { SavedLookupDocument, UnknownRecord } from './saved-lookup.mts';

const MAX_COMPARE_INPUT_BYTES = MAX_SAVED_LOOKUP_INPUT_BYTES;
// Covers the largest scalar accepted by the normalized WHOIS parser while
// preventing a saved document from inflating the derived comparison output.
const MAX_COMPARE_STRING_LENGTH = MAX_SAVED_LOOKUP_STRING_LENGTH;
const MAX_COMPARE_LIST_ITEMS = 200;
const MAX_COMPARE_EVENTS = 100;
const MAX_COMPARE_REGISTRY_ACCESS_LIMITATION_LENGTH = MAX_COMPARE_STRING_LENGTH;
const MAX_COMPARE_REGISTRY_ACCESS_SUFFIX_LENGTH = 63;
const REGISTRAR_RDAP_STATUSES = new Set([
  'success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled',
]);
const LOOKUP_SCHEMA = SAVED_LOOKUP_SCHEMA;
const LOOKUP_SCHEMA_VERSION = SAVED_LOOKUP_SCHEMA_VERSION;

type SourceLifecycle = {
  createdDate: string | null;
  createdDateIso: string | null;
  expiryDate: string | null;
  expiryDateIso: string | null;
  updatedDate: string | null;
  updatedDateIso: string | null;
};

type ProjectedSource = UnknownRecord;

type RegistryAccessContext = {
  suffix: string;
  coverageState: 'access_documented';
  whoisAccessProfile: string;
  rdapAccessProfile: string;
  limitation: string;
  authority: 'context_only';
};

type CliLookupComparisonInput = {
  query: string;
  registrableDomain: string;
  lookupGeneratedAt: string;
  lookupMode: 'fast' | 'deep';
  rdapStatus: string;
  whoisStatus: string;
  rdapParsed: ProjectedSource;
  whoisParsed: ProjectedSource;
  registrarRdapRepresented: boolean;
  registrarRdapStatus: string | null;
  registrarRdapParsed: ProjectedSource;
  registryAccess: RegistryAccessContext | null;
};

type RegistryComparison = (
  rdap: ProjectedSource,
  whois: ProjectedSource,
  status: { rdapStatus: string; whoisStatus: string },
) => UnknownRecord;

type RdapPublicationComparison = (
  registry: ProjectedSource,
  registrar: ProjectedSource,
  status: { registryStatus: string; registrarStatus: string | null },
) => UnknownRecord;

async function readCompareInputBounded(
  stream: BoundedTextStream | null | undefined,
  limit = MAX_COMPARE_INPUT_BYTES,
): Promise<string> {
  return readSavedLookupInputBounded(stream, { limit, label: 'Comparison input' });
}

function objectOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function boundedSourceString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new CliUsageError(`${field} must be text when present.`);
  if (value.length > MAX_COMPARE_STRING_LENGTH) {
    throw new CliUsageError(`${field} exceeds the comparison value limit.`);
  }
  return value;
}

function boundedSourceList(value: unknown, field: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new CliUsageError(`${field} must be an array when present.`);
  if (value.length > MAX_COMPARE_LIST_ITEMS) {
    throw new CliUsageError(`${field} exceeds the comparison item limit.`);
  }
  return value
    .map((item, index) => boundedSourceString(item, `${field}[${index}]`))
    .filter((item): item is string => item !== null);
}

function projectRegistryAccessContext(diagnostics: UnknownRecord): RegistryAccessContext | null {
  const value = diagnostics.registryAccess;
  if (value === null || value === undefined) return null;
  if (![5, 6, 7].includes(Number(diagnostics.version))) return null;
  const context = objectOrNull(value);
  if (!context) throw new CliUsageError('diagnostics.registryAccess must be an object when present.');
  if (context.authority !== 'context_only') {
    throw new CliUsageError('diagnostics.registryAccess.authority is unsupported.');
  }
  if (context.coverageState !== 'access_documented') {
    throw new CliUsageError('diagnostics.registryAccess.coverageState is unsupported.');
  }
  if (typeof context.suffix !== 'string'
    || context.suffix.length > MAX_COMPARE_REGISTRY_ACCESS_SUFFIX_LENGTH
    || !/^(?=.*[a-z])[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(context.suffix)) {
    throw new CliUsageError('diagnostics.registryAccess.suffix is invalid.');
  }
  if (!isWhoisRegistryAccessProfile(context.whoisAccessProfile)) {
    throw new CliUsageError('diagnostics.registryAccess.whoisAccessProfile is unsupported.');
  }
  if (!isRdapRegistryAccessProfile(context.rdapAccessProfile)) {
    throw new CliUsageError('diagnostics.registryAccess.rdapAccessProfile is unsupported.');
  }
  if (typeof context.limitation !== 'string' || !context.limitation.trim()
    || context.limitation.length > MAX_COMPARE_REGISTRY_ACCESS_LIMITATION_LENGTH) {
    throw new CliUsageError('diagnostics.registryAccess.limitation is invalid.');
  }
  return {
    suffix: context.suffix,
    coverageState: context.coverageState,
    whoisAccessProfile: context.whoisAccessProfile,
    rdapAccessProfile: context.rdapAccessProfile,
    limitation: context.limitation,
    authority: context.authority,
  };
}

function projectLifecycle(value: unknown, prefix: string): SourceLifecycle {
  if (value !== null && value !== undefined && !objectOrNull(value)) {
    throw new CliUsageError(`${prefix} must be an object when present.`);
  }
  const lifecycle = objectOrNull(value) || {};
  return {
    createdDate: boundedSourceString(lifecycle.createdDate, `${prefix}.createdDate`),
    createdDateIso: boundedSourceString(lifecycle.createdDateIso, `${prefix}.createdDateIso`),
    expiryDate: boundedSourceString(lifecycle.expiryDate, `${prefix}.expiryDate`),
    expiryDateIso: boundedSourceString(lifecycle.expiryDateIso, `${prefix}.expiryDateIso`),
    updatedDate: boundedSourceString(lifecycle.updatedDate, `${prefix}.updatedDate`),
    updatedDateIso: boundedSourceString(lifecycle.updatedDateIso, `${prefix}.updatedDateIso`),
  };
}

function projectRdapSource(value: unknown, prefix = 'rdap.parsed'): ProjectedSource {
  const source = objectOrNull(value) || {};
  const registrar = objectOrNull(source.registrar);
  const events = source.events === null || source.events === undefined ? [] : source.events;
  if (!Array.isArray(events)) throw new CliUsageError(`${prefix}.events must be an array when present.`);
  if (events.length > MAX_COMPARE_EVENTS) {
    throw new CliUsageError(`${prefix}.events exceeds the comparison item limit.`);
  }
  return {
    domain: boundedSourceString(source.domain, `${prefix}.domain`),
    handle: boundedSourceString(source.handle, `${prefix}.handle`),
    registrar: registrar ? {
      name: boundedSourceString(registrar.name, `${prefix}.registrar.name`),
      org: boundedSourceString(registrar.org, `${prefix}.registrar.org`),
      handle: boundedSourceString(registrar.handle, `${prefix}.registrar.handle`),
    } : boundedSourceString(source.registrar, `${prefix}.registrar`),
    registrarIanaId: boundedSourceString(source.registrarIanaId, `${prefix}.registrarIanaId`),
    lifecycle: projectLifecycle(source.lifecycle, `${prefix}.lifecycle`),
    events: events.map((event, index) => {
      const item = objectOrNull(event);
      if (!item) throw new CliUsageError(`${prefix}.events[${index}] must be an object.`);
      return {
        action: boundedSourceString(item.action, `${prefix}.events[${index}].action`),
        date: boundedSourceString(item.date, `${prefix}.events[${index}].date`),
      };
    }),
    dnssec: boundedSourceString(source.dnssec, `${prefix}.dnssec`),
    statuses: boundedSourceList(source.statuses, `${prefix}.statuses`),
    nameservers: boundedSourceList(source.nameservers, `${prefix}.nameservers`),
  };
}

function projectCliRegistrarPublicationInput(document: SavedLookupDocument): {
  represented: boolean;
  status: string | null;
  parsed: ProjectedSource;
} {
  const rdap = objectOrNull(document.rdap);
  const registrar = objectOrNull(rdap?.registrarRdap);
  const rdapDiagnostics = objectOrNull(document.diagnostics?.rdap);
  const registrarDiagnostics = objectOrNull(rdapDiagnostics?.registrar);
  if (!registrar && !registrarDiagnostics) {
    return { represented: false, status: null, parsed: {} };
  }
  const sourceStatus = registrar?.status;
  const diagnosticStatus = registrarDiagnostics?.status;
  if (sourceStatus !== undefined && diagnosticStatus !== undefined && sourceStatus !== diagnosticStatus) {
    throw new CliUsageError('Registrar RDAP source and diagnostic statuses do not match.');
  }
  const status = sourceStatus ?? diagnosticStatus;
  if (typeof status !== 'string' || !REGISTRAR_RDAP_STATUSES.has(status)) {
    throw new CliUsageError('rdap.registrarRdap.status is unsupported.');
  }
  if (registrar?.parsed !== null && registrar?.parsed !== undefined && !objectOrNull(registrar.parsed)) {
    throw new CliUsageError('rdap.registrarRdap.parsed must be an object when present.');
  }
  const parsed = objectOrNull(registrar?.parsed);
  if (status === 'success' && !parsed) {
    throw new CliUsageError('Successful registrar RDAP input is missing normalized parsed data.');
  }
  const projected = projectRdapSource(parsed, 'rdap.registrarRdap.parsed');
  delete projected.handle;
  const projectedRegistrar = objectOrNull(projected.registrar);
  if (projectedRegistrar) delete projectedRegistrar.handle;
  return {
    represented: true,
    status,
    parsed: projected,
  };
}

function projectWhoisSource(value: unknown): ProjectedSource {
  const source = objectOrNull(value) || {};
  return {
    domainName: boundedSourceString(source.domainName, 'whois.parsed.domainName'),
    registryDomainId: boundedSourceString(source.registryDomainId, 'whois.parsed.registryDomainId'),
    registrar: boundedSourceString(source.registrar, 'whois.parsed.registrar'),
    registrarIanaId: boundedSourceString(source.registrarIanaId, 'whois.parsed.registrarIanaId'),
    createdDate: boundedSourceString(source.createdDate, 'whois.parsed.createdDate'),
    createdDateIso: boundedSourceString(source.createdDateIso, 'whois.parsed.createdDateIso'),
    expiryDate: boundedSourceString(source.expiryDate, 'whois.parsed.expiryDate'),
    expiryDateIso: boundedSourceString(source.expiryDateIso, 'whois.parsed.expiryDateIso'),
    updatedDate: boundedSourceString(source.updatedDate, 'whois.parsed.updatedDate'),
    updatedDateIso: boundedSourceString(source.updatedDateIso, 'whois.parsed.updatedDateIso'),
    lifecycle: projectLifecycle(source.lifecycle, 'whois.parsed.lifecycle'),
    dnssec: boundedSourceString(source.dnssec, 'whois.parsed.dnssec'),
    statuses: boundedSourceList(source.statuses, 'whois.parsed.statuses'),
    nameservers: boundedSourceList(source.nameservers, 'whois.parsed.nameservers'),
  };
}

function parseCliLookupDocument(text: unknown): CliLookupComparisonInput {
  const document = parseSavedLookupDocument(text, { label: 'Comparison input' });
  return projectCliLookupComparisonInput(document);
}

function projectCliLookupComparisonInput(document: SavedLookupDocument): CliLookupComparisonInput {
  const diagnostics = document.diagnostics;
  const rdapStatus = document.diagnostics.rdap.status;
  const whoisStatus = document.diagnostics.whois.status;
  const rdapParsed = objectOrNull(document.rdap?.parsed);
  const whoisParsed = objectOrNull(document.whois?.parsed);
  const registrarPublication = projectCliRegistrarPublicationInput(document);
  return {
    query: document.query,
    registrableDomain: document.registrableDomain,
    lookupGeneratedAt: document.generatedAt,
    lookupMode: document.mode,
    rdapStatus,
    whoisStatus,
    rdapParsed: projectRdapSource(rdapParsed),
    whoisParsed: projectWhoisSource(whoisParsed),
    registrarRdapRepresented: registrarPublication.represented,
    registrarRdapStatus: registrarPublication.status,
    registrarRdapParsed: registrarPublication.parsed,
    registryAccess: projectRegistryAccessContext(diagnostics),
  };
}

function compareLookupDocument(
  input: CliLookupComparisonInput,
  compareRegistrySources: RegistryComparison,
  compareRdapPublications?: RdapPublicationComparison,
): UnknownRecord {
  if (typeof compareRegistrySources !== 'function') {
    throw new TypeError('Registry comparison dependency is required.');
  }
  const comparison = compareRegistrySources(input.rdapParsed, input.whoisParsed, {
    rdapStatus: input.rdapStatus,
    whoisStatus: input.whoisStatus,
  });
  if (input.registrarRdapRepresented && typeof compareRdapPublications !== 'function') {
    throw new TypeError('Registrar RDAP comparison dependency is required.');
  }
  const registrarPublicationComparison = input.registrarRdapRepresented
    ? compareRdapPublications!(input.rdapParsed, input.registrarRdapParsed, {
      registryStatus: input.rdapStatus,
      registrarStatus: input.registrarRdapStatus,
    })
    : null;
  return {
    query: input.query,
    registrableDomain: input.registrableDomain,
    lookupGeneratedAt: input.lookupGeneratedAt,
    lookupMode: input.lookupMode,
    ...comparison,
    registrarPublicationComparison,
    ...(input.registryAccess ? { registryAccess: input.registryAccess } : {}),
  };
}

export {
  LOOKUP_SCHEMA,
  LOOKUP_SCHEMA_VERSION,
  MAX_COMPARE_EVENTS,
  MAX_COMPARE_INPUT_BYTES,
  MAX_COMPARE_LIST_ITEMS,
  MAX_COMPARE_REGISTRY_ACCESS_LIMITATION_LENGTH,
  MAX_COMPARE_REGISTRY_ACCESS_SUFFIX_LENGTH,
  MAX_COMPARE_STRING_LENGTH,
  compareLookupDocument,
  parseCliLookupDocument,
  projectCliLookupComparisonInput,
  readCompareInputBounded,
};
export type {
  CliLookupComparisonInput,
  ProjectedSource,
  RdapPublicationComparison,
  RegistryComparison,
  RegistryAccessContext,
  SourceLifecycle,
};
