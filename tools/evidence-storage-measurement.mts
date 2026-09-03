#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  CASE_SCHEMA_VERSION,
  CASE_PORTABILITY_LIFECYCLE_FAMILY,
  CLI_CASE_PACK_CASE_REPORT_EPOCHS,
  MAX_CASE_PACK_CASES,
  MAX_CASE_STORE_BYTES,
} from '../packages/contracts/case-portability.mts';
import {
  buildCaseExport,
  normalizeCaseStore,
  serializeCaseStore,
  type CaseRecord,
} from '../packages/cases/case-model.mts';
import { buildWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { buildCliCasePack } from '../cli/case-pack.mts';
import { assertBoundedJsonStructure, parseBoundedJson } from '../lib/bounded-json.mts';
import { LOOKUP_EVIDENCE_SCHEMA, LOOKUP_EVIDENCE_SCHEMA_VERSION } from '../lib/evidence-export.mts';

export const EVIDENCE_STORAGE_MEASUREMENT_SCHEMA = 'whoisleuth.evidence-storage-measurement';
export const EVIDENCE_STORAGE_MEASUREMENT_VERSION = 1;
export const EVIDENCE_STORAGE_MEASUREMENT_FIXTURE_SCHEMA = 'whoisleuth.evidence-storage-measurement-fixture';
export const EVIDENCE_STORAGE_MEASUREMENT_FIXTURE_PATH = 'test/fixtures/evidence-storage/analyst-journeys-v1.json';
export const EVIDENCE_STORAGE_MEASUREMENT_PROFILE_PATH = 'docs/evidence-storage-measurement-v1.json';
export const EVIDENCE_STORAGE_STARTING_REVISION = 'd3349cf85cded65989ab5ec542967429414bc1b7';
export const MAX_MEASUREMENT_FIXTURE_BYTES = 64 * 1024;
export const MAX_MEASUREMENT_CASES = 500;
export const MAX_MEASUREMENT_SCENARIOS = 8;

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_ENCODER = new TextEncoder();
const FIXED_DIGEST = `sha256:${'0'.repeat(64)}`;
const CANONICALISATION = 'evidence-unit-json-v1';
const EVIDENCE_FIELDS = Object.freeze(['evidenceHistory', 'evidencePins', 'decisions', 'actions'] as const);

const COMPATIBILITY_SOURCE_PATHS = Object.freeze([
  'packages/contracts/case-portability.mts',
  'packages/cases/case-migration-model.mts',
  'packages/cases/case-record-core.mts',
  'packages/cases/case-evidence-model.mts',
  'packages/cases/case-response-model.mts',
  'packages/cases/case-investigation-branch-model.mts',
  'packages/cases/case-response-packet.mts',
  'packages/workspace/workspace-archive.mts',
  'packages/workspace/workspace-archive-crypto.mts',
  'cli/case-pack.mts',
  'cli/offline-artifact-validation.mts',
  'cli/artifact-validation/case-response.mts',
  'cli/artifact-validation/structure-primitives.mts',
  'cli/archive-inspect.mts',
  'tools/case-contract-doc.mts',
] as const);

const HISTORICAL_BRANCH_MARKER = /(?:sourceVersion|importedVersion|LEGACY_|PREVIOUS_|SUPPORTED_(?:CASE|CLI|WORKSPACE)|CASE_IMPORT_VERSIONS|CASE_BROWSER_SUPPORTED_VERSIONS|CASE_REPORT_OUTPUT_VERSIONS|CASE_RESPONSE_PACKET_OUTPUT_VERSIONS|root\.version|schemaVersion\s*[<>=]|WORKSPACE_ARCHIVE_VERSION)/u;

const STARTING_COMPATIBILITY_FOOTPRINT = Object.freeze({
  revision: EVIDENCE_STORAGE_STARTING_REVISION,
  compatibilityDescriptors: 9,
  supportedVersionSlots: 54,
  lifecycleContracts: 53,
  legacyContracts: 32,
  retiredOutputContracts: 12,
  migrations: 29,
  readerEdges: 10,
  writerEdges: 9,
  readerVersionSlots: 61,
  lifecycleFixtures: 87,
  lifecycleFixtureBytes: 579_486,
  legacyAndRetiredFixtures: 45,
  legacyAndRetiredFixtureBytes: 302_908,
  lifecycleShapes: 19,
  lifecycleBoundProfiles: 7,
  lifecycleHooks: 18,
  lifecycleSerialisationProfiles: 7,
  lifecyclePrivacyProfiles: 3,
  lifecycleConsumerEdges: 16,
  versionSensitiveProductionLines: 365,
  versionSensitiveBranches: 79,
  generatedInventoryEntries: 9,
  generatedDocumentationEntries: 17,
  focusedVerification: Object.freeze({
    testFiles: 13,
    tests: 276,
    passed: 276,
    failed: 0,
    skipped: 0,
    durationMs: 35_068.222209,
    elapsedSeconds: 35.24,
    reliability: 'single_local_observation_not_drift_gated',
  }),
});

type UnknownRecord = Record<string, unknown>;
type ScenarioFixture = Readonly<{
  id: string;
  caseCount: number;
  evidenceSnapshotsPerCase: number;
  evidenceDuplicateSpan: number;
  responseDuplicateSpan: number;
  classification: 'representative_low' | 'representative_mixed' | 'synthetic_worst_case';
}>;

type MeasurementFixture = Readonly<{
  schema: string;
  version: number;
  startingRevision: string;
  generatedAt: string;
  scenarios: readonly ScenarioFixture[];
  startingCurrentFixtures: readonly string[];
  decisionThreshold: Readonly<{
    minimumRepresentativeNetSavingsBytes: number;
    minimumRepresentativeNetSavingsRatio: number;
    minimumQuotaPressureRatio: number;
  }>;
}>;

type EvidenceUnit = Readonly<{
  kind: 'evidence_history' | 'evidence_pin' | 'decision_history' | 'response_action_event';
  value: unknown;
}>;

type WritableLike = { write(value: string): unknown };

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function bytes(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function jsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new TypeError('Measurement values must be JSON serialisable.');
  return bytes(serialized);
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new TypeError(`${label} must be a canonical UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${label} must be a valid canonical UTC timestamp.`);
  }
  return value;
}

function exactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new TypeError(`${label} must use only its documented fields.`);
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return Number(value);
}

function boundedRatio(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new TypeError(`${label} must be greater than zero and no greater than one.`);
  }
  return value;
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(value)) {
    throw new TypeError(`${label} must be a bounded lowercase identifier.`);
  }
  return value;
}

function safeRepositoryPath(value: unknown, label: string): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((part) => !part || part === '.' || part === '..')
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be a bounded repository-relative path.`);
  }
  return value;
}

export function validateEvidenceStorageMeasurementFixture(value: unknown): MeasurementFixture {
  assertBoundedJsonStructure(value, 'Evidence-storage measurement fixture', {
    maximumDepth: 8,
    maximumKeys: 256,
    maximumValues: 512,
    maximumContainerItems: 32,
  });
  const source = record(value);
  if (!source) throw new TypeError('Evidence-storage measurement fixture must be an ordinary record.');
  exactKeys(source, [
    'schema', 'version', 'startingRevision', 'generatedAt', 'scenarios',
    'startingCurrentFixtures', 'decisionThreshold',
  ], 'Evidence-storage measurement fixture');
  if (source.schema !== EVIDENCE_STORAGE_MEASUREMENT_FIXTURE_SCHEMA || source.version !== 1) {
    throw new TypeError('Evidence-storage measurement fixture uses an unsupported contract.');
  }
  if (source.startingRevision !== EVIDENCE_STORAGE_STARTING_REVISION) {
    throw new TypeError('Evidence-storage measurement fixture is not bound to the reviewed starting revision.');
  }
  if (!Array.isArray(source.scenarios) || source.scenarios.length < 2 || source.scenarios.length > MAX_MEASUREMENT_SCENARIOS) {
    throw new TypeError('Evidence-storage measurement fixture must declare a bounded scenario set.');
  }
  const scenarioIds = new Set<string>();
  const scenarios = source.scenarios.map((item, index) => {
    const scenario = record(item);
    if (!scenario) throw new TypeError(`Measurement scenario ${index + 1} must be an ordinary record.`);
    exactKeys(scenario, [
      'id', 'caseCount', 'evidenceSnapshotsPerCase', 'evidenceDuplicateSpan',
      'responseDuplicateSpan', 'classification',
    ], `Measurement scenario ${index + 1}`);
    const id = boundedId(scenario.id, `Measurement scenario ${index + 1} id`);
    if (scenarioIds.has(id)) throw new TypeError(`Measurement scenario id is duplicated: ${id}.`);
    scenarioIds.add(id);
    const caseCount = boundedInteger(scenario.caseCount, 1, MAX_MEASUREMENT_CASES, `${id} case count`);
    const evidenceDuplicateSpan = boundedInteger(scenario.evidenceDuplicateSpan, 1, caseCount, `${id} evidence duplicate span`);
    const responseDuplicateSpan = boundedInteger(scenario.responseDuplicateSpan, 1, caseCount, `${id} response duplicate span`);
    if (caseCount % evidenceDuplicateSpan !== 0 || caseCount % responseDuplicateSpan !== 0) {
      throw new TypeError(`${id} duplicate spans must divide its case count exactly.`);
    }
    if (!['representative_low', 'representative_mixed', 'synthetic_worst_case'].includes(String(scenario.classification))) {
      throw new TypeError(`${id} has an unsupported classification.`);
    }
    return Object.freeze({
      id,
      caseCount,
      evidenceSnapshotsPerCase: boundedInteger(scenario.evidenceSnapshotsPerCase, 1, 4, `${id} snapshot count`),
      evidenceDuplicateSpan,
      responseDuplicateSpan,
      classification: scenario.classification as ScenarioFixture['classification'],
    });
  });
  if (!scenarios.some((item) => item.classification === 'representative_low')
    || !scenarios.some((item) => item.classification === 'representative_mixed')
    || !scenarios.some((item) => item.classification === 'synthetic_worst_case')) {
    throw new TypeError('Measurement scenarios must cover low, mixed, and worst-case duplication.');
  }
  if (!Array.isArray(source.startingCurrentFixtures)
    || source.startingCurrentFixtures.length < 1
    || source.startingCurrentFixtures.length > 32) {
    throw new TypeError('Measurement fixture identities must be a bounded array.');
  }
  const startingCurrentFixtures = source.startingCurrentFixtures.map((item, index) => safeRepositoryPath(item, `Starting fixture ${index + 1}`));
  if (new Set(startingCurrentFixtures).size !== startingCurrentFixtures.length) {
    throw new TypeError('Measurement fixture identities must be unique.');
  }
  const threshold = record(source.decisionThreshold);
  if (!threshold) throw new TypeError('Measurement decision threshold must be an ordinary record.');
  exactKeys(threshold, [
    'minimumRepresentativeNetSavingsBytes',
    'minimumRepresentativeNetSavingsRatio',
    'minimumQuotaPressureRatio',
  ], 'Measurement decision threshold');
  return Object.freeze({
    schema: source.schema,
    version: source.version,
    startingRevision: source.startingRevision,
    generatedAt: timestamp(source.generatedAt, 'Measurement generation time'),
    scenarios: Object.freeze(scenarios),
    startingCurrentFixtures: Object.freeze(startingCurrentFixtures),
    decisionThreshold: Object.freeze({
      minimumRepresentativeNetSavingsBytes: boundedInteger(
        threshold.minimumRepresentativeNetSavingsBytes,
        1,
        MAX_CASE_STORE_BYTES,
        'Minimum representative net savings',
      ),
      minimumRepresentativeNetSavingsRatio: boundedRatio(
        threshold.minimumRepresentativeNetSavingsRatio,
        'Minimum representative savings ratio',
      ),
      minimumQuotaPressureRatio: boundedRatio(
        threshold.minimumQuotaPressureRatio,
        'Minimum quota pressure ratio',
      ),
    }),
  });
}

export function loadEvidenceStorageMeasurementFixture(): MeasurementFixture {
  const fixturePath = path.join(REPOSITORY_ROOT, EVIDENCE_STORAGE_MEASUREMENT_FIXTURE_PATH);
  const raw = readFileSync(fixturePath);
  if (raw.byteLength > MAX_MEASUREMENT_FIXTURE_BYTES) {
    throw new TypeError('Evidence-storage measurement fixture exceeds its byte bound.');
  }
  return validateEvidenceStorageMeasurementFixture(parseBoundedJson(raw.toString('utf8'), {
    label: 'Evidence-storage measurement fixture',
    maximumBytes: MAX_MEASUREMENT_FIXTURE_BYTES,
    limits: {
      maximumDepth: 8,
      maximumKeys: 256,
      maximumValues: 512,
      maximumContainerItems: 32,
    },
  }));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical measurement input contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const source = record(value);
  if (!source) throw new TypeError('Canonical measurement input contains an unsupported value.');
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`;
}

