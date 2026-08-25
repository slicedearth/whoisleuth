import {
  LOOKUP_CLAIM_READINESS_VERSION,
  LOOKUP_CLAIM_IDS,
  LOOKUP_CLAIM_REQUIREMENT_IDS,
  type LookupClaimId,
  type LookupClaimReadiness,
  type LookupClaimReadinessState,
  type LookupClaimRequirementId,
  type LookupClaimRequirementMode,
} from './lookup-claim-readiness.mts';
import {
  SORTED_JSON_V2,
  sha256ArtifactDigestV2,
} from '../evidence/artifact-integrity.mts';
import type { EvidenceCoverageState } from './evidence-coverage-ledger.mts';
import {
  LOOKUP_CLAIM_PASSPORT_SCHEMA,
  LOOKUP_CLAIM_PASSPORT_TARGET_TYPES,
  LOOKUP_CLAIM_PASSPORT_VERSION,
  MAX_LOOKUP_CLAIM_PASSPORT_BYTES,
  MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS,
  MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS,
} from '../contracts/investigation-portability.mts';

export {
  LOOKUP_CLAIM_PASSPORT_SCHEMA,
  LOOKUP_CLAIM_PASSPORT_TARGET_TYPES,
  LOOKUP_CLAIM_PASSPORT_VERSION,
  MAX_LOOKUP_CLAIM_PASSPORT_BYTES,
  MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS,
  MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS,
};
export type LookupClaimPassportTargetType = typeof LOOKUP_CLAIM_PASSPORT_TARGET_TYPES[number];

const SOURCE_STATES = new Set<EvidenceCoverageState>([
  'complete',
  'not_found',
  'partial',
  'skipped',
  'unavailable',
  'unknown',
  'unsupported',
]);
const CLAIM_STATES = new Set<LookupClaimReadinessState>(['ready', 'limited', 'not_ready']);
const REQUIREMENT_IDS = new Set<string>(LOOKUP_CLAIM_REQUIREMENT_IDS);
const CLAIM_IDS = new Set<string>(LOOKUP_CLAIM_IDS);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const HAS_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SEMVER_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export type LookupClaimPassportRequirement = Readonly<{
  id: LookupClaimRequirementId;
  label: string;
  evidenceId: string | null;
  mode: LookupClaimRequirementMode;
  state: EvidenceCoverageState;
  observedAt: string | null;
  limitations: readonly string[];
}>;

export type LookupClaimPassport = Readonly<{
  schema: typeof LOOKUP_CLAIM_PASSPORT_SCHEMA;
  version: typeof LOOKUP_CLAIM_PASSPORT_VERSION;
  generatedAt: string;
  application: Readonly<{ name: 'WHOISleuth'; version: string }>;
  target: Readonly<{ type: LookupClaimPassportTargetType; value: string }>;
  observation: Readonly<{ observedAt: string | null; lookupDepth: 'fast' | 'deep' }>;
  claim: Readonly<{
    id: LookupClaimId;
    label: string;
    state: LookupClaimReadinessState;
    conclusion: string;
    requiredEvidenceIds: readonly LookupClaimRequirementId[];
    missingEvidenceIds: readonly LookupClaimRequirementId[];
    requirements: readonly LookupClaimPassportRequirement[];
    limitations: readonly string[];
  }>;
  models: Readonly<{
    claimReadiness: typeof LOOKUP_CLAIM_READINESS_VERSION;
    risk: number | null;
  }>;
  limitations: readonly string[];
  integrity: Readonly<{
    algorithm: 'SHA-256';
    canonicalization: typeof SORTED_JSON_V2;
    digestSha256: string;
  }>;
}>;

function text(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function exactText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || HAS_CONTROL_CHARACTERS.test(value)) return '';
  return value.trim();
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function uniqueText(values: readonly unknown[], maximum = MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values.slice(0, maximum * 2)) {
    const normalized = text(value, 400);
    if (!normalized || seen.has(normalized)) continue;
    output.push(normalized);
    seen.add(normalized);
    if (output.length >= maximum) break;
  }
  return output;
}

function targetType(value: unknown): LookupClaimPassportTargetType {
  if (typeof value !== 'string' || !LOOKUP_CLAIM_PASSPORT_TARGET_TYPES.includes(value as LookupClaimPassportTargetType)) {
    throw new TypeError('A supported Lookup target type is required for a claim passport.');
  }
  return value as LookupClaimPassportTargetType;
}

