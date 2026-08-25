import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import {
  canonicalArtifactJson,
  canonicalArtifactJsonV2,
  SORTED_JSON_V2,
} from '../packages/evidence/artifact-integrity.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { WHOISLEUTH_APPLICATION_VERSION } from '../lib/application-version.mts';
import { assertBoundedJsonStructure, scanBoundedJson } from '../lib/bounded-json.mts';
import {
  assertCaseBrandProfileIds,
  normalizeDomain,
  normalizeCaseStore,
  safeId,
  type CaseRecord,
} from '../packages/cases/case-model.mts';
import {
  CASE_REPORT_SCHEMA,
  CASE_IMPORT_VERSIONS,
  CASE_SCHEMA_VERSION,
  CLI_CASE_PACK_SCHEMA,
  CLI_CASE_PACK_VERSION,
  CLI_CASE_PACK_CURRENT_REDACTION_KEYS,
  CLI_CASE_PACK_PUBLIC_REPORT_KEYS,
  CLI_CASE_PACK_INTEGRITY_KEYS as INTEGRITY_KEYS,
  CLI_CASE_PACK_LIMITATIONS as PACKET_LIMITATIONS,
  CLI_CASE_PACK_PACKET_KEYS as PACKET_KEYS,
  CLI_CASE_PACK_REPORT_KEYS as REPORT_KEYS,
  CLI_CASE_PACK_ROOT_KEYS as ROOT_KEYS,
  MAX_CASE_IMPORT_BYTES,
  MAX_CASE_PACK_CASES,
  MAX_CASE_PACK_INPUT_BYTES,
  PUBLIC_CASE_SCHEMA_VERSION,
  caseReportVersionMatchesCase,
} from '../packages/contracts/case-portability.mts';
import { CliUsageError } from './errors.mts';

export {
  CLI_CASE_PACK_SCHEMA,
  CLI_CASE_PACK_VERSION,
  MAX_CASE_PACK_CASES,
  MAX_CASE_PACK_INPUT_BYTES,
};
export type CasePackAudience = 'internal' | 'public' | 'trusted';

const MAX_CASE_PACK_REFERENCE_SCAN_DEPTH = 64;
const INTERNAL_EXCLUSIONS = Object.freeze(['Raw upstream payloads and credentials are outside the case schema.']);
const TRUSTED_EXCLUSIONS = Object.freeze(['Case notes', 'Recipient values', 'Manual trail targets', 'Raw upstream payloads and credentials']);
const PUBLIC_EXCLUSIONS = Object.freeze([
  'Case notes',
  'Brand Profile references',
  'Actions and recipient values',
  'Analyst assertions',
  'Investigation branches',
  'Manual trail targets',
  'Raw upstream payloads and credentials',
  'Independent observed-effect reviews and closure history',
]);
const PUBLIC_V12_EXCLUSIONS = Object.freeze(PUBLIC_EXCLUSIONS.slice(0, -1));
const SENSITIVE_CASE_PACK_FIELDS = Object.freeze([
  'brandProfileIds', 'notes', 'actions', 'assertions', 'manualTrail', 'observedEffects',
  'closures', 'branches', 'recipient', 'target',
]);
const PUBLIC_OBSERVED_EFFECT_LIMITATION = 'Independent observed-effect review records were excluded from this public Case pack.';
const PUBLIC_CLOSURE_LIMITATION = 'Deliberate closure records were excluded from this public Case pack.';
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function expectedExclusions(audience: CasePackAudience, caseVersion = CASE_SCHEMA_VERSION): readonly string[] {
  if (audience === 'internal') return INTERNAL_EXCLUSIONS;
  if (audience === 'trusted') return TRUSTED_EXCLUSIONS;
  return caseVersion === PUBLIC_CASE_SCHEMA_VERSION ? PUBLIC_V12_EXCLUSIONS : PUBLIC_EXCLUSIONS;
}

