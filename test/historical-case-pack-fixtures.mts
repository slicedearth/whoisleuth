import { createHash } from 'node:crypto';

import { canonicalArtifactJson } from '../frontend/src/lib/analysis/artifact-integrity.ts';

export const HISTORICAL_CASE_PACK_NOW = '2026-08-05T03:00:00.000Z';

const FIRST_CAPTURED_AT = '2026-01-01T00:00:00.000Z';
const SECOND_CAPTURED_AT = '2026-02-01T00:00:00.000Z';
const PACKET_LIMITATIONS = [
  'This local package is browser-importable through its top-level case collection and does not upload or submit evidence.',
  'The reviewed flag records a deliberate CLI choice; it does not prove recipient authorisation, factual correctness, or legal sufficiency.',
  'Importing the package does not restore fields excluded by its audience profile.',
];
const REPORT_LIMITATIONS = {
  risk: 'This report contains normalized browser-local observations from WHOISleuth analyst cases. It is not a live lookup and does not contain raw WHOIS, RDAP, DNS, HTML, or responses collected during website checks. Absence of a signal (e.g. no MX record observed) does not prove nonexistence. It may not have been evaluated. Snapshot fingerprints are deduplication identifiers, not cryptographic evidence hashes. Scan-depth and risk-model gates prevent misleading comparisons; "incomparable" means observations differ materially but one or more fields cannot be compared reliably. Generated locally in the browser. Review the package before sharing it.',
  scoring: 'This report contains normalized browser-local observations from WHOISleuth analyst cases. It is not a live lookup and does not contain raw WHOIS, RDAP, DNS, HTML, or responses collected during website checks. Absence of a signal (e.g. no MX record observed) does not prove nonexistence. It may not have been evaluated. Snapshot fingerprints are deduplication identifiers, not cryptographic evidence hashes. Scan-depth and scoring-model gates prevent misleading comparisons; "incomparable" means observations differ materially but one or more fields cannot be compared reliably. Generated locally in the browser. Review the package before sharing it.',
  portable: 'This report contains normalised browser-local observations from WHOISleuth analyst cases. It is not a live lookup and does not contain raw WHOIS, RDAP, DNS, HTML, or responses collected during website checks. Absence of a signal (e.g. no MX record observed) does not prove nonexistence. It may not have been evaluated. Snapshot fingerprints are deduplication identifiers, not cryptographic evidence hashes. Scan-depth and scoring-model gates prevent misleading comparisons; "incomparable" means observations differ materially but one or more fields cannot be compared reliably. Generated locally in the browser. Review the package before sharing it.',
} as const;

type HistoricalAudience = 'internal' | 'public' | 'trusted';

function exclusions(audience: HistoricalAudience, caseVersion: number): string[] {
  if (audience === 'internal') return ['Raw upstream payloads and credentials are outside the case schema.'];
  if (audience === 'trusted') return ['Case notes', 'Recipient values', 'Manual trail targets', 'Raw upstream payloads and credentials'];
  return [
    'Case notes',
    'Actions and recipient values',
    'Analyst assertions',
    ...(caseVersion >= 11 ? ['Investigation branches'] : []),
    'Manual trail targets',
    'Raw upstream payloads and credentials',
  ];
}