function isoOffset(base: string, offsetSeconds: number): string {
  return new Date(Date.parse(base) + offsetSeconds * 1_000).toISOString();
}

function scenarioCase(
  fixture: MeasurementFixture,
  scenario: ScenarioFixture,
  caseIndex: number,
): UnknownRecord {
  const evidenceGroup = Math.floor(caseIndex / scenario.evidenceDuplicateSpan);
  const responseGroup = Math.floor(caseIndex / scenario.responseDuplicateSpan);
  const evidenceHistory = Array.from({ length: scenario.evidenceSnapshotsPerCase }, (_, snapshotIndex) => {
    const observedAt = isoOffset(fixture.generatedAt, evidenceGroup * 60 + snapshotIndex);
    return {
      id: `evidence-${evidenceGroup}-${snapshotIndex}`,
      fingerprint: `fixture-${evidenceGroup}-${snapshotIndex}`,
      firstCapturedAt: observedAt,
      capturedAt: observedAt,
      source: 'bulk',
      inputHostname: null,
      scanDepth: 'deep',
      availability: 'registered',
      confidence: 'high',
      riskModelVersion: 7,
      riskScore: 40 + snapshotIndex,
      opportunityModelVersion: 2,
      opportunityScore: 20,
      riskFactors: [{ label: `Reviewed factor ${snapshotIndex + 1}`, points: 10 }],
      opportunityFactors: [],
      registrar: `Reserved registrar ${evidenceGroup % 3}`,
      createdDate: '2025-08-22T00:00:00.000Z',
      expiryDate: '2027-08-22T00:00:00.000Z',
      nameservers: [`ns${evidenceGroup % 4 + 1}.example`],
      hasMx: true,
      hasSpf: true,
      hasDmarc: false,
      activityStatus: 'active',
      websiteProbeDetail: 'A bounded synthetic response was retained.',
      pageTitle: 'Reserved analyst fixture',
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'complete',
      httpFinalOrigin: 'https://fixture.example',
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 0,
      httpCrossOriginRedirect: false,
      httpHttpsDowngrade: false,
      httpContentType: 'text/html',
      httpSecurityHeaders: ['content-security-policy'],
      faviconMatch: false,
      faviconNearMatch: false,
      reusesOfficialAssets: false,
      hasPasswordField: false,
      hasExternalFormAction: false,
      phishingLanguageMatch: null,
      privacyProtected: null,
      idnReferenceMatch: false,
      pageBaselineMatch: false,
      hasActiveBrandProfile: false,
      profileContextState: 'unavailable',
      profileContextLimitation: 'No analyst-selected profile was available.',
      mutationTypes: [],
    };
  });
  const responseTime = isoOffset(fixture.generatedAt, responseGroup * 60 + 30);
  const pinId = `pin-${responseGroup}`;
  const actionId = `action-${responseGroup}`;
  return {
    id: `case-${String(caseIndex).padStart(3, '0')}`,
    domain: `case-${String(caseIndex).padStart(3, '0')}.example`,
    status: 'reviewing',
    disposition: 'suspicious',
    reviewReasonCode: null,
    brandProfileIds: [],
    tags: ['measurement'],
    notes: [],
    source: 'bulk',
    evidenceHistory,
    evidencePins: [{
      id: pinId,
      checkpointId: `checkpoint-${responseGroup}`,
      field: 'availability',
      category: 'registration',
      label: 'Registration state',
      value: 'Observed as registered',
      source: 'bounded synthetic journey',
      sourceState: 'complete',
      sourceSchema: { collection: 'lookup', schema: LOOKUP_EVIDENCE_SCHEMA, version: LOOKUP_EVIDENCE_SCHEMA_VERSION },
      certificateObservation: null,
      observedAt: responseTime,
      collectionDepth: 'deep',
      completeness: 'complete',
      truncated: false,
      transitionExpectation: 'review',
      limitations: ['The retained observation does not establish ownership or safety.'],
      createdAt: responseTime,
    }],
    decisions: [{
      id: `decision-${responseGroup}`,
      summary: 'Retain for analyst review',
      rationale: 'The bounded evidence remains material and requires an explicit decision.',
      evidencePinIds: [pinId],
      createdAt: responseTime,
    }],
    actions: [{
      id: actionId,
      type: 'internal_review',
      recipient: 'Reviewed internal queue',
      contactSource: 'Analyst-selected workflow',
      routeObservedAt: null,
      contactLimitations: ['No external submission was performed.'],
      dueAt: null,
      state: 'drafting',
      reference: null,
      followUpAt: null,
      providerOutcome: null,
      outcome: null,
      originActionId: null,
      history: [{
        id: `action-event-${responseGroup}`,
        previousState: null,
        nextState: 'drafting',
        occurredAt: responseTime,
        sourceClass: 'analyst',
        provenance: 'synthetic_analyst_journey',
        reference: null,
        evidencePinId: pinId,
        limitations: ['No provider action was observed.'],
        providerOutcome: null,
        outcomeDetail: null,
        originActionId: null,
        applied: true,
      }],
      historyOmitted: 0,
      historyLimitations: [],
      createdAt: responseTime,
      metadataUpdatedAt: responseTime,
      updatedAt: responseTime,
    }],
    assertions: [],
    manualTrail: [],
    sightings: [],
    observedEffects: {
      reviews: [],
      omitted: 0,
      preV13HistoryUnavailable: false,
      limitations: ['Observed-effect reviews remain independent from provider workflow events.'],
    },
    closures: {
      records: [],
      omitted: 0,
      preV13HistoryUnavailable: false,
      limitations: ['No closure was inferred from the retained evidence.'],
    },
    branches: [],
    createdAt: fixture.generatedAt,
    updatedAt: responseTime,
  };
}