function stringListsMatch(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new TypeError(`The CLI case pack contains an unexpected ${label} field.`);
  }
}

function assertClosedEnvelopes(
  root: Record<string, unknown>,
  packet: Record<string, unknown>,
  integrity: Record<string, unknown>,
  redactionManifest: Record<string, unknown>,
  reports: readonly unknown[],
  caseVersion: number,
): void {
  assertOnlyKeys(root, ROOT_KEYS, 'root envelope');
  assertOnlyKeys(packet, PACKET_KEYS, 'packet envelope');
  assertOnlyKeys(integrity, INTEGRITY_KEYS, 'integrity envelope');
  assertOnlyKeys(
    redactionManifest,
    CLI_CASE_PACK_CURRENT_REDACTION_KEYS,
    'redaction manifest',
  );
  if (!stringListsMatch(packet.limitations, PACKET_LIMITATIONS)) {
    throw new TypeError('The CLI case pack contains an invalid packet limitation manifest.');
  }
  for (const value of reports) {
    const report = record(value);
    if (!report) throw new TypeError('The CLI case pack contains an invalid Case report envelope.');
    assertOnlyKeys(
      report,
      caseVersion === PUBLIC_CASE_SCHEMA_VERSION ? CLI_CASE_PACK_PUBLIC_REPORT_KEYS : REPORT_KEYS,
      'Case report envelope',
    );
  }
}

function topCasePath(path: readonly (number | string)[]): boolean {
  return path.length === 2 && path[0] === 'cases' && typeof path[1] === 'number';
}

function reportCasePath(path: readonly (number | string)[]): boolean {
  return path.length === 4 && path[0] === 'packet' && path[1] === 'reports'
    && typeof path[2] === 'number' && path[3] === 'case';
}

function analystResponsePath(path: readonly (number | string)[]): boolean {
  return path.length === 4 && path[0] === 'packet' && path[1] === 'reports'
    && typeof path[2] === 'number' && path[3] === 'analystResponse';
}

function listItemPath(path: readonly (number | string)[], list: 'actions' | 'manualTrail'): boolean {
  return (path.length === 4 && path[0] === 'cases' && typeof path[1] === 'number' && path[2] === list && typeof path[3] === 'number')
    || (path.length === 6 && path[0] === 'packet' && path[1] === 'reports' && typeof path[2] === 'number'
      && path[3] === 'analystResponse' && path[4] === list && typeof path[5] === 'number');
}

function allowedSensitiveFieldPath(key: string, path: readonly (number | string)[]): boolean {
  if (key === 'brandProfileIds') return topCasePath(path) || reportCasePath(path);
  if (key === 'notes') return topCasePath(path) || reportCasePath(path);
  if (key === 'actions' || key === 'assertions' || key === 'manualTrail' || key === 'observedEffects' || key === 'closures' || key === 'branches') {
    return topCasePath(path) || analystResponsePath(path);
  }
  if (key === 'recipient') return listItemPath(path, 'actions');
  if (key === 'target') return listItemPath(path, 'manualTrail');
  return true;
}