function evidenceSnapshot(caseVersion: number, current: boolean): Record<string, unknown> {
  const second = current;
  const fingerprint = caseVersion <= 7
    ? second ? '1uonnn' : 'xul0z4'
    : caseVersion <= 9
      ? second ? '1hn5lkv' : '3fb6ig'
      : second ? '1vx7lwy' : '17ccf6b';
  return {
    id: `ev-${fingerprint}`,
    fingerprint,
    firstCapturedAt: FIRST_CAPTURED_AT,
    capturedAt: second ? SECOND_CAPTURED_AT : FIRST_CAPTURED_AT,
    source: 'lookup',
    scanDepth: 'deep',
    availability: 'registered',
    confidence: 'high',
    riskModelVersion: 1,
    riskScore: second ? 30 : 20,
    ...(caseVersion >= 10 ? { opportunityModelVersion: 1 } : {}),
    opportunityScore: second ? 55 : 40,
    riskFactors: [{ label: 'Base', points: second ? 30 : 20 }],
    opportunityFactors: [{ label: 'Open', points: second ? 55 : 40 }],
    registrar: second ? 'New Registrar' : 'Old Registrar',
    createdDate: '2020-01-01T12:00:00.000Z',
    expiryDate: '2027-01-01T12:00:00.000Z',
    nameservers: ['ns1.example.test'],
    hasMx: true,
    hasSpf: false,
    hasDmarc: false,
    activityStatus: 'active',
    websiteProbeDetail: 'Website responded',
    pageTitle: 'Example page',
    httpSummaryVersion: null,
    httpEvidenceStatus: null,
    httpFinalOrigin: null,
    httpResponseStatus: null,
    httpTransportSecurity: null,
    httpRedirectCount: null,
    httpCrossOriginRedirect: null,
    httpHttpsDowngrade: null,
    httpContentType: null,
    httpSecurityHeaders: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: false,
    ...(caseVersion >= 8 ? { hasExternalFormAction: false } : {}),
    phishingLanguageMatch: null,
    ...(caseVersion >= 10 ? {
      privacyProtected: false,
      idnReferenceMatch: false,
      pageBaselineMatch: false,
      hasActiveBrandProfile: false,
    } : {}),
    mutationTypes: ['replacement'],
  };
}

function historicalResponseRecords(caseVersion: number, reportVersion: number) {
  const evidencePin = caseVersion >= 5 ? {
    id: 'pin-1',
    checkpointId: null,
    field: 'registrar',
    category: 'registration',
    label: 'Registrar',
    value: 'Old Registrar',
    source: 'lookup',
    sourceState: 'complete',
    sourceSchema: null,
    observedAt: FIRST_CAPTURED_AT,
    collectionDepth: 'deep',
    completeness: 'complete',
    truncated: false,
    ...(caseVersion >= 7 ? { transitionExpectation: 'preserve' } : {}),
    limitations: [],
    createdAt: FIRST_CAPTURED_AT,
  } : {
    id: 'pin-1',
    label: 'Registrar',
    value: 'Old Registrar',
    source: 'lookup',
    observedAt: FIRST_CAPTURED_AT,
    completeness: 'complete',
    limitations: [],
    createdAt: FIRST_CAPTURED_AT,
  };
  const assertion = {
    id: 'assertion-1',
    kind: 'hypothesis',
    statement: 'The observed change requires review.',
    rationale: null,
    evidencePinIds: ['pin-1'],
    ...(reportVersion >= 6 ? { evidenceRelations: [{ evidencePinId: 'pin-1', stance: 'supports' }] } : {}),
    state: 'open',
    createdAt: FIRST_CAPTURED_AT,
    updatedAt: SECOND_CAPTURED_AT,
    ...(caseVersion >= 7 ? {
      provenance: {
        origin: 'external_import',
        format: 'stix',
        sourceName: 'Reserved fixture feed',
        sourceDigestSha256: 'a'.repeat(64),
        publisher: null,
        externalId: 'indicator--fixture',
        entityType: 'domain',
        entityValue: 'history.example.test',
        observedAt: FIRST_CAPTURED_AT,
        createdAt: FIRST_CAPTURED_AT,
        modifiedAt: SECOND_CAPTURED_AT,
        confidence: 80,
        labels: ['fixture'],
        markings: [],
      },
    } : {}),
  };
  return {
    evidencePins: [evidencePin],
    decisions: [{
      id: 'decision-1',
      summary: 'Continue review',
      rationale: 'The bounded evidence changed.',
      evidencePinIds: ['pin-1'],
      createdAt: SECOND_CAPTURED_AT,
    }],
    actions: [{
      id: 'action-1',
      type: 'internal_review',
      recipient: 'Internal review team',
      contactSource: 'analyst_supplied',
      contactLimitations: [],
      dueAt: null,
      state: 'planned',
      reference: null,
      followUpAt: null,
      outcome: null,
      createdAt: SECOND_CAPTURED_AT,
      updatedAt: SECOND_CAPTURED_AT,
    }],
    assertions: [assertion],
    manualTrail: [{
      id: 'trail-1',
      kind: 'review',
      summary: 'Reviewed the retained evidence.',
      target: 'history.example.test',
      createdAt: SECOND_CAPTURED_AT,
    }],
    sightings: [{
      id: 'sighting-1',
      state: 'analyst_confirmed',
      sourceClass: 'analyst',
      category: 'registration',
      source: 'Analyst review',
      observedAt: SECOND_CAPTURED_AT,
      completeness: 'complete',
      evidencePinId: 'pin-1',
      limitations: [],
      createdAt: SECOND_CAPTURED_AT,
    }],
    branches: [{
      id: 'branch-1',
      name: 'Registration review',
      state: 'active',
      evidencePinIds: ['pin-1'],
      checkpointIds: [],
      assertionIds: ['assertion-1'],
      actionIds: ['action-1'],
      createdAt: SECOND_CAPTURED_AT,
      updatedAt: SECOND_CAPTURED_AT,
    }],
  };
}

