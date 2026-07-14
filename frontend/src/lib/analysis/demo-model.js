// Pure, bounded state and export contract for the public synthetic demo.
// Fixtures use reserved domains and never flow into live lookup or production
// browser-store contracts.

export const SYNTHETIC_DEMO_VERSION = 1;
export const SYNTHETIC_DEMO_STORAGE_KEY = 'whoisleuth:synthetic-demo:v1';
export const SYNTHETIC_DEMO_EXPORT_SCHEMA = 'whoisleuth.synthetic-demo-case';
export const MAX_SYNTHETIC_DEMO_NOTE_LENGTH = 800;

export const SYNTHETIC_DEMO_PROFILE = Object.freeze({
  name: 'Northstar Outfitters',
  officialDomain: 'northstar.example',
  products: Object.freeze(['Northstar Vault', 'Northstar Rewards']),
  monitoredTlds: Object.freeze(['example', 'invalid']),
});

export const SYNTHETIC_DEMO_CANDIDATES = Object.freeze([
  Object.freeze({
    id: 'credential-lure', domain: 'northstar-login.example', mutation: 'Brand + login term', availability: 'Registered', risk: 78,
    signals: Object.freeze(['Recently observed registration', 'Mail exchanger configured', 'Password form present']),
    evidence: Object.freeze({ registrar: 'Example Registrar (synthetic)', registeredAt: '2026-06-24', nameservers: Object.freeze(['ns1.shared-example.invalid', 'ns2.shared-example.invalid']), website: 'Active synthetic landing page', certificate: 'Authorized synthetic certificate', mail: 'MX and SPF observed' }),
  }),
  Object.freeze({
    id: 'character-edit', domain: 'northstarr.example', mutation: 'Character duplication', availability: 'Registered', risk: 34,
    signals: Object.freeze(['Character edit', 'Parked page pattern']),
    evidence: Object.freeze({ registrar: 'Example Registrar (synthetic)', registeredAt: '2025-11-08', nameservers: Object.freeze(['ns1.parking-example.invalid']), website: 'Synthetic parked page', certificate: 'Not observed', mail: 'No MX observed' }),
  }),
  Object.freeze({
    id: 'alternate-tld', domain: 'northstar.invalid', mutation: 'Alternate TLD', availability: 'Unknown', risk: 52,
    signals: Object.freeze(['Official label on alternate TLD', 'Collection intentionally incomplete']),
    evidence: Object.freeze({ registrar: 'Not observed', registeredAt: 'Not observed', nameservers: Object.freeze([]), website: 'Probe inconclusive', certificate: 'Not evaluated', mail: 'Not evaluated' }),
  }),
]);

/** @type {Set<string>} */
const CANDIDATE_IDS = new Set(SYNTHETIC_DEMO_CANDIDATES.map((item) => item.id));
const CASE_STATUSES = new Set(['new', 'reviewing', 'monitoring']);

function boundedNote(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').trim().slice(0, MAX_SYNTHETIC_DEMO_NOTE_LENGTH);
}

export function createSyntheticDemoState() {
  return { version: SYNTHETIC_DEMO_VERSION, profileReady: false, candidatesReady: false, selectedCandidateId: '', caseReady: false, caseStatus: 'new', note: '' };
}

/** @param {unknown} value */
export function normalizeSyntheticDemoState(value) {
  const fallback = createSyntheticDemoState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.version !== SYNTHETIC_DEMO_VERSION) return fallback;
  const profileReady = record.profileReady === true;
  const candidatesReady = profileReady && record.candidatesReady === true;
  const selectedCandidateId = candidatesReady && typeof record.selectedCandidateId === 'string' && CANDIDATE_IDS.has(record.selectedCandidateId) ? record.selectedCandidateId : '';
  const caseReady = Boolean(selectedCandidateId) && record.caseReady === true;
  return {
    version: SYNTHETIC_DEMO_VERSION,
    profileReady,
    candidatesReady,
    selectedCandidateId,
    caseReady,
    caseStatus: caseReady && typeof record.caseStatus === 'string' && CASE_STATUSES.has(record.caseStatus) ? record.caseStatus : 'new',
    note: caseReady ? boundedNote(record.note) : '',
  };
}

export function syntheticDemoCandidate(id) {
  return SYNTHETIC_DEMO_CANDIDATES.find((item) => item.id === id) || null;
}

export function syntheticDemoStage(state) {
  const normalized = normalizeSyntheticDemoState(state);
  if (normalized.caseReady) return 'case';
  if (normalized.selectedCandidateId) return 'evidence';
  if (normalized.candidatesReady) return 'triage';
  if (normalized.profileReady) return 'discover';
  return 'brand';
}

/** @param {unknown} state @param {string} generatedAt */
export function buildSyntheticDemoExport(state, generatedAt) {
  const normalized = normalizeSyntheticDemoState(state);
  const candidate = syntheticDemoCandidate(normalized.selectedCandidateId);
  if (!normalized.caseReady || !candidate) throw new Error('Complete the synthetic case before exporting it.');
  if (typeof generatedAt !== 'string' || generatedAt.length > 64 || /[\x00-\x1f\x7f]/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) throw new Error('A valid export timestamp is required.');
  return {
    schema: SYNTHETIC_DEMO_EXPORT_SCHEMA,
    version: SYNTHETIC_DEMO_VERSION,
    synthetic: true,
    generatedAt: new Date(generatedAt).toISOString(),
    warning: 'Synthetic demonstration data only. This is not a live finding and must not be used as evidence or an abuse report.',
    profile: { name: SYNTHETIC_DEMO_PROFILE.name, officialDomain: SYNTHETIC_DEMO_PROFILE.officialDomain, products: [...SYNTHETIC_DEMO_PROFILE.products] },
    case: { domain: candidate.domain, status: normalized.caseStatus, note: normalized.note || null },
    assessment: { availability: candidate.availability, risk: candidate.risk, mutation: candidate.mutation, signals: [...candidate.signals] },
    evidence: { ...candidate.evidence, nameservers: [...candidate.evidence.nameservers] },
    limitations: ['All values are fixed local fixtures using reserved domains.', 'No registry, DNS, website, certificate, or other network request was performed.', 'Synthetic risk values demonstrate presentation only and are not a live assessment.'],
  };
}