function domainTarget(value: unknown): string {
  const raw = exactText(value, 253).toLowerCase().replace(/\.$/u, '');
  if (!raw || /[/\\?#@]/u.test(raw)) throw new TypeError('A canonical domain is required for a claim passport.');
  let normalized = '';
  try { normalized = new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.$/u, ''); } catch { /* fail below */ }
  if (!DOMAIN_RE.test(normalized)) throw new TypeError('A canonical domain is required for a claim passport.');
  return normalized;
}

function ipv4Target(value: unknown): string {
  const raw = exactText(value, 64);
  const parts = raw.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255 || String(Number(part)) !== part)) {
    throw new TypeError('A canonical IPv4 address is required for a claim passport.');
  }
  return raw;
}

function ipv6Target(value: unknown): string {
  const raw = exactText(value, 64).toLowerCase();
  if (!raw || /[\[\]%/?#@]/u.test(raw)) throw new TypeError('A canonical IPv6 address is required for a claim passport.');
  try {
    const hostname = new URL(`http://[${raw}]/`).hostname;
    const normalized = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    if (!normalized.includes(':')) throw new TypeError();
    return normalized;
  } catch {
    throw new TypeError('A canonical IPv6 address is required for a claim passport.');
  }
}

function asnTarget(value: unknown): string {
  const raw = exactText(value, 32).toUpperCase().replace(/^AS/u, '');
  if (!/^\d{1,10}$/u.test(raw) || Number(raw) < 1 || Number(raw) > 4_294_967_295) {
    throw new TypeError('A canonical ASN is required for a claim passport.');
  }
  return `AS${Number(raw)}`;
}

function targetValue(type: LookupClaimPassportTargetType, value: unknown): string {
  if (type === 'domain') return domainTarget(value);
  if (type === 'ipv4') return ipv4Target(value);
  if (type === 'ipv6') return ipv6Target(value);
  return asnTarget(value);
}

function requirementId(value: unknown): LookupClaimRequirementId {
  if (typeof value !== 'string' || !REQUIREMENT_IDS.has(value)) {
    throw new TypeError('The selected claim contains an unsupported evidence requirement.');
  }
  return value as LookupClaimRequirementId;
}

export async function buildLookupClaimPassport(input: Readonly<{
  readiness: LookupClaimReadiness;
  claimId: unknown;
  targetType: unknown;
  target: unknown;
  lookupDepth: unknown;
  observedAt?: unknown;
  evidenceObservedAtById?: Readonly<Record<string, unknown>>;
  riskModelVersion?: unknown;
  applicationVersion: unknown;
  generatedAt?: unknown;
}>): Promise<Readonly<{ document: LookupClaimPassport; content: string; filename: string }>> {
  if (input.readiness.version !== LOOKUP_CLAIM_READINESS_VERSION) {
    throw new TypeError('The Evidence Readiness contract is not supported for passport export.');
  }
  if (input.readiness.entries.length > LOOKUP_CLAIM_IDS.length) {
    throw new TypeError('The Evidence Readiness contract contains too many entries for passport export.');
  }
  const rawClaimId = exactText(input.claimId, 80);
  if (!CLAIM_IDS.has(rawClaimId)) throw new TypeError('Select a current Lookup claim to export.');
  const claimId = rawClaimId as LookupClaimId;
  const selected = input.readiness.entries.find((entry) => entry.id === claimId);
  if (!selected || !CLAIM_STATES.has(selected.state)) throw new TypeError('Select a current Lookup claim to export.');
  if (selected.requirements.length < 1 || selected.requirements.length > MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS) {
    throw new TypeError('The selected claim has an unsupported evidence-requirement count.');
  }
  const type = targetType(input.targetType);
  const value = targetValue(type, input.target);
  const generatedAt = timestamp(input.generatedAt) ?? new Date().toISOString();
  const applicationVersion = exactText(input.applicationVersion, 80);
  if (!SEMVER_RE.test(applicationVersion)) throw new TypeError('A valid application version is required for a claim passport.');
  const lookupDepth = input.lookupDepth === 'deep' ? 'deep' : input.lookupDepth === 'fast' ? 'fast' : null;
  if (!lookupDepth) throw new TypeError('A completed Lookup depth is required for a claim passport.');
  const requirementIds = new Set<LookupClaimRequirementId>();
  const requirements: LookupClaimPassportRequirement[] = selected.requirements.map((source) => {
    const id = requirementId(source.id);
    if (requirementIds.has(id) || !SOURCE_STATES.has(source.state)) {
      throw new TypeError('The selected claim contains duplicate or invalid evidence requirements.');
    }
    requirementIds.add(id);
    let evidenceId: string | null = null;
    if (source.evidenceId !== null) {
      const normalizedEvidenceId = exactText(source.evidenceId, 64);
      if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(normalizedEvidenceId)) throw new TypeError('The selected claim contains an invalid evidence source identifier.');
      evidenceId = normalizedEvidenceId;
    }
    if (source.mode !== 'network_collection' && source.mode !== 'local_review') {
      throw new TypeError('The selected claim contains an invalid evidence requirement mode.');
    }
    return Object.freeze({
      id,
      label: exactText(source.label, 160),
      evidenceId,
      mode: source.mode,
      state: source.state,
      observedAt: evidenceId ? timestamp(input.evidenceObservedAtById?.[evidenceId]) : null,
      limitations: Object.freeze(uniqueText(source.limitations, 8)),
    });
  });
  if (requirements.some((item) => !item.label)) throw new TypeError('The selected claim contains an invalid evidence label.');
  const requiredEvidenceIds = requirements.map((item) => item.id);
  const missingEvidenceIds = requirements.filter((item) => item.state !== 'complete').map((item) => item.id);
  const riskModelVersion = Number.isSafeInteger(input.riskModelVersion)
    && Number(input.riskModelVersion) >= 1
    && Number(input.riskModelVersion) <= 1_000
    ? Number(input.riskModelVersion)
    : null;
  const claimLabel = exactText(selected.label, 160);
  const claimConclusion = exactText(selected.conclusion, 600);
  const unsigned = {
    schema: LOOKUP_CLAIM_PASSPORT_SCHEMA as typeof LOOKUP_CLAIM_PASSPORT_SCHEMA,
    version: LOOKUP_CLAIM_PASSPORT_VERSION as typeof LOOKUP_CLAIM_PASSPORT_VERSION,
    generatedAt,
    application: { name: 'WHOISleuth' as const, version: applicationVersion },
    target: { type, value },
    observation: { observedAt: timestamp(input.observedAt), lookupDepth } as const,
    claim: {
      id: claimId,
      label: claimLabel,
      state: selected.state,
      conclusion: claimConclusion,
      requiredEvidenceIds,
      missingEvidenceIds,
      requirements,
      limitations: uniqueText(selected.limitations),
    },
    models: {
      claimReadiness: LOOKUP_CLAIM_READINESS_VERSION,
      risk: riskModelVersion,
    } as const,
    limitations: uniqueText([
      input.readiness.limitation,
      'This portable passport records evidence sufficiency for one point-in-time statement. It does not establish that the statement is true, current, safe, authorized, or attributable to an owner or actor.',
      'The SHA-256 digest detects changes to this file. It does not authenticate the analyst, collection source, signer, or truth of the retained states.',
      'Raw registry responses, contacts, page values, request paths, credentials, and browser-local records are excluded.',
    ]),
  };
  if (!unsigned.claim.label || !unsigned.claim.conclusion) throw new TypeError('The selected claim is incomplete.');
  const digestSha256 = await sha256ArtifactDigestV2(unsigned);
  const document: LookupClaimPassport = Object.freeze({
    ...unsigned,
    claim: Object.freeze({
      ...unsigned.claim,
      requiredEvidenceIds: Object.freeze(requiredEvidenceIds),
      missingEvidenceIds: Object.freeze(missingEvidenceIds),
      requirements: Object.freeze(requirements),
      limitations: Object.freeze(unsigned.claim.limitations),
    }),
    limitations: Object.freeze(unsigned.limitations),
    integrity: Object.freeze({ algorithm: 'SHA-256', canonicalization: SORTED_JSON_V2, digestSha256 }),
  });
  const content = `${JSON.stringify(document, null, 2)}\n`;
  if (new TextEncoder().encode(content).byteLength > MAX_LOOKUP_CLAIM_PASSPORT_BYTES) {
    throw new TypeError('The claim passport exceeds its export byte limit.');
  }
  const safeTarget = value.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 100) || 'target';
  return Object.freeze({
    document,
    content,
    filename: `whoisleuth-claim-${safeTarget}-${claimId}-${generatedAt.slice(0, 10)}.json`,
  });
}