/** Rejects hidden audience-sensitive copies with a budget proven by the serialized byte bound. */
function assertSensitiveFieldPlacement(root: Record<string, unknown>, serializedLength: number): void {
  const stack: Array<{ value: unknown; path: readonly (number | string)[]; depth: number }> = [{ value: root, path: [], depth: 0 }];
  const visited = new Set<object>();
  let inspected = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (!entry || !entry.value || typeof entry.value !== 'object') continue;
    for (const key of SENSITIVE_CASE_PACK_FIELDS) {
      if (Object.hasOwn(entry.value, key) && !allowedSensitiveFieldPath(key, entry.path)) {
        throw new TypeError('The CLI case pack contains audience-sensitive data outside its versioned case or report fields.');
      }
    }
    if (visited.has(entry.value)) continue;
    visited.add(entry.value);
    inspected += 1;
    if (inspected > serializedLength + 1 || entry.depth > MAX_CASE_PACK_REFERENCE_SCAN_DEPTH) {
      throw new TypeError('The CLI case pack exceeds its bounded audience-field scan.');
    }
    if (Array.isArray(entry.value)) {
      for (let index = entry.value.length - 1; index >= 0; index--) {
        inspected += 1;
        if (inspected > serializedLength + 1) throw new TypeError('The CLI case pack exceeds its bounded audience-field scan.');
        stack.push({ value: entry.value[index], path: [...entry.path, index], depth: entry.depth + 1 });
      }
      continue;
    }
    try {
      for (const key in entry.value) {
        if (!Object.hasOwn(entry.value, key)) continue;
        inspected += 1;
        if (inspected > serializedLength + 1) throw new TypeError('The CLI case pack exceeds its bounded audience-field scan.');
        stack.push({ value: (entry.value as Record<string, unknown>)[key], path: [...entry.path, key], depth: entry.depth + 1 });
      }
    } catch (cause) {
      if (cause instanceof TypeError && /bounded audience-field scan/u.test(cause.message)) throw cause;
      throw new TypeError('The CLI case pack could not be inspected safely for audience-sensitive data.');
    }
  }
}

function canonicalValuesMatch(left: unknown, right: unknown): boolean {
  try { return canonicalArtifactJson(left) === canonicalArtifactJson(right); }
  catch { return false; }
}

function assertCanonicalCaseIdentities(cases: readonly unknown[], label: string): void {
  const ids = new Set<string>();
  const domains = new Set<string>();
  for (const value of cases) {
    const item = record(value);
    if (!item
      || typeof item.id !== 'string'
      || safeId(item.id) !== item.id
      || typeof item.domain !== 'string'
      || normalizeDomain(item.domain) !== item.domain
      || ids.has(item.id)
      || domains.has(item.domain)) {
      throw new TypeError(`${label} contains a missing, unsafe, non-canonical, or duplicate Case identity.`);
    }
    ids.add(item.id);
    domains.add(item.domain);
  }
}

function assertCurrentCaseProjection(rawCases: readonly unknown[], normalised: readonly CaseRecord[], label: string): void {
  if (rawCases.length !== normalised.length
    || rawCases.some((item, index) => !canonicalValuesMatch(item, normalised[index]))) {
    throw new TypeError(`${label} contains a schema ${CASE_SCHEMA_VERSION} Case that would be repaired, truncated, or otherwise changed during normalisation.`);
  }
}

function publicObservedEffectHistory(preV13HistoryUnavailable: boolean): CaseRecord['observedEffects'] {
  return {
    reviews: [],
    omitted: 0,
    preV13HistoryUnavailable,
    limitations: [
      ...(preV13HistoryUnavailable
        ? ['Migrated from a pre-v13 Case; earlier independent observed-effect review history is unavailable.']
        : []),
      'Observed-effect reviews are independent point-in-time records; provider workflow events do not create or replace them.',
      PUBLIC_OBSERVED_EFFECT_LIMITATION,
    ].sort(),
  };
}

function publicClosureHistory(preV13HistoryUnavailable: boolean): CaseRecord['closures'] {
  return {
    records: [],
    omitted: 0,
    preV13HistoryUnavailable,
    limitations: [
      ...(preV13HistoryUnavailable
        ? ['Migrated from a pre-v13 Case; earlier deliberate closure history is unavailable.']
        : []),
      'Closure records are deliberate analyst actions and do not establish absence, safety, provider performance, or legal sufficiency.',
      PUBLIC_CLOSURE_LIMITATION,
    ].sort(),
  };
}

