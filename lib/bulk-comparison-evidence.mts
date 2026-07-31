// Bounded comparison-only evidence for compact Deep Bulk responses. The
// complete technology and TLS observations remain transient and separately
// attributed; this projection retains only stable identifiers and source
// health needed for analyst-controlled comparisons.

type UnknownRecord = Record<string, unknown>;
type ComparisonState = 'error' | 'not_found' | 'partial' | 'success' | 'unavailable';

export const BULK_COMPARISON_EVIDENCE_VERSION = 1;
export const MAX_BULK_TECHNOLOGY_IDS = 12;
export const MAX_BULK_TLS_ISSUER_LENGTH = 240;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const TECHNOLOGY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/iu;
const STATES = new Set<ComparisonState>(['error', 'not_found', 'partial', 'success', 'unavailable']);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string' && value.length <= maximum && !CONTROL_RE.test(value)
    ? value.replace(/\s+/gu, ' ').trim()
    : '';
}

function state(value: unknown): ComparisonState {
  const normalized = boundedText(value, 40).toLowerCase();
  return STATES.has(normalized as ComparisonState)
    ? normalized as ComparisonState
    : 'unavailable';
}

function technologyIds(value: unknown): { ids: string[]; truncated: boolean } {
  if (!Array.isArray(value)) return { ids: [], truncated: false };
  const output = new Set<string>();
  let truncated = value.length > MAX_BULK_TECHNOLOGY_IDS;
  for (const candidate of value.slice(0, MAX_BULK_TECHNOLOGY_IDS * 4)) {
    const id = boundedText(record(candidate).id, 80).toLowerCase();
    if (!TECHNOLOGY_ID_RE.test(id) || output.has(id)) continue;
    if (output.size >= MAX_BULK_TECHNOLOGY_IDS) truncated = true;
    else output.add(id);
  }
  return { ids: [...output].sort(), truncated };
}

function issuerLabel(value: unknown): string | null {
  const issuer = record(value);
  const values = [
    ...(Array.isArray(issuer.commonNames) ? issuer.commonNames : []),
    ...(Array.isArray(issuer.organizations) ? issuer.organizations : []),
  ]
    .slice(0, 8)
    .map((candidate) => boundedText(candidate, 160))
    .filter(Boolean);
  const label = [...new Set(values)].join(' · ');
  return label ? label.slice(0, MAX_BULK_TLS_ISSUER_LENGTH) : null;
}

export function buildBulkComparisonEvidence(availabilityValue: unknown) {
  const availability = record(availabilityValue);
  const technology = record(availability.technologyProfile);
  const technologyState = state(technology.status);
  const technologyUsable = ['success', 'partial'].includes(technologyState);
  const technologyFindings = technologyUsable
    ? technologyIds(technology.findings)
    : { ids: [], truncated: false };
  const tls = record(availability.tls);
  const tlsState = state(tls.status);
  const tlsUsable = ['success', 'partial'].includes(tlsState);
  const certificate = record(tls.certificate);
  const publicKey = record(certificate.publicKey);
  const spki = boundedText(publicKey.fingerprintSha256, 64);
  return {
    version: BULK_COMPARISON_EVIDENCE_VERSION,
    technology: {
      state: technologyState,
      ids: technologyFindings.ids,
      truncated: technologyUsable && (technology.truncated === true || technologyFindings.truncated),
    },
    tls: {
      state: tlsState,
      issuerLabel: tlsUsable ? issuerLabel(certificate.issuer) : null,
      spkiSha256: tlsUsable && SHA256_RE.test(spki) ? spki.toLowerCase() : null,
    },
  };
}