function historicalCase(caseVersion: number, audience: HistoricalAudience, reportVersion: number): Record<string, unknown> {
  const response = historicalResponseRecords(caseVersion, reportVersion);
  const publicAudience = audience === 'public';
  const externalAudience = audience !== 'internal';
  return {
    id: 'case-historical',
    domain: 'history.example.test',
    status: 'reviewing',
    disposition: 'unreviewed',
    ...(caseVersion >= 10 ? { reviewReasonCode: null } : {}),
    tags: ['review'],
    notes: [],
    source: 'lookup',
    evidenceHistory: [evidenceSnapshot(caseVersion, false), evidenceSnapshot(caseVersion, true)],
    ...(caseVersion >= 3 ? {
      evidencePins: response.evidencePins,
      decisions: response.decisions,
      actions: publicAudience ? [] : response.actions.map((item) => ({
        ...item,
        recipient: audience === 'trusted' ? '[redacted]' : item.recipient,
      })),
    } : {}),
    ...(caseVersion >= 4 ? {
      assertions: publicAudience ? [] : response.assertions,
      manualTrail: response.manualTrail.map((item) => ({ ...item, target: externalAudience ? null : item.target })),
    } : {}),
    ...(caseVersion >= 9 ? { sightings: response.sightings } : {}),
    ...(caseVersion >= 11 ? { branches: publicAudience ? [] : response.branches } : {}),
    createdAt: FIRST_CAPTURED_AT,
    updatedAt: SECOND_CAPTURED_AT,
  };
}

function defaultReportVersion(caseVersion: number): number {
  if (caseVersion === 2) return 1;
  if (caseVersion === 3) return 2;
  if (caseVersion <= 8) return 3;
  if (caseVersion === 9) return 4;
  if (caseVersion === 10) return 6;
  return 7;
}

function evidenceChanges() {
  return [
    { field: 'riskScore', label: 'Risk score', before: 20, after: 30, tone: 'warn' },
    { field: 'riskFactors', label: 'Risk factors', before: [{ label: 'Base', points: 20 }], after: [{ label: 'Base', points: 30 }], tone: 'neutral' },
    { field: 'opportunityScore', label: 'Opportunity score', before: 40, after: 55, tone: 'neutral' },
    { field: 'opportunityFactors', label: 'Opportunity factors', before: [{ label: 'Open', points: 40 }], after: [{ label: 'Open', points: 55 }], tone: 'neutral' },
    { field: 'registrar', label: 'Registrar', before: 'Old Registrar', after: 'New Registrar', tone: 'warn' },
  ];
}