function assertAudienceFields(value: Record<string, unknown>, audience: CasePackAudience): void {
  if (audience === 'internal') return;
  if (Object.hasOwn(value, 'notes') && (!Array.isArray(value.notes) || value.notes.length !== 0)) {
    throw new TypeError('The CLI case pack contains Case notes excluded by its audience.');
  }
  if (audience === 'public') {
    for (const field of ['actions', 'assertions', 'branches']) {
      if (Object.hasOwn(value, field) && (!Array.isArray(value[field]) || (value[field] as unknown[]).length !== 0)) {
        throw new TypeError(`The public CLI case pack contains ${field} excluded by its audience.`);
      }
    }
    for (const [field, list] of [['observedEffects', 'reviews'], ['closures', 'records']] as const) {
      if (Object.hasOwn(value, field)) {
        const history = record(value[field]);
        const expected = field === 'observedEffects'
          ? publicObservedEffectHistory(history?.preV13HistoryUnavailable === true)
          : publicClosureHistory(history?.preV13HistoryUnavailable === true);
        if (!history || !Array.isArray(history[list]) || (history[list] as unknown[]).length !== 0
          || !canonicalValuesMatch(history, expected)) {
          throw new TypeError(`The public CLI case pack contains ${field} excluded by its audience.`);
        }
      }
    }
  } else if (Object.hasOwn(value, 'actions')) {
    if (!Array.isArray(value.actions) || value.actions.some((entry) => {
      const action = record(entry);
      return !action || (Object.hasOwn(action, 'recipient') && action.recipient !== '[redacted]');
    })) {
      throw new TypeError('The trusted CLI case pack contains an unredacted action recipient.');
    }
  }
  if (Object.hasOwn(value, 'manualTrail')) {
    if (!Array.isArray(value.manualTrail) || value.manualTrail.some((entry) => {
      const event = record(entry);
      return !event || (Object.hasOwn(event, 'target') && event.target !== null);
    })) {
      throw new TypeError('The CLI case pack contains a manual-trail target excluded by its audience.');
    }
  }
}

function reportApplicationVersion(report: Record<string, unknown>): unknown {
  return record(report.application)?.version;
}

function assertCurrentReportProjection(report: Record<string, unknown>, rawCase: CaseRecord): void {
  if (typeof report.generatedAt !== 'string') {
    throw new TypeError('The CLI case pack contains an invalid or mismatched Case report.');
  }
  const expected = buildCaseReport(rawCase, {
    applicationVersion: reportApplicationVersion(report),
    includeNotes: false,
    generatedAt: report.generatedAt,
  }).json;
  if (!canonicalValuesMatch(report, expected)) {
    throw new TypeError('The CLI case pack contains an invalid or mismatched Case report projection.');
  }
}

function redactedCase(record: CaseRecord, audience: CasePackAudience): CaseRecord {
  if (audience === 'internal') return structuredClone(record);
  return {
    ...structuredClone(record),
    status: audience === 'public' && record.status === 'resolved' && record.closures.records.length
      ? 'reviewing'
      : record.status,
    brandProfileIds: audience === 'public' ? [] : [...record.brandProfileIds],
    notes: [],
    actions: audience === 'public' ? [] : record.actions.map((item) => ({ ...item, recipient: '[redacted]' })),
    manualTrail: record.manualTrail.map((item) => ({ ...item, target: null })),
    assertions: audience === 'public' ? [] : structuredClone(record.assertions),
    observedEffects: audience === 'public'
      ? publicObservedEffectHistory(record.observedEffects.preV13HistoryUnavailable)
      : structuredClone(record.observedEffects),
    closures: audience === 'public'
      ? publicClosureHistory(record.closures.preV13HistoryUnavailable)
      : structuredClone(record.closures),
    branches: audience === 'public' ? [] : structuredClone(record.branches ?? []),
  };
}