export function buildSyntheticEvidenceStorageCases(
  fixture: MeasurementFixture,
  scenario: ScenarioFixture,
): CaseRecord[] {
  const raw = {
    version: CASE_SCHEMA_VERSION,
    cases: Array.from({ length: scenario.caseCount }, (_, index) => scenarioCase(fixture, scenario, index)),
  };
  const normalized = normalizeCaseStore(raw).cases;
  if (normalized.length !== scenario.caseCount) {
    throw new Error(`${scenario.id} did not retain its complete bounded Case corpus.`);
  }
  return normalized;
}

function withoutMeasuredEvidence(cases: readonly CaseRecord[]): CaseRecord[] {
  return cases.map((item) => ({
    ...structuredClone(item),
    evidenceHistory: [],
    evidencePins: [],
    decisions: [],
    actions: [],
  }));
}

function fieldBytes(cases: readonly CaseRecord[], field: typeof EVIDENCE_FIELDS[number]): number {
  return cases.reduce((total, item) => total + jsonBytes(item[field]), 0);
}

function evidenceUnits(cases: readonly CaseRecord[]): EvidenceUnit[] {
  const units: EvidenceUnit[] = [];
  for (const item of cases) {
    for (const value of item.evidenceHistory) units.push({ kind: 'evidence_history', value });
    for (const value of item.evidencePins) units.push({ kind: 'evidence_pin', value });
    for (const value of item.decisions) units.push({ kind: 'decision_history', value });
    for (const action of item.actions) {
      for (const value of action.history) units.push({ kind: 'response_action_event', value });
    }
  }
  return units;
}

