// Pure, bounded state, view adapters, and export contract for the public
// synthetic demo. Fixtures use reserved domains and never flow into live
// lookup or production browser-store contracts. The adapters deliberately
// target the same read-only component contracts as the authenticated console so
// presentation changes do not require a second implementation in this route.

import { normalizeBrandProfile } from './brand-profile-model.js';
import { normalizeCase } from './case-model.js';
import { deriveTimeline } from './evidence-display.js';
import { RISK_MODEL_VERSION } from './scoring.js';

export const SYNTHETIC_DEMO_VERSION = 1;
export const SYNTHETIC_DEMO_EXPORT_VERSION = 3;
export const SYNTHETIC_DEMO_STORAGE_KEY = 'whoisleuth:synthetic-demo:v1';
export const SYNTHETIC_DEMO_EXPORT_SCHEMA = 'whoisleuth.synthetic-demo-case';
export const MAX_SYNTHETIC_DEMO_NOTE_LENGTH = 800;

export const SYNTHETIC_DEMO_STAGES = Object.freeze([
  Object.freeze({ id: 'dashboard', label: '1. Dashboard' }),
  Object.freeze({ id: 'brands', label: '2. Brands' }),
  Object.freeze({ id: 'discover', label: '3. Discover' }),
  Object.freeze({ id: 'bulk', label: '4. Bulk' }),
  Object.freeze({ id: 'lookup', label: '5. Lookup' }),
  Object.freeze({ id: 'monitor', label: '6. Monitor' }),
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

const normalizedProfile = normalizeBrandProfile({
  id: 'synthetic-northstar',
  name: 'Northstar Outfitters',
  officialDomains: ['northstar.example'],
  productNames: ['Northstar Vault', 'Northstar Rewards'],
  tlds: ['example', 'invalid'],
  approvedPartnerDomains: [],
  allowlistedDomains: [],
  allowlistedRegistrars: [],
  dkimSelectors: [],
  trademarkOwner: '',
  trademarkRegistration: '',
  officialFaviconHash: '',
  officialFaviconPHash: '',
  pageBaseline: {
    baselineVersion: 1,
    domain: 'northstar.example',
    lookupDomain: 'northstar.example',
    observedAt: '2026-06-20T09:00:00.000Z',
    pageIdentityVersion: 3,
    fingerprintVersion: 1,
    pageTitle: 'Northstar Outfitters',
    canonicalHost: 'northstar.example',
    normalizedHtml: { algorithm: 'sha256', value: 'a'.repeat(64), tokenCount: 120, truncated: false },
    visibleText: null,
    domStructure: { algorithm: 'sha256', value: 'b'.repeat(64), nodeCount: 42, parser: 'static-tag-sequence-v1', truncated: false },
    formStructure: null,
    resourceHosts: { algorithm: 'set-sha256', value: null, values: [], truncated: false },
    trackingIdentifiers: { algorithm: 'set-sha256', value: null, values: [], truncated: false },
    complete: true,
    truncated: false,
  },
  createdAt: '2026-06-20T09:00:00.000Z',
  updatedAt: '2026-06-20T09:00:00.000Z',
});

if (!normalizedProfile) throw new Error('The synthetic demo profile fixture is invalid.');
export const SYNTHETIC_DEMO_PROFILE = deepFreeze(normalizedProfile);

function frozenCandidate(value) {
  const { changeEvidence, ...candidate } = value;
  const availability = value.availability.toLowerCase();
  const hasMx = /\bMX\b/i.test(value.evidence.dns.mail);
  const hasSpf = /\bSPF\b/i.test(value.evidence.dns.mail);
  const baseline = {
    capturedAt: '2026-06-26T11:15:00.000Z',
    source: 'lookup',
    scanDepth: 'deep',
    availability: availability === 'unknown' ? 'unknown' : 'registered',
    confidence: availability === 'unknown' ? 'low' : 'high',
    riskModelVersion: RISK_MODEL_VERSION,
    riskScore: value.risk,
    riskFactors: value.riskFactors,
    opportunityScore: null,
    opportunityFactors: [],
    registrar: value.evidence.registry.registrar === 'Not observed' ? null : value.evidence.registry.registrar,
    createdDate: value.evidence.registry.registeredAt === 'Not observed' ? null : value.evidence.registry.registeredAt,
    expiryDate: null,
    nameservers: value.evidence.dns.nameservers,
    hasMx,
    hasSpf,
    hasDmarc: false,
    activityStatus: /parked/i.test(value.evidence.website.status) ? 'parked' : /inconclusive/i.test(value.evidence.website.status) ? 'unreachable' : 'active',
    websiteProbeDetail: value.evidence.website.detail,
    pageTitle: value.id === 'credential-lure' ? 'Northstar account access' : null,
    httpSummaryVersion: 1,
    httpEvidenceStatus: /inconclusive/i.test(value.evidence.website.status) ? 'inconclusive' : 'success',
    httpFinalOrigin: `https://${value.domain}`,
    httpResponseStatus: /inconclusive/i.test(value.evidence.website.status) ? null : 200,
    httpTransportSecurity: 'https',
    httpRedirectCount: 0,
    httpCrossOriginRedirect: false,
    httpHttpsDowngrade: false,
    httpContentType: 'text/html',
    httpSecurityHeaders: ['content-security-policy'],
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: value.id === 'credential-lure',
    phishingLanguageMatch: value.id === 'credential-lure' ? 'Sign in to continue' : null,
    mutationTypes: [value.mutation],
  };
  const observations = [
    baseline,
    { ...baseline, capturedAt: '2026-06-27T11:15:00.000Z', source: 'monitor' },
    { ...baseline, ...changeEvidence, capturedAt: '2026-07-01T11:15:00.000Z', source: 'monitor' },
  ];
  return deepFreeze({
    ...candidate,
    signals: Object.freeze([...value.signals]),
    riskFactors: Object.freeze(value.riskFactors.map((factor) => Object.freeze({ ...factor }))),
    provenance: Object.freeze({ ...value.provenance, hostnames: Object.freeze([...value.provenance.hostnames]) }),
    relationship: value.relationship ? Object.freeze({ ...value.relationship }) : null,
    evidence: Object.freeze({
      registry: Object.freeze({ ...value.evidence.registry }),
      dns: Object.freeze({ ...value.evidence.dns, nameservers: Object.freeze([...value.evidence.dns.nameservers]) }),
      website: Object.freeze({ ...value.evidence.website }),
      certificate: Object.freeze({ ...value.evidence.certificate }),
    }),
    observations,
  });
}

export const SYNTHETIC_DEMO_CANDIDATES = Object.freeze([
  frozenCandidate({
    id: 'credential-lure', domain: 'northstar-login.example', mutation: 'Brand + login term', availability: 'Registered', risk: 78,
    signals: ['Recently observed registration', 'Mail exchanger configured', 'Password form present'],
    riskFactors: [
      { label: 'Credential-themed mutation', points: 22 },
      { label: 'Recently observed registration', points: 20 },
      { label: 'Password form present', points: 24 },
      { label: 'Mail configured', points: 12 },
    ],
    provenance: { source: 'Certificate Transparency', firstObservedAt: '2026-06-24T08:30:00.000Z', lastObservedAt: '2026-06-26T11:10:00.000Z', certificateCount: 2, hostnames: ['northstar-login.example', 'www.northstar-login.example'] },
    relationship: { label: 'Shared nameserver', value: 'ns1.shared-example.invalid', relatedCandidates: 2 },
    evidence: {
      registry: { status: 'Registered', registrar: 'Example Registrar (synthetic)', registeredAt: '2026-06-24', source: 'Registry RDAP fixture' },
      dns: { status: 'Observed', nameservers: ['ns1.shared-example.invalid', 'ns2.shared-example.invalid'], mail: 'MX and SPF observed', source: 'DNS fixture' },
      website: { status: 'Active synthetic landing page', detail: 'Password form present; page identity differs from the official baseline', source: 'HTTP fixture' },
      certificate: { status: 'Observed', detail: 'Synthetic certificate for the candidate hostname', source: 'TLS fixture' },
    },
    changeEvidence: {
      riskScore: 86,
      riskFactors: [
        { label: 'Credential-themed mutation', points: 22 },
        { label: 'Recently observed registration', points: 20 },
        { label: 'Password form present', points: 24 },
        { label: 'Mail configured', points: 12 },
        { label: 'Synthetic sign-in flow observed', points: 8 },
      ],
      hasDmarc: true,
      websiteProbeDetail: 'Synthetic sign-in flow replaced the earlier landing-page fixture',
      pageTitle: 'Northstar secure sign in',
    },
  }),
  frozenCandidate({
    id: 'character-edit', domain: 'northstarr.example', mutation: 'Character duplication', availability: 'Registered', risk: 34,
    signals: ['Character edit', 'Parked page pattern'],
    riskFactors: [{ label: 'Character mutation', points: 14 }, { label: 'Recent infrastructure relationship', points: 20 }],
    provenance: { source: 'Generated candidate', firstObservedAt: null, lastObservedAt: null, certificateCount: 0, hostnames: [] },
    relationship: { label: 'Shared nameserver', value: 'ns1.shared-example.invalid', relatedCandidates: 2 },
    evidence: {
      registry: { status: 'Registered', registrar: 'Example Registrar (synthetic)', registeredAt: '2025-11-08', source: 'Registry RDAP fixture' },
      dns: { status: 'Observed', nameservers: ['ns1.shared-example.invalid'], mail: 'No MX observed', source: 'DNS fixture' },
      website: { status: 'Synthetic parked page', detail: 'Parking-pattern fixture; no ownership inference', source: 'HTTP fixture' },
      certificate: { status: 'Not observed', detail: 'No certificate fixture retained', source: 'TLS fixture' },
    },
    changeEvidence: {
      activityStatus: 'active',
      websiteProbeDetail: 'The parking-pattern fixture changed to a generic active page fixture',
      pageTitle: 'Northstar resources',
    },
  }),
  frozenCandidate({
    id: 'alternate-tld', domain: 'northstar.invalid', mutation: 'Alternate TLD', availability: 'Unknown', risk: 52,
    signals: ['Official label on alternate TLD', 'Collection intentionally incomplete'],
    riskFactors: [{ label: 'Exact official label', points: 28 }, { label: 'Incomplete deep evidence', points: 24 }],
    provenance: { source: 'Generated candidate', firstObservedAt: null, lastObservedAt: null, certificateCount: 0, hostnames: [] },
    relationship: null,
    evidence: {
      registry: { status: 'Inconclusive', registrar: 'Not observed', registeredAt: 'Not observed', source: 'Registry fixture' },
      dns: { status: 'Not evaluated', nameservers: [], mail: 'Not evaluated', source: 'DNS fixture' },
      website: { status: 'Probe inconclusive', detail: 'No negative activity finding is inferred', source: 'HTTP fixture' },
      certificate: { status: 'Not evaluated', detail: 'No certificate fixture evaluated', source: 'TLS fixture' },
    },
    changeEvidence: {
      confidence: 'medium',
      websiteProbeDetail: 'A later synthetic probe remained inconclusive after fast signals were repeated',
    },
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
  return { version: SYNTHETIC_DEMO_VERSION, started: false, profileReady: false, candidatesReady: false, selectedCandidateId: '', caseReady: false, caseStatus: 'new', note: '', followUpReady: false };
}

/** @param {unknown} value */
export function normalizeSyntheticDemoState(value) {
  const fallback = createSyntheticDemoState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.version !== SYNTHETIC_DEMO_VERSION) return fallback;
  // `started` was added additively: infer it from older valid progress so a
  // tab opened on the earlier five-stage demo is not needlessly reset.
  const started = record.started === true || record.profileReady === true;
  const profileReady = started && record.profileReady === true;
  const candidatesReady = profileReady && record.candidatesReady === true;
  const selectedCandidateId = candidatesReady && typeof record.selectedCandidateId === 'string' && CANDIDATE_IDS.has(record.selectedCandidateId) ? record.selectedCandidateId : '';
  const caseReady = Boolean(selectedCandidateId) && record.caseReady === true;
  return {
    version: SYNTHETIC_DEMO_VERSION,
    started,
    profileReady,
    candidatesReady,
    selectedCandidateId,
    caseReady,
    caseStatus: caseReady && typeof record.caseStatus === 'string' && CASE_STATUSES.has(record.caseStatus) ? record.caseStatus : 'new',
    note: caseReady ? boundedNote(record.note) : '',
    followUpReady: caseReady && record.followUpReady === true,
  };
}

export function syntheticDemoCandidate(id) {
  return SYNTHETIC_DEMO_CANDIDATES.find((item) => item.id === id) || null;
}

export function syntheticDemoStage(state) {
  const normalized = normalizeSyntheticDemoState(state);
  if (normalized.caseReady) return 'monitor';
  if (normalized.selectedCandidateId) return 'lookup';
  if (normalized.candidatesReady) return 'bulk';
  if (normalized.profileReady) return 'discover';
  if (normalized.started) return 'brands';
  return 'dashboard';
}

export function syntheticDemoCaseRecord(state) {
  const normalized = normalizeSyntheticDemoState(state);
  const candidate = syntheticDemoCandidate(normalized.selectedCandidateId);
  if (!normalized.caseReady || !candidate) return null;
  const observations = normalized.followUpReady ? candidate.observations : candidate.observations.slice(0, 1);
  return normalizeCase({
    id: `demo-${candidate.id}`,
    domain: candidate.domain,
    status: normalized.caseStatus,
    disposition: 'unreviewed',
    tags: ['synthetic-demo'],
    notes: normalized.note ? [{ id: 'demo-note', body: normalized.note, createdAt: '2026-07-01T11:20:00.000Z' }] : [],
    source: 'lookup',
    evidenceHistory: observations,
    createdAt: '2026-06-26T11:15:00.000Z',
    updatedAt: normalized.followUpReady ? '2026-07-01T11:20:00.000Z' : '2026-06-26T11:15:00.000Z',
  }, undefined, '2026-07-01T11:20:00.000Z');
}

export function syntheticDemoTimeline(id, includeFollowUp = false) {
  const candidate = syntheticDemoCandidate(id);
  if (!candidate) return [];
  const record = syntheticDemoCaseRecord({
    version: SYNTHETIC_DEMO_VERSION,
    started: true,
    profileReady: true,
    candidatesReady: true,
    selectedCandidateId: id,
    caseReady: true,
    caseStatus: 'monitoring',
    note: '',
    followUpReady: includeFollowUp,
  });
  if (!record) return [];
  return deriveTimeline(record.evidenceHistory).reverse().map((entry) => ({
    id: entry.snapshot.id,
    capturedAt: entry.snapshot.capturedAt,
    label: entry.isBaseline ? 'Baseline' : 'Material change',
    repeated: entry.hasRepeatedObservation,
    changes: (entry.changes || []).map((change) => ({
      field: change.label,
      before: change.before,
      after: change.after,
      tone: change.tone,
    })),
  }));
}

export function syntheticDemoRelationshipGroups() {
  const groups = new Map();
  for (const candidate of SYNTHETIC_DEMO_CANDIDATES) {
    if (!candidate.relationship) continue;
    const key = `${candidate.relationship.label}\u0000${candidate.relationship.value}`;
    const existing = groups.get(key) || {
      type: 'nameserver_set',
      label: candidate.relationship.label,
      method: 'Exact normalized infrastructure value',
      value: candidate.relationship.value,
      normalizedValue: candidate.relationship.value.toLowerCase(),
      domains: [],
      description: 'This shared synthetic observation is an investigation pivot, not proof of ownership, coordination, or maliciousness.',
    };
    existing.domains.push(candidate.domain);
    groups.set(key, existing);
  }
  return [...groups.values()].map((group) => ({ ...group, domains: [...group.domains].sort() }));
}

export function syntheticDemoLookupView(id) {
  const candidate = syntheticDemoCandidate(id);
  if (!candidate) return null;
  const registry = candidate.evidence.registry;
  const dns = candidate.evidence.dns;
  const website = candidate.evidence.website;
  const certificate = candidate.evidence.certificate;
  const conclusive = candidate.availability !== 'Unknown';
  const observedAt = candidate.provenance.lastObservedAt || '2026-06-26T11:15:00.000Z';
  const active = candidate.id === 'credential-lure';
  const fixtureAddress = candidate.id === 'character-edit' ? '203.0.113.45' : '203.0.113.44';
  return {
    assessment: {
      detail: candidate.availability,
      confidence: conclusive ? 'High' : 'Low',
      risk: { score: candidate.risk, factors: candidate.riskFactors.map((factor) => ({ label: factor.label, delta: factor.points })) },
      opportunity: null,
      signals: candidate.signals.map((label) => ({ label, tone: candidate.risk >= 70 ? 'danger' : 'warn' })),
      trusted: '',
    },
    registry: {
      comparisonSummary: '',
      comparisonRows: [],
      comparisonHasConflicts: false,
      rdapError: conclusive ? '' : 'The synthetic registry fixture is inconclusive; no absence finding is inferred.',
      resultType: 'domain',
      rdapParsed: {
        domain: candidate.domain,
        unicodeDomain: null,
        handle: `SYNTHETIC-${candidate.id.toUpperCase()}`,
        registrar: registry.registrar === 'Not observed' ? null : registry.registrar,
        registrarIanaId: null,
        dnssec: 'Unsigned synthetic fixture',
        dsData: [],
        statuses: [registry.status],
        nameservers: [...dns.nameservers],
        nameserverDetails: [],
        variants: [],
        objectClassName: 'domain',
        language: null,
        conformance: ['rdap_level_0'],
        events: registry.registeredAt === 'Not observed' ? [] : [{ action: 'registration', date: registry.registeredAt }],
        lifecycle: { databaseUpdatedDateIso: observedAt },
        links: [],
        notices: [{ title: 'Synthetic fixture', descriptions: ['No registry request was performed.'] }],
        remarks: [],
        entitiesByRole: {},
      },
      rdapPartialDetail: '',
      rdapRows: [],
      whoisError: conclusive ? '' : 'The synthetic WHOIS fixture is inconclusive; no absence finding is inferred.',
      whoisRows: conclusive ? [
        { label: 'Domain', value: candidate.domain },
        { label: 'Registrar', value: registry.registrar },
        { label: 'Created', value: registry.registeredAt },
        { label: 'Nameservers', value: dns.nameservers.join(', ') || 'Not observed' },
      ] : [],
      whoisContactRoles: [],
      whoisTruncatedFields: [],
      registrar: { visible: false, label: '', endpoint: '', detail: '', stateDetail: '', error: false, success: false, parsed: {} },
    },
    dns: {
      status: conclusive ? 'Success' : 'Partial',
      complete: conclusive,
      rows: [
        { label: 'Nameservers', value: dns.nameservers.join(', ') || 'Not evaluated' },
        { label: 'Mail posture', value: dns.mail },
        { label: 'Observed records', value: dns.nameservers.length ? `${dns.nameservers.length} nameserver${dns.nameservers.length === 1 ? '' : 's'}` : 'None evaluated' },
      ],
      failureDetail: conclusive ? '' : 'the synthetic DNS collection was not evaluated',
      truncated: false,
    },
    http: {
      status: /inconclusive/i.test(website.status) ? 'Partial' : 'Success',
      complete: !/inconclusive/i.test(website.status),
      rows: [
        { label: 'Observation', value: website.detail },
        { label: 'Final origin', value: `https://${candidate.domain}` },
        { label: 'Response', value: /inconclusive/i.test(website.status) ? 'Not observed' : 'HTTP 200' },
      ],
      crossOriginRedirect: false,
      httpsDowngrade: false,
      redirects: [],
      attempts: [{ url: `https://${candidate.domain}`, detail: 'Synthetic fixture; no connection was attempted' }],
      metadata: [],
      limitations: ['This is fixed demonstration evidence, not a live website observation.'],
    },
    securityTxt: {
      state: active ? 'present' : conclusive ? 'not_found' : 'skipped',
      detail: active ? 'A fixed disclosure-contact fixture was selected for this demonstration.' : conclusive ? 'The fixed fixture contains no published disclosure file.' : 'The disclosure-contact action was not represented for this inconclusive fixture.',
      endpoint: active ? `https://${candidate.domain}/.well-known/security.txt` : '',
      httpStatus: active ? '200' : conclusive ? '404' : '',
      observedAt: active ? observedAt : '',
      expiresAt: active ? '2026-12-31T00:00:00.000Z' : '',
      contacts: active ? [`mailto:security@${candidate.domain}`] : [],
      policies: active ? [`https://${candidate.domain}/security-policy`] : [],
      encryption: [],
      languages: active ? ['en'] : [],
      limitations: ['Fixed synthetic disclosure fixture; no request was performed and no testing is authorized.'],
    },
    securityPosture: {
      status: conclusive ? 'Success' : 'Partial',
      complete: conclusive,
      summary: conclusive ? { observed: 2, potentialExposure: active ? 1 : 0, observedAbsence: active ? 1 : 0, unavailable: 0 } : { observed: 0, potentialExposure: 0, observedAbsence: 0, unavailable: 4 },
      findings: conclusive ? [
        { id: 'https-transport', category: 'Transport', state: 'observed', tone: 'configured', label: 'HTTPS transport observed', detail: 'The fixed homepage fixture uses HTTPS.', evidence: ['HTTP fixture'] },
        { id: 'certificate-hostname', category: 'Certificate', state: 'observed', tone: 'configured', label: 'Certificate hostname matched', detail: 'The fixed certificate fixture includes the candidate hostname.', evidence: ['TLS fixture'] },
        ...(active ? [
          { id: 'csp-header', category: 'Browser policy', state: 'observed_absence', tone: 'review', label: 'Content Security Policy not observed', detail: 'The fixed response-header fixture does not contain this policy.', evidence: ['HTTP fixture'] },
          { id: 'password-form', category: 'Page behavior', state: 'potential_exposure', tone: 'review', label: 'Password form observed', detail: 'A password field appears in the fixed static page fixture.', evidence: ['Page fixture'] },
        ] : []),
      ] : [
        { id: 'collection-unavailable', category: 'Collection', state: 'unavailable', tone: 'neutral', label: 'Posture evidence unavailable', detail: 'The synthetic deep collection is intentionally inconclusive.', evidence: [] },
      ],
      limitations: ['Fixed derived findings for demonstration only; no active vulnerability test was performed.'],
    },
    technology: {
      status: conclusive ? 'Success' : 'Partial',
      complete: conclusive,
      findings: active ? [
        { id: 'synthetic-example-cms', name: 'Example CMS', category: 'content management', confidence: 'high', evidence: [{ source: 'Generator metadata', description: 'A fixed generator fixture identifies the example CMS.' }] },
        { id: 'synthetic-example-commerce', name: 'Example Commerce', category: 'commerce', confidence: 'medium', evidence: [{ source: 'Resource origin', description: 'A fixed resource-origin fixture resembles a commerce delivery service.' }] },
        { id: 'synthetic-example-edge', name: 'Example Edge', category: 'delivery platform', confidence: 'high', evidence: [{ source: 'HTTP server header', description: 'A fixed response-header fixture identifies the example edge service.' }] },
      ] : [],
      limitations: ['Fixed technology indicators for demonstration only; no additional request was performed.'],
    },
    network: {
      status: conclusive ? 'Success' : 'Unsupported',
      detail: conclusive ? 'A fixed reserved-address fixture demonstrates separately attributed network registration.' : 'No observed network fixture is represented for this inconclusive candidate.',
      address: conclusive ? fixtureAddress : '',
      addressSource: conclusive ? 'TLS connection fixture' : '',
      rdapEndpoint: conclusive ? `https://rdap.example.invalid/ip/${fixtureAddress}` : '',
      httpStatus: conclusive ? '200' : '',
      fetchedAt: conclusive ? observedAt : '',
      rows: conclusive ? [
        { label: 'Registered network', value: 'Documentation network (synthetic)' },
        { label: 'Country', value: 'ZZ' },
        { label: 'CIDR', value: '203.0.113.0/24' },
      ] : [],
      limitations: ['203.0.113.0/24 is reserved for documentation and does not identify a live host or network operator.'],
      provenance: 'This fixed reserved-address fixture demonstrates the network-context presentation only. It is not a public endpoint observation and does not identify hosting, ownership, control, intent, or maliciousness.',
    },
    tls: {
      status: certificate.status === 'Observed' ? 'Success' : 'Partial',
      complete: certificate.status === 'Observed',
      rows: [
        { label: 'Observation', value: certificate.detail },
        { label: 'Hostname', value: candidate.domain },
        { label: 'Collection time', value: observedAt.slice(0, 10) },
      ],
      findings: [],
      leafCertificate: [],
      alternativeNames: candidate.provenance.hostnames.map((value) => ({ type: 'DNS', value })),
      alternativeNamesTruncated: false,
      chain: [],
      chainTruncated: false,
      validationDetails: [{ label: 'Source', value: certificate.source }],
      limitations: ['This is a fixed certificate fixture; certificate presence does not establish site activity or intent.'],
    },
  };
}

/** @param {unknown} state @param {string} generatedAt */
export function buildSyntheticDemoExport(state, generatedAt) {
  const normalized = normalizeSyntheticDemoState(state);
  const candidate = syntheticDemoCandidate(normalized.selectedCandidateId);
  if (!normalized.caseReady || !normalized.followUpReady || !candidate) throw new Error('Complete the monitored synthetic case before exporting it.');
  if (typeof generatedAt !== 'string' || generatedAt.length > 64 || /[\x00-\x1f\x7f]/.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) throw new Error('A valid export timestamp is required.');
  const lookupView = syntheticDemoLookupView(candidate.id);
  if (!lookupView) throw new Error('The selected synthetic lookup fixture is unavailable.');
  return {
    schema: SYNTHETIC_DEMO_EXPORT_SCHEMA,
    version: SYNTHETIC_DEMO_EXPORT_VERSION,
    synthetic: true,
    generatedAt: new Date(generatedAt).toISOString(),
    warning: 'Synthetic demonstration data only. This is not a live finding and must not be used as evidence or an abuse report.',
    profile: { name: SYNTHETIC_DEMO_PROFILE.name, officialDomain: SYNTHETIC_DEMO_PROFILE.officialDomains[0], products: [...SYNTHETIC_DEMO_PROFILE.productNames] },
    case: { domain: candidate.domain, status: normalized.caseStatus, note: normalized.note || null },
    assessment: { availability: candidate.availability, risk: candidate.risk, mutation: candidate.mutation, signals: [...candidate.signals], riskFactors: candidate.riskFactors.map((factor) => ({ ...factor })) },
    provenance: { ...candidate.provenance, hostnames: [...candidate.provenance.hostnames] },
    relationship: candidate.relationship ? { ...candidate.relationship } : null,
    evidence: {
      registry: { ...candidate.evidence.registry },
      dns: { ...candidate.evidence.dns, nameservers: [...candidate.evidence.dns.nameservers] },
      website: { ...candidate.evidence.website },
      certificate: { ...candidate.evidence.certificate },
      securityTxt: structuredClone(lookupView.securityTxt),
      securityPosture: structuredClone(lookupView.securityPosture),
      technology: structuredClone(lookupView.technology),
      observedNetwork: structuredClone(lookupView.network),
    },
    timeline: syntheticDemoTimeline(candidate.id, true),
    limitations: ['All values are fixed local fixtures using reserved domains and addresses.', 'No registry, DNS, website, certificate, or other investigation request was performed.', 'Synthetic risk values and relationships demonstrate presentation only and are not a live assessment.'],
  };
}