export function buildCliCasePack(
  input: string,
  options: Readonly<{ audience: CasePackAudience; reviewed: boolean }>,
  generatedAt = new Date().toISOString(),
) {
  if (!options.reviewed) throw new CliUsageError('case-pack requires --reviewed after the audience-specific output has been checked.');
  if (Buffer.byteLength(input, 'utf8') > MAX_CASE_PACK_INPUT_BYTES) throw new CliUsageError('Case-pack input is limited to 4 MiB.');
  const normalized = input.replace(/^\uFEFF/u, '');
  let parsed: unknown;
  try {
    scanBoundedJson(normalized);
    parsed = JSON.parse(normalized);
  } catch { throw new CliUsageError('Case-pack input must be valid bounded JSON without duplicate keys.'); }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (Number.isSafeInteger(root.version) && (root.version as number) < CASE_SCHEMA_VERSION) {
    throw new CliUsageError(`Case schema ${String(root.version)} is retired. Export it as schema ${CASE_SCHEMA_VERSION} with the last broad-reader release before packaging; no data was changed.`);
  }
  if (Number.isSafeInteger(root.version) && (root.version as number) > CASE_SCHEMA_VERSION) {
    throw new CliUsageError(`Case schema ${String(root.version)} is newer than the supported schema ${CASE_SCHEMA_VERSION}; no data was changed.`);
  }
  if (root.version !== CASE_SCHEMA_VERSION || !Array.isArray(root.cases)) {
    throw new CliUsageError(`Case-pack input must be a well-formed WHOISleuth Case schema ${CASE_SCHEMA_VERSION} export.`);
  }
  try {
    assertCanonicalCaseIdentities(root.cases, 'Case-pack input');
    for (const item of root.cases) {
      const rawCase = record(item);
      if (!rawCase || !Object.hasOwn(rawCase, 'brandProfileIds')) throw new Error('missing');
      assertCaseBrandProfileIds(rawCase.brandProfileIds);
    }
  } catch (cause) {
    if (cause instanceof TypeError && /Case identity/u.test(cause.message)) {
      throw new CliUsageError(cause.message);
    }
    throw new CliUsageError(`Case-pack schema ${CASE_SCHEMA_VERSION} input requires exact canonical Case identities and an exact, unique, bounded brandProfileIds array on every case.`);
  }
  const normalised = normalizeCaseStore(root).cases;
  if (!normalised.length) throw new CliUsageError('Case-pack input did not contain a valid case.');
  if (normalised.length !== root.cases.length) {
    throw new CliUsageError('Case-pack input contains an invalid or duplicate case. Correct the browser export before packaging it.');
  }
  if (normalised.length > MAX_CASE_PACK_CASES) {
    throw new CliUsageError(`Case packs are limited to ${MAX_CASE_PACK_CASES} reviewed cases. Export a smaller selected set so no case is silently omitted.`);
  }
  try { assertCurrentCaseProjection(root.cases, normalised, 'Case-pack input'); }
  catch (cause) { throw new CliUsageError(cause instanceof Error ? cause.message : `Case-pack schema ${CASE_SCHEMA_VERSION} input is not exact.`); }
  const cases = normalised.map((item) => redactedCase(item, options.audience));
  const brandProfileReferencesOmitted = options.audience === 'public'
    ? normalised.reduce((count, item) => count + item.brandProfileIds.length, 0)
    : 0;
  const reports = cases.map((item) => buildCaseReport(item, {
    applicationVersion: WHOISLEUTH_APPLICATION_VERSION,
    includeNotes: false,
    generatedAt,
  }).json);
  const exclusions = expectedExclusions(options.audience);
  const packet = Object.freeze({
    schema: CLI_CASE_PACK_SCHEMA,
    version: CLI_CASE_PACK_VERSION,
    audience: options.audience,
    reviewed: true,
    reports: Object.freeze(reports),
    redactionManifest: Object.freeze({
      excluded: Object.freeze(exclusions),
      sourceCaseCount: normalised.length,
      brandProfileReferencesOmitted,
    }),
    limitations: Object.freeze(PACKET_LIMITATIONS),
  });
  const unsigned = { version: CASE_SCHEMA_VERSION, exportedAt: generatedAt, cases, packet };
  const document = Object.freeze({
    ...unsigned,
    integrity: Object.freeze({
      algorithm: 'SHA-256',
      canonicalization: SORTED_JSON_V2,
      digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex')}`,
    }),
  });
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > MAX_CASE_IMPORT_BYTES) {
    throw new CliUsageError('The generated case pack exceeds the browser 2 MiB import limit. Select fewer cases or a more restrictive audience so no evidence is silently omitted.');
  }
  return document;
}