function browserProviderBytes(cases: readonly CaseRecord[], generatedAt: string) {
  const records = cases.map((item, ordinal) => {
    const payload = JSON.stringify({ id: item.id, value: item });
    return {
      key: ['cases', item.id],
      collection: 'cases',
      lookupKey: item.id,
      ordinal,
      codec: 'json-v1',
      payload,
      payloadBytes: bytes(payload),
    };
  });
  const canonical = JSON.stringify(records.map((item) => [
    item.lookupKey, item.ordinal, item.codec, item.payload, item.payloadBytes,
  ]));
  const digest = createHash('sha256').update(canonical).digest('base64url');
  const manifest = {
    collection: 'cases',
    schemaVersion: CASE_SCHEMA_VERSION,
    codec: 'json-v1',
    revision: 1,
    recordCount: records.length,
    serializedBytes: bytes(serializeCaseStore([...cases])),
    digest,
    source: 'application',
    updatedAt: generatedAt,
    legacyKey: 'whoisleuth-cases-v1',
    legacyDigest: null,
  };
  const payloadBytes = records.reduce((total, item) => total + item.payloadBytes, 0);
  const recordEnvelopeBytes = records.reduce((total, item) => total + jsonBytes(item), 0);
  const manifestBytes = jsonBytes(manifest);
  return Object.freeze({ payloadBytes, recordEnvelopeBytes, manifestBytes, contractBytes: recordEnvelopeBytes + manifestBytes });
}

function duplicateAndOverheadMeasurement(units: readonly EvidenceUnit[]) {
  const exact = new Map<string, EvidenceUnit[]>();
  const canonical = new Map<string, EvidenceUnit[]>();
  for (const unit of units) {
    const exactKey = `${unit.kind}\u0000${JSON.stringify(unit.value)}`;
    const canonicalKey = `${unit.kind}\u0000${canonicalJson(unit.value)}`;
    exact.set(exactKey, [...(exact.get(exactKey) ?? []), unit]);
    canonical.set(canonicalKey, [...(canonical.get(canonicalKey) ?? []), unit]);
  }
  const exactGroups = [...exact.entries()].filter(([, values]) => values.length > 1).map(([key, values]) => {
    const serialized = key.slice(key.indexOf('\u0000') + 1);
    return Object.freeze({
      kind: values[0]!.kind,
      payloadDigest: sha256(serialized),
      occurrences: values.length,
      payloadBytes: bytes(serialized),
      grossDuplicateBytes: bytes(serialized) * (values.length - 1),
    });
  }).sort((left, right) => left.kind.localeCompare(right.kind) || left.payloadDigest.localeCompare(right.payloadDigest));
  const canonicalGroups = [...canonical.entries()].filter(([, values]) => values.length > 1).map(([key, values]) => {
    const serialized = key.slice(key.indexOf('\u0000') + 1);
    const exactForms = new Set(values.map((item) => JSON.stringify(item.value))).size;
    return Object.freeze({
      kind: values[0]!.kind,
      payloadDigest: sha256(serialized),
      occurrences: values.length,
      exactForms,
      payloadBytes: bytes(serialized),
      grossDuplicateBytes: bytes(serialized) * (values.length - 1),
    });
  }).sort((left, right) => left.kind.localeCompare(right.kind) || left.payloadDigest.localeCompare(right.payloadDigest));

  let artifactBytes = 0;
  let referenceBytes = 0;
  let indexBytes = 0;
  let orphanMetadataBytes = 0;
  let collisionMetadataBytes = 0;
  let repairPreviewMetadataBytes = 0;
  for (const [key, values] of canonical) {
    const canonicalPayload = key.slice(key.indexOf('\u0000') + 1);
    const digest = sha256(canonicalPayload);
    const kind = values[0]!.kind;
    artifactBytes += jsonBytes({ version: 1, digest, kind, canonicalisation: CANONICALISATION, payload: JSON.parse(canonicalPayload) });
    referenceBytes += values.length * jsonBytes({ version: 1, digest, kind });
    indexBytes += jsonBytes({ version: 1, digest, kind, referenceCount: values.length, canonicalBytes: bytes(canonicalPayload), state: 'verified' });
    orphanMetadataBytes += jsonBytes({ digest, state: 'referenced', referenceCount: values.length });
    collisionMetadataBytes += jsonBytes({ digest, canonicalBytes: bytes(canonicalPayload), comparison: 'required' });
    repairPreviewMetadataBytes += jsonBytes({ digest, state: 'present', boundedReferenceCount: values.length });
  }
  const manifestBytes = jsonBytes({
    version: 1,
    algorithm: 'SHA-256',
    canonicalisation: CANONICALISATION,
    artifactCount: canonical.size,
    referenceCount: units.length,
    digest: FIXED_DIGEST,
  });
  const currentEligibleBytes = units.reduce((total, item) => total + jsonBytes(item.value), 0);
  const operationalMetadataBytes = orphanMetadataBytes + collisionMetadataBytes + repairPreviewMetadataBytes;
  const candidateBytesBeforeOperationalReserve = artifactBytes + referenceBytes + indexBytes + manifestBytes;
  const candidateBytesAfterAllOverhead = candidateBytesBeforeOperationalReserve + operationalMetadataBytes;
  const netSavingsBytes = currentEligibleBytes - candidateBytesAfterAllOverhead;
  return Object.freeze({
    eligiblePayloads: units.length,
    uniqueCanonicalPayloads: canonical.size,
    exactDuplicatePayloadGroups: exactGroups,
    exactDuplicateGroupCount: exactGroups.length,
    canonicallyEquivalentPayloadGroups: canonicalGroups,
    canonicallyEquivalentGroupCount: canonicalGroups.length,
    canonicalOnlyGroupCount: canonicalGroups.filter((item) => item.exactForms > 1).length,
    grossExactDuplicateBytes: exactGroups.reduce((total, item) => total + item.grossDuplicateBytes, 0),
    grossCanonicalDuplicateBytes: canonicalGroups.reduce((total, item) => total + item.grossDuplicateBytes, 0),
    currentEligibleBytes,
    artifactBytes,
    referenceBytes,
    manifestBytes,
    indexBytes,
    orphanMetadataBytes,
    collisionMetadataBytes,
    repairPreviewMetadataBytes,
    operationalMetadataBytes,
    candidateBytesBeforeOperationalReserve,
    candidateBytesAfterAllOverhead,
    netSavingsBytes,
    deduplicableBytesAfterAllOverhead: Math.max(0, netSavingsBytes),
    architectureDeltaBytes: candidateBytesAfterAllOverhead - currentEligibleBytes,
  });
}