function historicalReport(caseVersion: number, reportVersion: number, sourceCase: Record<string, unknown>): Record<string, unknown> {
  const baseline = evidenceSnapshot(caseVersion, false);
  const current = evidenceSnapshot(caseVersion, true);
  return {
    schema: 'whoisleuth.case-report',
    schemaVersion: reportVersion,
    generatedAt: HISTORICAL_CASE_PACK_NOW,
    application: reportVersion >= 6
      ? { name: 'WHOISleuth', version: '1.46.0', projectUrl: 'https://github.com/slicedearth/whoisleuth' }
      : { name: 'WHOISleuth' },
    case: {
      id: 'case-historical',
      domain: 'history.example.test',
      status: 'reviewing',
      disposition: 'unreviewed',
      ...(reportVersion >= 5 ? { reviewReasonCode: null } : {}),
      ...(reportVersion >= 6 ? { interoperabilityTags: [] } : {}),
      tags: ['review'],
      source: 'lookup',
      openedAt: FIRST_CAPTURED_AT,
      updatedAt: SECOND_CAPTURED_AT,
      notesIncluded: false,
    },
    currentAssessment: current,
    evidenceTimeline: [
      {
        snapshot: baseline,
        isBaseline: true,
        hasRepeatedObservation: false,
        changes: null,
        hasIncomparableChange: false,
        incomparableReasons: [],
      },
      {
        snapshot: current,
        isBaseline: false,
        hasRepeatedObservation: true,
        changes: evidenceChanges(),
        hasIncomparableChange: false,
        incomparableReasons: [],
      },
    ],
    ...(reportVersion >= 2 ? {
      analystResponse: {
        evidencePins: structuredClone(sourceCase.evidencePins),
        decisions: structuredClone(sourceCase.decisions),
        actions: structuredClone(sourceCase.actions),
        ...(reportVersion >= 3 ? {
          assertions: structuredClone(sourceCase.assertions),
          manualTrail: structuredClone(sourceCase.manualTrail),
        } : {}),
        ...(reportVersion >= 4 ? { sightings: structuredClone(sourceCase.sightings) } : {}),
        ...(reportVersion >= 7 ? { branches: structuredClone(sourceCase.branches) } : {}),
      },
    } : {}),
    limitations: reportVersion <= 4
      ? REPORT_LIMITATIONS.risk
      : reportVersion === 5
        ? REPORT_LIMITATIONS.scoring
        : REPORT_LIMITATIONS.portable,
  };
}

export function resignHistoricalCasePack<T extends Record<string, unknown>>(value: T): T {
  const { integrity: _integrity, ...unsigned } = value;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v1',
      digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJson(unsigned)).digest('hex')}`,
    },
  } as unknown as T;
}

/** Frozen payloads emitted by the repository's Case/report builders at schemas 2-11. */
export function historicalCasePackFixture(
  caseVersion: number,
  audience: HistoricalAudience = 'public',
  options: Readonly<{ reportVersion?: number }> = {},
): Record<string, unknown> {
  const reportVersion = options.reportVersion ?? defaultReportVersion(caseVersion);
  const sourceCase = historicalCase(caseVersion, audience, reportVersion);
  const unsigned = {
    version: caseVersion,
    exportedAt: HISTORICAL_CASE_PACK_NOW,
    cases: [sourceCase],
    packet: {
      schema: 'whoisleuth.cli.case-pack',
      version: 1,
      audience,
      reviewed: true,
      reports: [historicalReport(caseVersion, reportVersion, sourceCase)],
      redactionManifest: {
        excluded: exclusions(audience, caseVersion),
        sourceCaseCount: 1,
      },
      limitations: [...PACKET_LIMITATIONS],
    },
  };
  return resignHistoricalCasePack(unsigned);
}
