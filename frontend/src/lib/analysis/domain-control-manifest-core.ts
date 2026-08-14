import {
  canonicalArtifactJsonFor,
  resolveArtifactCanonicalization,
  SORTED_JSON_V1,
  SORTED_JSON_V2,
  type ArtifactCanonicalization,
} from './artifact-integrity.ts';
import { normalizeDomain } from './case-record-core.ts';
import { canonicalDomainControlRecordList } from './domain-control-records.ts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../../../../lib/observation.mts';

export const DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA = 'whoisleuth.domain-control-manifest-input';
export const DOMAIN_CONTROL_PASSPORT_SCHEMA = 'whoisleuth.domain-control-manifest';
export const DOMAIN_CONTROL_PASSPORT_VERSION = 1;
export const DOMAIN_CONTROL_MANIFEST_VERSION = 2;
export const MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES = 100;
export const DOMAIN_CONTROL_PASSPORT_LIMITATIONS = Object.freeze([
  'This analyst-authored manifest records intended domain-control state. It does not collect evidence or change registrar, DNS, mail, or certificate configuration.',
  'Empty desired fields are unconfigured rather than claims that a record should be absent.',
]);

const INPUT_KEYS = new Set(['schema', 'version', 'expiresAt', 'entries']);
const MANIFEST_KEYS = new Set(['schema', 'version', 'generatedAt', 'expiresAt', 'entries', 'limitations', 'integrity']);
const ENTRY_KEYS = new Set(['domain', 'nameservers', 'ds', 'mx', 'caa', 'tlsIssuer', 'tlsSpkiSha256', 'registrarLock', 'renewalReviewAt', 'note']);
const INTEGRITY_KEYS = new Set(['algorithm', 'canonicalization', 'digestSha256']);
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

export type DomainControlPassportEntry = Readonly<{
  domain: string;
  nameservers: readonly string[];
  ds: readonly string[];
  mx: readonly string[];
  caa: readonly string[];
  tlsIssuer: string | null;
  tlsSpkiSha256: string | null;
  registrarLock: 'required' | 'not_required' | null;
  renewalReviewAt: string | null;
  note: string | null;
}>;

export type UnsignedDomainControlPassport = Readonly<{
  schema: typeof DOMAIN_CONTROL_PASSPORT_SCHEMA;
  version: typeof DOMAIN_CONTROL_PASSPORT_VERSION | typeof DOMAIN_CONTROL_MANIFEST_VERSION;
  generatedAt: string;
  expiresAt: string;
  entries: readonly DomainControlPassportEntry[];
  limitations: readonly string[];
}>;