async function portableMeasurements(cases: readonly CaseRecord[], generatedAt: string) {
  const stripped = withoutMeasuredEvidence(cases);
  const archive = await buildWorkspaceArchive({ cases }, { generatedAt });
  const strippedArchive = await buildWorkspaceArchive({ cases: stripped }, { generatedAt });
  const archiveBytes = jsonBytes(archive);
  const archiveWithoutMeasuredEvidenceBytes = jsonBytes(strippedArchive);

  const packCases = [...cases].slice(0, MAX_CASE_PACK_CASES);
  const strippedPackCases = withoutMeasuredEvidence(packCases);
  const pack = buildCliCasePack(JSON.stringify(buildCaseExport(packCases, generatedAt)), {
    audience: 'internal',
    reviewed: true,
  }, generatedAt);
  const strippedPack = buildCliCasePack(JSON.stringify(buildCaseExport(strippedPackCases, generatedAt)), {
    audience: 'internal',
    reviewed: true,
  }, generatedAt);
  const casePackBytes = jsonBytes(pack);
  const casePackWithoutMeasuredEvidenceBytes = jsonBytes(strippedPack);
  return Object.freeze({
    workspaceArchive: Object.freeze({
      caseCount: cases.length,
      totalBytes: archiveBytes,
      retainedEvidenceBytes: archiveBytes - archiveWithoutMeasuredEvidenceBytes,
    }),
    cliCasePack: Object.freeze({
      caseCount: packCases.length,
      totalBytes: casePackBytes,
      retainedEvidenceBytes: casePackBytes - casePackWithoutMeasuredEvidenceBytes,
      caseLimitApplied: cases.length > packCases.length,
    }),
  });
}