export function verifyCliCasePack(input: unknown): Readonly<{ caseCount: number }> {
  assertBoundedJsonStructure(input, 'CLI case pack');
  const root = record(input);
  const packet = record(root?.packet);
  const packetVersion = packet?.version;
  if (packet?.schema === CLI_CASE_PACK_SCHEMA && Number.isSafeInteger(packetVersion)) {
    if ((packetVersion as number) < CLI_CASE_PACK_VERSION) {
      throw new TypeError(`CLI case-pack version ${String(packetVersion)} is retired. Export it again as version ${CLI_CASE_PACK_VERSION} before importing; no data was changed.`);
    }
    if ((packetVersion as number) > CLI_CASE_PACK_VERSION) {
      throw new TypeError(`CLI case-pack version ${String(packetVersion)} is newer than the supported version ${CLI_CASE_PACK_VERSION}; no data was changed.`);
    }
  }
  const caseVersion = root?.version;
  if (Number.isSafeInteger(caseVersion)) {
    if ((caseVersion as number) < CASE_SCHEMA_VERSION
      && !CASE_IMPORT_VERSIONS.includes(caseVersion as typeof CASE_IMPORT_VERSIONS[number])) {
      throw new TypeError(`Case schema ${String(caseVersion)} in this CLI case pack is not part of the public compatibility boundary; no data was changed.`);
    }
    if ((caseVersion as number) > CASE_SCHEMA_VERSION) {
      throw new TypeError(`Case schema ${String(caseVersion)} in this CLI case pack is newer than the supported schema ${CASE_SCHEMA_VERSION}; no data was changed.`);
    }
  }

  let serialized: string;
  try { serialized = JSON.stringify(input); }
  catch { throw new TypeError('The CLI case pack structure is not serializable.'); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CASE_IMPORT_BYTES) {
    throw new TypeError('The CLI case pack exceeds the browser import limit.');
  }

  const integrity = record(root?.integrity);
  const redactionManifest = record(packet?.redactionManifest);
  if (!root
    || !packet
    || packet.schema !== CLI_CASE_PACK_SCHEMA
    || packet.version !== CLI_CASE_PACK_VERSION
    || typeof root.version !== 'number'
    || !CASE_IMPORT_VERSIONS.includes(root.version as typeof CASE_IMPORT_VERSIONS[number])
    || packet.reviewed !== true
    || (packet.audience !== 'internal' && packet.audience !== 'public' && packet.audience !== 'trusted')
    || !Array.isArray(packet.reports)
    || !redactionManifest
    || !Array.isArray(root.cases)
    || root.cases.length < 1
    || root.cases.length > MAX_CASE_PACK_CASES
    || packet.reports.length !== root.cases.length
    || typeof root.exportedAt !== 'string'
    || !integrity
    || integrity.algorithm !== 'SHA-256'
    || integrity.canonicalization !== SORTED_JSON_V2
    || typeof integrity.digestSha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(integrity.digestSha256)) {
    throw new TypeError('The CLI case pack structure or integrity envelope is malformed.');
  }

  assertClosedEnvelopes(root, packet, integrity, redactionManifest, packet.reports, root.version as number);
  assertSensitiveFieldPlacement(root, serialized.length);
  const audience = packet.audience as CasePackAudience;
  if (!Number.isSafeInteger(redactionManifest.sourceCaseCount)
    || redactionManifest.sourceCaseCount !== root.cases.length
    || !stringListsMatch(redactionManifest.excluded, expectedExclusions(audience, root.version as number))) {
    throw new TypeError('The CLI case pack has an invalid audience redaction manifest.');
  }

  assertCanonicalCaseIdentities(root.cases, 'The CLI case pack');
  const normalised = normalizeCaseStore(root).cases;
  if (normalised.length !== root.cases.length) {
    throw new TypeError('The CLI case pack contains an invalid case collection.');
  }
  if (root.version === CASE_SCHEMA_VERSION) assertCurrentCaseProjection(root.cases, normalised, 'The CLI case pack');
  const normalisedByDomain = new Map(normalised.map((item) => [item.domain, item]));
  const caseReferenceLists: string[][] = [];
  const reportReferenceLists: string[][] = [];

  for (let index = 0; index < root.cases.length; index += 1) {
    const rawCase = record(root.cases[index]);
    const report = record(packet.reports[index]);
    const reportCase = record(report?.case);
    if (!rawCase
      || !report
      || !reportCase
      || typeof rawCase.domain !== 'string'
      || report.schema !== CASE_REPORT_SCHEMA
      || !caseReportVersionMatchesCase(root.version as number, report.schemaVersion)
      || reportCase.id !== rawCase.id
      || reportCase.domain !== rawCase.domain
      || !normalisedByDomain.has(rawCase.domain)) {
      throw new TypeError('The CLI case pack contains an invalid or mismatched Case report.');
    }
    assertAudienceFields(rawCase, audience);
    try {
      if (!Object.hasOwn(rawCase, 'brandProfileIds') || !Object.hasOwn(reportCase, 'brandProfileIds')) throw new Error('missing');
      caseReferenceLists.push(assertCaseBrandProfileIds(rawCase.brandProfileIds));
      reportReferenceLists.push(assertCaseBrandProfileIds(reportCase.brandProfileIds));
    } catch {
      throw new TypeError('The CLI case pack contains invalid Brand Profile references.');
    }
    if (root.version === CASE_SCHEMA_VERSION) assertCurrentReportProjection(report, rawCase as unknown as CaseRecord);
  }

  const omitted = redactionManifest.brandProfileReferencesOmitted;
  if (!Object.hasOwn(redactionManifest, 'brandProfileReferencesOmitted')
    || !Number.isSafeInteger(omitted)
    || (omitted as number) < 0
    || (omitted as number) > MAX_CASE_PACK_CASES * 8) {
    throw new TypeError('The CLI case pack has an invalid Brand Profile redaction manifest.');
  }
  const referencesMatch = caseReferenceLists.every((references, index) => {
    const reportReferences = reportReferenceLists[index];
    return reportReferences?.length === references.length
      && references.every((reference, referenceIndex) => reportReferences[referenceIndex] === reference);
  });
  if (audience === 'public') {
    if (caseReferenceLists.some((references) => references.length !== 0)
      || reportReferenceLists.some((references) => references.length !== 0)) {
      throw new TypeError('The public CLI case pack has an invalid Brand Profile redaction manifest.');
    }
  } else if (omitted !== 0 || !referencesMatch) {
    throw new TypeError('The trusted or internal CLI case pack has inconsistent Brand Profile references.');
  }

  const { integrity: _integrity, ...unsigned } = root;
  let calculated: string;
  try {
    calculated = `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex')}`;
  } catch {
    throw new TypeError('The CLI case pack structure is not serializable.');
  }
  if (calculated !== integrity.digestSha256) {
    throw new TypeError('The CLI case pack failed its SHA-256 integrity check.');
  }
  return Object.freeze({ caseCount: normalised.length });
}
export function formatCliCasePack(document: ReturnType<typeof buildCliCasePack>): string {
  return [
    'Reviewed case pack',
    `Audience   ${document.packet.audience}`,
    `Cases      ${document.cases.length}`,
    `Reports    ${document.packet.reports.length}`,
    `Digest     ${document.integrity.digestSha256}`,
    '',
    ...document.packet.redactionManifest.excluded.map((item) => `Excluded: ${item}`),
    '',
  ].join('\n');
}