export type DomainControlPassport = UnsignedDomainControlPassport & Readonly<{
  integrity: Readonly<{
    algorithm: 'SHA-256';
    canonicalization: typeof SORTED_JSON_V1 | typeof SORTED_JSON_V2;
    digestSha256: string;
  }>;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${label} contains unknown field: ${unknown}.`);
}

function text(value: unknown, maximum = 300): string | null {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) return null;
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum) || null;
}

function timestamp(value: unknown, legacy = false): string | null {
  const candidate = text(value, 64);
  return candidate
    ? normalizeExplicitIsoTimestamp(candidate) ?? (legacy ? normalizeLegacyIsoTimestamp(candidate) : null)
    : null;
}

function hostnames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 128).flatMap((item) => {
    const normalized = normalizeDomain(item);
    return normalized ? [normalized] : [];
  }))].sort().slice(0, 32);
}

function digest(value: unknown): string | null {
  const candidate = text(value, 64)?.toLowerCase() ?? '';
  return /^[a-f0-9]{64}$/u.test(candidate) ? candidate : null;
}

function normalizeEntry(value: unknown): DomainControlPassportEntry | null {
  const source = record(value);
  if (!source) return null;
  exactKeys(source, ENTRY_KEYS, 'Domain control manifest entry');
  const domain = normalizeDomain(source.domain);
  if (!domain) return null;
  return Object.freeze({
    domain,
    nameservers: Object.freeze(hostnames(source.nameservers)),
    ds: Object.freeze(canonicalDomainControlRecordList(source.ds, 'ds')),
    mx: Object.freeze(canonicalDomainControlRecordList(source.mx, 'mx')),
    caa: Object.freeze(canonicalDomainControlRecordList(source.caa, 'caa')),
    tlsIssuer: text(source.tlsIssuer, 300)?.toLowerCase() ?? null,
    tlsSpkiSha256: digest(source.tlsSpkiSha256),
    registrarLock: source.registrarLock === 'required' || source.registrarLock === 'not_required'
      ? source.registrarLock
      : null,
    renewalReviewAt: timestamp(source.renewalReviewAt, true),
    note: text(source.note, 500),
  });
}

export function buildUnsignedDomainControlPassport(
  input: unknown,
  generatedAtValue: unknown,
  options: Readonly<{ legacyGeneratedAt?: boolean }> = {},
): UnsignedDomainControlPassport {
  const source = record(input);
  if (!source || source.schema !== DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA || source.version !== DOMAIN_CONTROL_PASSPORT_VERSION) {
    throw new TypeError(`Domain control manifest input must use ${DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA} version ${DOMAIN_CONTROL_PASSPORT_VERSION}.`);
  }
  exactKeys(source, INPUT_KEYS, 'Domain control manifest input');
  const generatedAt = timestamp(generatedAtValue, options.legacyGeneratedAt === true);
  const expiresAt = timestamp(source.expiresAt, true);
  if (!generatedAt) {
    throw new TypeError('Domain control manifest generation time must be valid and include an explicit timezone.');
  }
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(generatedAt)) {
    throw new TypeError('Domain control manifest expiry must be a valid time after generation.');
  }
  if (!Array.isArray(source.entries) || source.entries.length < 1 || source.entries.length > MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES) {
    throw new TypeError(`Domain control manifest input must contain between 1 and ${MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES} entries.`);
  }
  const entries = source.entries.map(normalizeEntry);
  if (entries.some((entry) => entry === null)) throw new TypeError('Domain control manifest contains an invalid entry.');
  const normalizedEntries = entries as DomainControlPassportEntry[];
  if (new Set(normalizedEntries.map((entry) => entry.domain)).size !== normalizedEntries.length) {
    throw new TypeError('Domain control manifest entries must use unique domains.');
  }
  return Object.freeze({
    schema: DOMAIN_CONTROL_PASSPORT_SCHEMA,
    version: DOMAIN_CONTROL_MANIFEST_VERSION,
    generatedAt,
    expiresAt,
    entries: Object.freeze([...normalizedEntries].sort((left, right) => left.domain.localeCompare(right.domain))),
    limitations: DOMAIN_CONTROL_PASSPORT_LIMITATIONS,
  });
}

export function normalizeDomainControlPassportDocument(value: unknown): Readonly<{
  manifest: DomainControlPassport;
  unsigned: UnsignedDomainControlPassport;
  canonicalUnsigned: string;
  canonicalization: ArtifactCanonicalization;
}> {
  const source = record(value);
  const integrity = record(source?.integrity);
  if (!source
    || source.schema !== DOMAIN_CONTROL_PASSPORT_SCHEMA
    || !integrity
    || integrity.algorithm !== 'SHA-256'
    || typeof integrity.digestSha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(integrity.digestSha256)) {
    throw new TypeError('Domain control manifest has an unsupported or malformed structure.');
  }
  exactKeys(source, MANIFEST_KEYS, 'Domain control manifest');
  exactKeys(integrity, INTEGRITY_KEYS, 'Domain control manifest integrity');
  const canonicalization = resolveArtifactCanonicalization(
    source.version,
    integrity.canonicalization,
    [
      { version: DOMAIN_CONTROL_PASSPORT_VERSION, canonicalization: SORTED_JSON_V1, explicit: true },
      { version: DOMAIN_CONTROL_MANIFEST_VERSION, canonicalization: SORTED_JSON_V2, explicit: true },
    ],
    'Domain control manifest',
  );
  if (!Array.isArray(source.limitations)
    || source.limitations.length !== DOMAIN_CONTROL_PASSPORT_LIMITATIONS.length
    || source.limitations.some((item, index) => item !== DOMAIN_CONTROL_PASSPORT_LIMITATIONS[index])) {
    throw new TypeError('Domain control manifest has an unsupported or malformed structure.');
  }
  const baseUnsigned = buildUnsignedDomainControlPassport({
    schema: DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA,
    version: DOMAIN_CONTROL_PASSPORT_VERSION,
    expiresAt: source.expiresAt,
    entries: source.entries,
  }, source.generatedAt, { legacyGeneratedAt: source.version === DOMAIN_CONTROL_PASSPORT_VERSION });
  const unsigned = Object.freeze({ ...baseUnsigned, version: source.version }) as UnsignedDomainControlPassport;
  const { integrity: _integrity, ...suppliedUnsigned } = source;
  const canonicalUnsigned = canonicalArtifactJsonFor(unsigned, canonicalization);
  if (canonicalArtifactJsonFor(suppliedUnsigned, canonicalization) !== canonicalUnsigned) {
    throw new TypeError('Domain control manifest must use its canonical normalised content.');
  }
  return {
    manifest: source as unknown as DomainControlPassport,
    unsigned,
    canonicalUnsigned,
    canonicalization,
  };
}