function compatibilitySourceFootprint() {
  let branchCount = 0;
  const productionLines = new Set<string>();
  for (const file of COMPATIBILITY_SOURCE_PATHS) {
    const source = readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8');
    const lines = source.split('\n');
    const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if ((ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isSwitchStatement(node))
        && HISTORICAL_BRANCH_MARKER.test(node.getText(syntax))) {
        branchCount += 1;
        const start = syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1;
        const end = syntax.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        for (let line = start; line <= end; line += 1) {
          const value = (lines[line - 1] ?? '').trim();
          if (value && !value.startsWith('//') && !value.startsWith('/*') && !value.startsWith('*')) {
            productionLines.add(`${file}:${line}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(syntax);
  }
  return Object.freeze({
    sourceFiles: COMPATIBILITY_SOURCE_PATHS.length,
    versionSensitiveProductionLines: productionLines.size,
    versionSensitiveBranches: branchCount,
    method: 'TypeScript if, conditional, and switch nodes containing explicit historical-version markers; lines are unique nonblank non-comment lines spanned by those nodes.',
  });
}

function currentCompatibilityFootprint() {
  const family = CASE_PORTABILITY_LIFECYCLE_FAMILY;
  const legacyContracts = family.contracts.filter((item) => item.lifecycle === 'legacy');
  const retiredContracts = family.contracts.filter((item) => item.lifecycle === 'retired');
  const historicalFixtureIds = new Set([...legacyContracts, ...retiredContracts].flatMap((item) => item.fixtureIds));
  const historicalFixtures = family.fixtures.filter((item) => historicalFixtureIds.has(item.id));
  const readers = family.metadata.consumerEdges.filter((item) => item.acceptedContracts.length > 0);
  const writers = family.metadata.consumerEdges.filter((item) => item.emittedContract !== null);
  const source = compatibilitySourceFootprint();
  return Object.freeze({
    compatibilityDescriptors: family.compatibility.length,
    supportedVersionSlots: family.compatibility.reduce((total, item) => total + item.supportedVersions.length + (item.acceptsUnversionedLegacy ? 1 : 0), 0),
    lifecycleContracts: family.contracts.length,
    legacyContracts: legacyContracts.length,
    retiredOutputContracts: retiredContracts.length,
    migrations: family.contracts.filter((item) => item.migrationTarget !== null).length,
    readerEdges: readers.length,
    writerEdges: writers.length,
    readerVersionSlots: readers.reduce((total, edge) => total + edge.acceptedContracts.reduce((sum, item) => sum + item.versions.length, 0), 0),
    lifecycleFixtures: family.fixtures.length,
    lifecycleFixtureBytes: family.fixtures.reduce((total, item) => total + item.bytes, 0),
    legacyAndRetiredFixtures: historicalFixtures.length,
    legacyAndRetiredFixtureBytes: historicalFixtures.reduce((total, item) => total + item.bytes, 0),
    lifecycleShapes: family.metadata.shapes.length,
    lifecycleBoundProfiles: family.metadata.boundProfiles.length,
    lifecycleHooks: family.metadata.hooks.length,
    lifecycleSerialisationProfiles: family.metadata.serialisationProfiles.length,
    lifecyclePrivacyProfiles: family.metadata.privacyProfiles.length,
    lifecycleConsumerEdges: family.metadata.consumerEdges.length,
    versionSensitiveProductionLines: source.versionSensitiveProductionLines,
    versionSensitiveBranches: source.versionSensitiveBranches,
    generatedInventoryEntries: family.compatibility.length,
    generatedDocumentationEntries: family.compatibility.length + CLI_CASE_PACK_CASE_REPORT_EPOCHS.length,
    sourceMeasurement: source,
  });
}

function fixtureIdentities(fixture: MeasurementFixture) {
  return fixture.startingCurrentFixtures.map((file) => {
    const content = readFileSync(path.join(REPOSITORY_ROOT, file));
    return Object.freeze({ file, bytes: content.byteLength, sha256: sha256(content) });
  });
}

async function measureScenario(fixture: MeasurementFixture, scenario: ScenarioFixture) {
  const cases = buildSyntheticEvidenceStorageCases(fixture, scenario);
  const stripped = withoutMeasuredEvidence(cases);
  const serialized = serializeCaseStore(cases);
  const strippedSerialized = serializeCaseStore(stripped);
  const browser = browserProviderBytes(cases, fixture.generatedAt);
  const duplicate = duplicateAndOverheadMeasurement(evidenceUnits(cases));
  const projectedCaseBytes = bytes(serialized) + duplicate.architectureDeltaBytes;
  const portable = await portableMeasurements(cases, fixture.generatedAt);
  return Object.freeze({
    id: scenario.id,
    classification: scenario.classification,
    caseCount: cases.length,
    evidenceSnapshots: cases.reduce((total, item) => total + item.evidenceHistory.length, 0),
    evidencePins: cases.reduce((total, item) => total + item.evidencePins.length, 0),
    decisions: cases.reduce((total, item) => total + item.decisions.length, 0),
    responseActions: cases.reduce((total, item) => total + item.actions.length, 0),
    responseActionEvents: cases.reduce((total, item) => total + item.actions.reduce((sum, action) => sum + action.history.length, 0), 0),
    browserLocal: Object.freeze({
      serializedCaseBytes: bytes(serialized),
      retainedEvidenceBytes: bytes(serialized) - bytes(strippedSerialized),
      evidenceHistoryBytes: fieldBytes(cases, 'evidenceHistory'),
      evidencePinBytes: fieldBytes(cases, 'evidencePins'),
      decisionHistoryBytes: fieldBytes(cases, 'decisions'),
      responseActionHistoryBytes: fieldBytes(cases, 'actions'),
      indexedDbRecordPayloadBytes: browser.payloadBytes,
      indexedDbRecordEnvelopeBytes: browser.recordEnvelopeBytes,
      indexedDbManifestBytes: browser.manifestBytes,
      indexedDbSerializedContractBytes: browser.contractBytes,
      currentQuotaRatio: Number((bytes(serialized) / MAX_CASE_STORE_BYTES).toFixed(6)),
      projectedContentAddressedBytes: projectedCaseBytes,
      projectedQuotaRatio: Number((projectedCaseBytes / MAX_CASE_STORE_BYTES).toFixed(6)),
    }),
    duplication: duplicate,
    portable,
  });
}

export async function buildEvidenceStorageMeasurementProfile(
  fixture = loadEvidenceStorageMeasurementFixture(),
) {
  const scenarios = [];
  for (const scenario of fixture.scenarios) scenarios.push(await measureScenario(fixture, scenario));
  const representative = scenarios.find((item) => item.classification === 'representative_mixed');
  if (!representative) throw new Error('Representative duplication scenario is unavailable.');
  const netSavings = representative.duplication.deduplicableBytesAfterAllOverhead;
  const netSavingsRatio = representative.browserLocal.serializedCaseBytes > 0
    ? netSavings / representative.browserLocal.serializedCaseBytes
    : 0;
  const threshold = fixture.decisionThreshold;
  const material = netSavings >= threshold.minimumRepresentativeNetSavingsBytes
    && netSavingsRatio >= threshold.minimumRepresentativeNetSavingsRatio;
  return Object.freeze({
    schema: EVIDENCE_STORAGE_MEASUREMENT_SCHEMA,
    version: EVIDENCE_STORAGE_MEASUREMENT_VERSION,
    generatedAt: fixture.generatedAt,
    startingRevision: fixture.startingRevision,
    fixtureIdentity: Object.freeze({
      corpus: EVIDENCE_STORAGE_MEASUREMENT_FIXTURE_PATH,
      corpusSha256: sha256(readFileSync(path.join(REPOSITORY_ROOT, EVIDENCE_STORAGE_MEASUREMENT_FIXTURE_PATH))),
      startingCurrentFixtures: Object.freeze(fixtureIdentities(fixture)),
    }),
    boundaries: Object.freeze({
      networkRequests: 0,
      browserRecordsRead: 0,
      userDataRead: false,
      productionStorageChanged: false,
      liveTargets: false,
      eligibleFields: EVIDENCE_FIELDS,
      browserDatabase: 'whoisleuth-browser-data-v1',
      browserDatabaseVersion: 1,
      browserObjectStores: Object.freeze(['records', 'manifests']),
      browserCodec: 'json-v1',
      browserCollectionCount: 12,
    }),
    scenarios: Object.freeze(scenarios),
    decision: Object.freeze({
      outcome: material ? 'build' : 'no_build',
      representativeScenario: representative.id,
      representativeNetSavingsBytes: netSavings,
      representativeNetSavingsRatio: Number(netSavingsRatio.toFixed(6)),
      threshold,
      rationale: material
        ? 'Representative repeated immutable evidence exceeds both the absolute and proportional post-overhead thresholds.'
        : 'Representative repeated immutable evidence does not recover the digest, reference, manifest, index, collision, orphan, and repair overhead required by a second persistence layer.',
      reconsiderWhen: Object.freeze({
        evidence: 'A refreshed representative corpus, not only a synthetic worst case, must meet both savings thresholds.',
        minimumNetSavingsBytes: threshold.minimumRepresentativeNetSavingsBytes,
        minimumNetSavingsRatio: threshold.minimumRepresentativeNetSavingsRatio,
        quotaPressureRatio: threshold.minimumQuotaPressureRatio,
      }),
    }),
    historicalCompatibility: Object.freeze({
      starting: STARTING_COMPATIBILITY_FOOTPRINT,
      postConsolidation: currentCompatibilityFootprint(),
    }),
    limitations: Object.freeze([
      'The corpus contains reserved synthetic journeys and frozen current-format fixtures; it does not inspect browser profiles or investigation data.',
      'IndexedDB contract bytes are deterministic JSON projections of stored records and manifests, not an estimate of browser-engine page, key, or B-tree overhead.',
      'Quota ratios compare the current and proposed logical Case representations with the 4 MiB application Case ceiling; they are not browser-origin quota estimates.',
      'Portable evidence bytes are measured by rebuilding the same current archive or Case-pack with only evidence history, pins, decisions, and response actions removed.',
      'The high-duplication boundary is deliberately synthetic and cannot by itself justify a second persistence abstraction.',
      'Digest identity would establish only byte identity under the declared canonicalisation, not source truth, authority, ownership, or safety.',
      'The focused verification duration is one local observation and is retained for maintenance context, not as a deterministic drift threshold.',
    ]),
  });
}

export function formatEvidenceStorageMeasurementProfile(
  report: Awaited<ReturnType<typeof buildEvidenceStorageMeasurementProfile>>,
): string {
  const lines = [
    'WHOISleuth evidence storage measurement',
    `Starting revision: ${report.startingRevision}`,
    `Decision: ${report.decision.outcome}`,
  ];
  for (const scenario of report.scenarios) {
    lines.push(
      `${scenario.id}: ${scenario.browserLocal.serializedCaseBytes} browser Case bytes; ${scenario.duplication.exactDuplicateGroupCount} exact duplicate groups; ${scenario.duplication.deduplicableBytesAfterAllOverhead} deduplicable bytes after overhead`,
    );
  }
  lines.push('Use --json for the complete bounded profile.');
  return lines.join('\n');
}

export async function checkEvidenceStorageMeasurementProfile(
  expectedPath = EVIDENCE_STORAGE_MEASUREMENT_PROFILE_PATH,
): Promise<void> {
  const actual = await buildEvidenceStorageMeasurementProfile();
  const expected = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, expectedPath), 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Evidence-storage measurement profile drifted; regenerate and review the measured decision before changing storage or compatibility contracts.');
  }
}

function parseArguments(args: readonly string[]): 'text' | 'json' | 'check' | 'write' {
  if (args.length === 0) return 'text';
  if (args.length === 1 && args[0] === '--json') return 'json';
  if (args.length === 1 && args[0] === '--check') return 'check';
  if (args.length === 1 && args[0] === '--write') return 'write';
  throw new Error('Usage: node tools/evidence-storage-measurement.mts [--json|--check|--write]');
}

export async function main(
  args = process.argv.slice(2),
  output: Readonly<{ stdout?: WritableLike; stderr?: WritableLike }> = {},
): Promise<number> {
  const stdout = output.stdout ?? process.stdout;
  const stderr = output.stderr ?? process.stderr;
  try {
    const mode = parseArguments(args);
    if (mode === 'check') {
      await checkEvidenceStorageMeasurementProfile();
      stdout.write('Evidence-storage measurement profile is current.\n');
      return 0;
    }
    const report = await buildEvidenceStorageMeasurementProfile();
    if (mode === 'write') {
      writeFileSync(
        path.join(REPOSITORY_ROOT, EVIDENCE_STORAGE_MEASUREMENT_PROFILE_PATH),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
      stdout.write(`Updated ${EVIDENCE_STORAGE_MEASUREMENT_PROFILE_PATH}.\n`);
      return 0;
    }
    stdout.write(`${mode === 'json' ? JSON.stringify(report, null, 2) : formatEvidenceStorageMeasurementProfile(report)}\n`);
    return 0;
  } catch (cause) {
    stderr.write(`${cause instanceof Error ? cause.message : 'Evidence-storage measurement failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();
