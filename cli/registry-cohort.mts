import { Buffer } from 'node:buffer';

import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../packages/evidence/observation.mts';
import { scanBoundedJson } from './bounded-json.mts';
import { CliUsageError } from './errors.mts';
import { buildRegistryDoctorReport } from './registry-doctor.mts';
import {
  LEGACY_SAVED_LOOKUP_SCHEMA_VERSION,
  SAVED_LOOKUP_SCHEMA,
  parseSavedLookupDocument,
  type UnknownRecord,
} from './saved-lookup.mts';

export const REGISTRY_COHORT_SCHEMA = 'whoisleuth.cli.registry-cohort';
export const LEGACY_REGISTRY_COHORT_VERSION = 1;
export const REGISTRY_COHORT_VERSION = 2;
export const MAX_REGISTRY_COHORT_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_REGISTRY_COHORT_SAMPLES = 500;
export const MAX_REGISTRY_COHORT_GROUPS = 500;
export const MAX_REGISTRY_COHORT_INPUT_POINTS = 2_000;
export const MAX_REGISTRY_COHORT_TIMELINE_POINTS = 50;
export const MAX_REGISTRY_COHORT_OMISSIONS = 1_000_000;
export const MIN_REGISTRY_COHORT_SAMPLE = 5;

type CohortState = 'consistent' | 'insufficient_sample' | 'review';
type InputFamily = 'retained_reports' | 'saved_lookups';
type SourceAlignment = Readonly<{ investigate: number; expectedConstraints: number; observed: number }>;
type Publication = Readonly<{
  reviewItems: number;
  objectIdentifiersObserved: number;
  baseConformanceObserved: number;
  selfLinksObserved: number;
  redactionMetadataObserved: number;
}>;
type SampleWindow = Readonly<{ from: string; to: string }>;
type TimelinePoint = Readonly<{
  reportGeneratedAt: string;
  sampleWindow: SampleWindow;
  sampleCount: number;
  state: CohortState;
  sourceAlignment: SourceAlignment;
  publication: Publication;
}>;
type Cohort = Readonly<{
  suffix: string;
  profileId: string;
  sampleCount: number;
  state: CohortState;
  latestState: CohortState;
  sampleWindow: SampleWindow;
  sourceAlignment: SourceAlignment;
  publication: Publication;
  timeline: readonly TimelinePoint[];
  timelineOmitted: number;
}>;
type RegistryCohortReport = Readonly<{
  schema: typeof REGISTRY_COHORT_SCHEMA;
  version: typeof REGISTRY_COHORT_VERSION;
  generatedAt: string;
  inputFamily: InputFamily;
  sampleCount: number;
  reportsMerged: number;
  minimumCohortSample: typeof MIN_REGISTRY_COHORT_SAMPLE;
  sampleWindow: SampleWindow;
  cohorts: readonly Cohort[];
  omissions: Readonly<{ duplicateTimelinePoints: number; timelinePoints: number }>;
  truncated: boolean;
  limitations: readonly string[];
}>;

type SourceCohort = Readonly<{
  suffix: string;
  profileId: string;
  sampleWindow: SampleWindow;
  points: readonly TimelinePoint[];
  inheritedState: CohortState;
  upstreamTimelineOmitted: number;
}>;
type SourceReport = Readonly<{
  generatedAt: string;
  sampleWindow: SampleWindow;
  cohorts: readonly SourceCohort[];
  duplicateTimelinePoints: number;
}>;

const LEGACY_ROOT_KEYS = new Set(['schema', 'version', 'generatedAt', 'sampleCount', 'minimumCohortSample', 'cohorts', 'limitations']);
const LEGACY_COHORT_KEYS = new Set(['suffix', 'profileId', 'sampleCount', 'state', 'sourceAlignment', 'publication']);
const ROOT_KEYS = new Set(['schema', 'version', 'generatedAt', 'inputFamily', 'sampleCount', 'reportsMerged', 'minimumCohortSample', 'sampleWindow', 'cohorts', 'omissions', 'truncated', 'limitations']);
const COHORT_KEYS = new Set(['suffix', 'profileId', 'sampleCount', 'state', 'latestState', 'sampleWindow', 'sourceAlignment', 'publication', 'timeline', 'timelineOmitted']);
const POINT_KEYS = new Set(['reportGeneratedAt', 'sampleWindow', 'sampleCount', 'state', 'sourceAlignment', 'publication']);
const SOURCE_KEYS = new Set(['investigate', 'expectedConstraints', 'observed']);
const PUBLICATION_KEYS = new Set(['reviewItems', 'objectIdentifiersObserved', 'baseConformanceObserved', 'selfLinksObserved', 'redactionMetadataObserved']);
const WINDOW_KEYS = new Set(['from', 'to']);
const OMISSION_KEYS = new Set(['duplicateTimelinePoints', 'timelinePoints']);

const LIMITATIONS = Object.freeze([
  'The report intentionally omits domains, queries and raw evidence. It groups retained observations only by suffix and capability profile.',
  `Every timeline point retains its original state. Cohorts with fewer than ${MIN_REGISTRY_COHORT_SAMPLE} observations remain insufficient sample and are never promoted by summing overlapping reports.`,
  'A merged cohort keeps the most conservative retained state and separately reports the latest point. Duplicate points are suppressed and inherited omission counts are not summed across overlapping retained reports.',
  'Review fixture provenance and source health before changing a parser or registry access profile.',
]);
const LEGACY_LIMITATIONS = Object.freeze([
  'The report intentionally omits domains, queries and raw evidence. It groups saved observations only by suffix and capability profile.',
  `Cohorts with fewer than ${MIN_REGISTRY_COHORT_SAMPLE} observations remain insufficient sample and must not drive catalogue changes.`,
  'Repeated observations from one environment are not representative by themselves. Review fixture provenance and source health before changing a parser or access profile.',
]);

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliUsageError(`${label} must be an object.`);
  return value as UnknownRecord;
}

function exact(value: unknown, keys: ReadonlySet<string>, label: string): UnknownRecord {
  const item = record(value, label);
  if (Object.keys(item).some((key) => !keys.has(key)) || [...keys].some((key) => !Object.hasOwn(item, key))) {
    throw new CliUsageError(`${label} does not match its exact retained contract.`);
  }
  return item;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new CliUsageError(`${label} is outside its supported bound.`);
  }
  return Number(value);
}

function timestamp(value: unknown, label: string, legacy = false): string {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new CliUsageError(`${label} is invalid.`);
  }
  const normalized = normalizeExplicitIsoTimestamp(value);
  if (normalized) return normalized;
  if (legacy) {
    const legacyTimestamp = normalizeLegacyIsoTimestamp(value);
    if (legacyTimestamp) return legacyTimestamp;
  }
  throw new CliUsageError(`${label} is invalid.`);
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/u.test(value)) throw new CliUsageError(`${label} is invalid.`);
  return value;
}

function suffix(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)) throw new CliUsageError('Registry cohort suffix is invalid.');
  return value;
}

function state(value: unknown, label: string): CohortState {
  if (value !== 'consistent' && value !== 'insufficient_sample' && value !== 'review') throw new CliUsageError(`${label} is invalid.`);
  return value;
}

function window(value: unknown, label: string): SampleWindow {
  const item = exact(value, WINDOW_KEYS, label);
  const from = timestamp(item.from, `${label} from`);
  const to = timestamp(item.to, `${label} to`);
  if (from > to) throw new CliUsageError(`${label} is reversed.`);
  return Object.freeze({ from, to });
}

function sourceAlignment(value: unknown, sampleCount: number, label: string): SourceAlignment {
  const item = exact(value, SOURCE_KEYS, label);
  return Object.freeze({
    investigate: integer(item.investigate, 0, sampleCount * 2, `${label} investigate`),
    expectedConstraints: integer(item.expectedConstraints, 0, sampleCount * 2, `${label} expected constraints`),
    observed: integer(item.observed, 0, sampleCount * 2, `${label} observed`),
  });
}

function publication(value: unknown, sampleCount: number, label: string): Publication {
  const item = exact(value, PUBLICATION_KEYS, label);
  return Object.freeze({
    reviewItems: integer(item.reviewItems, 0, sampleCount * 4, `${label} review items`),
    objectIdentifiersObserved: integer(item.objectIdentifiersObserved, 0, sampleCount, `${label} object identifiers`),
    baseConformanceObserved: integer(item.baseConformanceObserved, 0, sampleCount, `${label} base conformance`),
    selfLinksObserved: integer(item.selfLinksObserved, 0, sampleCount, `${label} self links`),
    redactionMetadataObserved: integer(item.redactionMetadataObserved, 0, sampleCount, `${label} redaction metadata`),
  });
}

function derivedState(sampleCount: number, sources: SourceAlignment, published: Publication): CohortState {
  return sampleCount < MIN_REGISTRY_COHORT_SAMPLE
    ? 'insufficient_sample'
    : sources.investigate || published.reviewItems
      ? 'review'
      : 'consistent';
}

function conservativeState(states: readonly CohortState[]): CohortState {
  return states.includes('review') ? 'review' : states.includes('insufficient_sample') ? 'insufficient_sample' : 'consistent';
}

function timelinePoint(value: unknown, label: string): TimelinePoint {
  const item = exact(value, POINT_KEYS, label);
  const sampleCount = integer(item.sampleCount, 1, MAX_REGISTRY_COHORT_SAMPLES, `${label} sample count`);
  const sources = sourceAlignment(item.sourceAlignment, sampleCount, `${label} source alignment`);
  const published = publication(item.publication, sampleCount, `${label} publication`);
  const pointState = state(item.state, `${label} state`);
  if (pointState !== derivedState(sampleCount, sources, published)) throw new CliUsageError(`${label} state does not match its retained counts.`);
  return Object.freeze({
    reportGeneratedAt: timestamp(item.reportGeneratedAt, `${label} report generatedAt`),
    sampleWindow: window(item.sampleWindow, `${label} sample window`),
    sampleCount,
    state: pointState,
    sourceAlignment: sources,
    publication: published,
  });
}

function boundedLimitations(value: unknown, expected: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) {
    throw new CliUsageError(`${label} limitations do not match the supported target-free contract.`);
  }
}

function parseInputDocuments(text: string): UnknownRecord[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_REGISTRY_COHORT_INPUT_BYTES) throw new CliUsageError(`Registry cohort input is limited to ${MAX_REGISTRY_COHORT_INPUT_BYTES} bytes.`);
  const trimmed = text.replace(/^\uFEFF/u, '').trim();
  if (!trimmed) throw new CliUsageError('Registry cohort input is empty.');
  let values: unknown[];
  if (trimmed.startsWith('[')) {
    try {
      scanBoundedJson(trimmed);
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) throw new Error('not array');
      values = parsed;
    } catch (error) {
      if (error instanceof TypeError && /duplicate|nesting|value limit|key limit/iu.test(error.message)) throw new CliUsageError(error.message);
      throw new CliUsageError('Registry cohort JSON input must be a valid array.');
    }
  } else {
    const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim());
    if (!lines.length || lines.length > MAX_REGISTRY_COHORT_SAMPLES) {
      throw new CliUsageError(`Registry cohort input must contain from 1 to ${MAX_REGISTRY_COHORT_SAMPLES} saved Lookups or retained cohort reports.`);
    }
    values = lines.map((line, index) => {
      try {
        scanBoundedJson(line);
        return JSON.parse(line) as unknown;
      } catch (error) {
        if (error instanceof TypeError && /duplicate|nesting|value limit|key limit/iu.test(error.message)) throw new CliUsageError(`Registry cohort JSONL line ${index + 1}: ${error.message}`);
        throw new CliUsageError(`Registry cohort JSONL line ${index + 1} is invalid.`);
      }
    });
  }
  if (!values.length || values.length > MAX_REGISTRY_COHORT_SAMPLES) throw new CliUsageError(`Registry cohort input must contain from 1 to ${MAX_REGISTRY_COHORT_SAMPLES} saved Lookups or retained cohort reports.`);
  return values.map((value, index) => record(value, `Registry cohort item ${index + 1}`));
}

function groupPoint(reports: readonly ReturnType<typeof buildRegistryDoctorReport>[], reportGeneratedAt: string): TimelinePoint {
  const sampleCount = reports.length;
  const sources = Object.freeze({
    investigate: reports.reduce((total, item) => total + item.summary.investigate, 0),
    expectedConstraints: reports.reduce((total, item) => total + item.summary.expectedConstraints, 0),
    observed: reports.reduce((total, item) => total + item.summary.observed, 0),
  });
  const published = Object.freeze({
    reviewItems: reports.reduce((total, item) => total + item.publication.reviewItems, 0),
    objectIdentifiersObserved: reports.filter((item) => item.publication.objectIdentifier.state === 'observed').length,
    baseConformanceObserved: reports.filter((item) => item.publication.baseConformance.state === 'observed').length,
    selfLinksObserved: reports.filter((item) => item.publication.selfLink.state === 'observed').length,
    redactionMetadataObserved: reports.filter((item) => item.publication.redactionMetadata.state === 'observed').length,
  });
  const observed = reports.map((report) => report.generatedAt).sort();
  return Object.freeze({
    reportGeneratedAt,
    sampleWindow: Object.freeze({ from: observed[0]!, to: observed.at(-1)! }),
    sampleCount,
    state: derivedState(sampleCount, sources, published),
    sourceAlignment: sources,
    publication: published,
  });
}

function sourceReportsFromLookups(documents: readonly UnknownRecord[], generatedAt: string): SourceReport[] {
  const reports = documents.map((item) => {
    const raw = JSON.stringify(item);
    const lookup = parseSavedLookupDocument(raw, { label: 'Registry cohort saved Lookup' });
    return buildRegistryDoctorReport(raw, timestamp(
      lookup.generatedAt,
      'Saved Lookup generatedAt',
      lookup.version === LEGACY_SAVED_LOOKUP_SCHEMA_VERSION,
    ));
  });
  const groups = new Map<string, typeof reports>();
  for (const report of reports) {
    const key = `${report.suffix}\u0000${report.profile.id}`;
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  const cohorts = [...groups.values()].map((group) => {
    const sample = group[0]!;
    const point = groupPoint(group, generatedAt);
    return Object.freeze({ suffix: sample.suffix, profileId: sample.profile.id, sampleWindow: point.sampleWindow, points: Object.freeze([point]), inheritedState: point.state, upstreamTimelineOmitted: 0 });
  });
  const observed = reports.map((report) => report.generatedAt).sort();
  return [Object.freeze({ generatedAt, sampleWindow: Object.freeze({ from: observed[0]!, to: observed.at(-1)! }), cohorts: Object.freeze(cohorts), duplicateTimelinePoints: 0 })];
}

function parseLegacyReport(value: UnknownRecord): SourceReport {
  const root = exact(value, LEGACY_ROOT_KEYS, 'Registry cohort v1 report');
  if (root.schema !== REGISTRY_COHORT_SCHEMA || root.version !== LEGACY_REGISTRY_COHORT_VERSION) throw new CliUsageError('Registry cohort report version is unsupported.');
  const generatedAt = timestamp(root.generatedAt, 'Registry cohort v1 generatedAt', true);
  const sampleCount = integer(root.sampleCount, 1, MAX_REGISTRY_COHORT_SAMPLES, 'Registry cohort v1 sample count');
  if (root.minimumCohortSample !== MIN_REGISTRY_COHORT_SAMPLE) throw new CliUsageError('Registry cohort v1 minimum sample is unsupported.');
  boundedLimitations(root.limitations, LEGACY_LIMITATIONS, 'Registry cohort v1');
  if (!Array.isArray(root.cohorts) || !root.cohorts.length || root.cohorts.length > MAX_REGISTRY_COHORT_GROUPS) throw new CliUsageError('Registry cohort v1 groups are invalid.');
  const seen = new Set<string>();
  let represented = 0;
  const cohorts = root.cohorts.map((candidate, index) => {
    const item = exact(candidate, LEGACY_COHORT_KEYS, `Registry cohort v1 group ${index + 1}`);
    const count = integer(item.sampleCount, 1, sampleCount, 'Registry cohort v1 group sample count');
    const sources = sourceAlignment(item.sourceAlignment, count, 'Registry cohort v1 source alignment');
    const published = publication(item.publication, count, 'Registry cohort v1 publication');
    const pointState = state(item.state, 'Registry cohort v1 state');
    if (pointState !== derivedState(count, sources, published)) throw new CliUsageError('Registry cohort v1 state does not match its retained counts.');
    const key = `${suffix(item.suffix)}\u0000${identifier(item.profileId, 'Registry cohort v1 profile ID')}`;
    if (seen.has(key)) throw new CliUsageError('Registry cohort v1 groups must be unique.');
    seen.add(key);
    represented += count;
    const point = Object.freeze({ reportGeneratedAt: generatedAt, sampleWindow: Object.freeze({ from: generatedAt, to: generatedAt }), sampleCount: count, state: pointState, sourceAlignment: sources, publication: published });
    return Object.freeze({ suffix: key.split('\u0000')[0]!, profileId: key.split('\u0000')[1]!, sampleWindow: point.sampleWindow, points: Object.freeze([point]), inheritedState: pointState, upstreamTimelineOmitted: 0 });
  });
  if (represented !== sampleCount) throw new CliUsageError('Registry cohort v1 sample count does not match its groups.');
  return Object.freeze({ generatedAt, sampleWindow: Object.freeze({ from: generatedAt, to: generatedAt }), cohorts: Object.freeze(cohorts), duplicateTimelinePoints: 0 });
}

function parseCurrentReport(value: UnknownRecord): SourceReport {
  const root = exact(value, ROOT_KEYS, 'Registry cohort v2 report');
  if (root.schema !== REGISTRY_COHORT_SCHEMA || root.version !== REGISTRY_COHORT_VERSION) throw new CliUsageError('Registry cohort report version is unsupported.');
  const generatedAt = timestamp(root.generatedAt, 'Registry cohort v2 generatedAt');
  if (root.inputFamily !== 'saved_lookups' && root.inputFamily !== 'retained_reports') throw new CliUsageError('Registry cohort v2 input family is invalid.');
  const reportsMerged = integer(root.reportsMerged, 0, MAX_REGISTRY_COHORT_SAMPLES, 'Registry cohort v2 reports merged');
  if ((root.inputFamily === 'saved_lookups') !== (reportsMerged === 0)) throw new CliUsageError('Registry cohort v2 report count does not match its input family.');
  if (root.minimumCohortSample !== MIN_REGISTRY_COHORT_SAMPLE) throw new CliUsageError('Registry cohort v2 minimum sample is unsupported.');
  const reportWindow = window(root.sampleWindow, 'Registry cohort v2 sample window');
  boundedLimitations(root.limitations, LIMITATIONS, 'Registry cohort v2');
  const omissions = exact(root.omissions, OMISSION_KEYS, 'Registry cohort v2 omissions');
  const duplicateTimelinePoints = integer(omissions.duplicateTimelinePoints, 0, MAX_REGISTRY_COHORT_OMISSIONS, 'Registry cohort v2 duplicate points');
  const omittedTimelinePoints = integer(omissions.timelinePoints, 0, MAX_REGISTRY_COHORT_OMISSIONS, 'Registry cohort v2 omitted points');
  if (root.truncated !== (omittedTimelinePoints > 0)) throw new CliUsageError('Registry cohort v2 truncation state is inconsistent.');
  if (!Array.isArray(root.cohorts) || !root.cohorts.length || root.cohorts.length > MAX_REGISTRY_COHORT_GROUPS) throw new CliUsageError('Registry cohort v2 groups are invalid.');
  const seen = new Set<string>();
  let represented = 0;
  let cohortOmitted = 0;
  const cohorts = root.cohorts.map((candidate, index) => {
    const item = exact(candidate, COHORT_KEYS, `Registry cohort v2 group ${index + 1}`);
    const groupSuffix = suffix(item.suffix);
    const profileId = identifier(item.profileId, 'Registry cohort v2 profile ID');
    const key = `${groupSuffix}\u0000${profileId}`;
    if (seen.has(key)) throw new CliUsageError('Registry cohort v2 groups must be unique.');
    seen.add(key);
    const count = integer(item.sampleCount, 1, MAX_REGISTRY_COHORT_SAMPLES, 'Registry cohort v2 group sample count');
    const groupWindow = window(item.sampleWindow, 'Registry cohort v2 group sample window');
    const timelineOmitted = integer(item.timelineOmitted, 0, MAX_REGISTRY_COHORT_OMISSIONS, 'Registry cohort v2 group omitted points');
    cohortOmitted += timelineOmitted;
    if (!Array.isArray(item.timeline) || !item.timeline.length || item.timeline.length > MAX_REGISTRY_COHORT_TIMELINE_POINTS) throw new CliUsageError('Registry cohort v2 timeline is invalid.');
    const points = item.timeline.map((point, pointIndex) => timelinePoint(point, `Registry cohort v2 point ${pointIndex + 1}`));
    const identities = points.map(canonicalArtifactJsonV2);
    if (new Set(identities).size !== points.length || identities.some((identity, pointIndex) => pointIndex > 0 && pointOrder(points[pointIndex - 1]!, points[pointIndex]!) > 0)) throw new CliUsageError('Registry cohort v2 timeline must be unique and ordered.');
    const latest = points.at(-1)!;
    const groupState = state(item.state, 'Registry cohort v2 group state');
    const latestState = state(item.latestState, 'Registry cohort v2 latest state');
    const sources = sourceAlignment(item.sourceAlignment, count, 'Registry cohort v2 group source alignment');
    const published = publication(item.publication, count, 'Registry cohort v2 group publication');
    const visibleState = conservativeState(points.map((point) => point.state));
    const pointFrom = points.map((point) => point.sampleWindow.from).sort()[0]!;
    const pointTo = points.map((point) => point.sampleWindow.to).sort().at(-1)!;
    if (latestState !== latest.state || count !== latest.sampleCount
      || canonicalArtifactJsonV2(sources) !== canonicalArtifactJsonV2(latest.sourceAlignment)
      || canonicalArtifactJsonV2(published) !== canonicalArtifactJsonV2(latest.publication)
      || (timelineOmitted === 0 && groupState !== visibleState)
      || (timelineOmitted > 0 && conservativeState([groupState, visibleState]) !== groupState)
      || groupWindow.from > pointFrom || groupWindow.to < pointTo) {
      throw new CliUsageError('Registry cohort v2 current group projection is inconsistent with its timeline.');
    }
    represented += count;
    return Object.freeze({ suffix: groupSuffix, profileId, sampleWindow: groupWindow, points: Object.freeze(points), inheritedState: groupState, upstreamTimelineOmitted: timelineOmitted });
  });
  if (integer(root.sampleCount, 1, MAX_REGISTRY_COHORT_GROUPS * MAX_REGISTRY_COHORT_SAMPLES, 'Registry cohort v2 sample count') !== represented
    || cohortOmitted !== omittedTimelinePoints
    || reportWindow.from !== [...cohorts].sort((a, b) => a.sampleWindow.from.localeCompare(b.sampleWindow.from))[0]?.sampleWindow.from
    || reportWindow.to !== [...cohorts].sort((a, b) => b.sampleWindow.to.localeCompare(a.sampleWindow.to))[0]?.sampleWindow.to) {
    throw new CliUsageError('Registry cohort v2 report summary is inconsistent with its groups.');
  }
  return Object.freeze({ generatedAt, sampleWindow: reportWindow, cohorts: Object.freeze(cohorts), duplicateTimelinePoints });
}

function pointOrder(left: TimelinePoint, right: TimelinePoint): number {
  return left.sampleWindow.to.localeCompare(right.sampleWindow.to)
    || left.reportGeneratedAt.localeCompare(right.reportGeneratedAt)
    || canonicalArtifactJsonV2(left).localeCompare(canonicalArtifactJsonV2(right));
}

function buildCurrentReport(sourceReports: readonly SourceReport[], generatedAt: string, inputFamily: InputFamily, directSampleCount: number): RegistryCohortReport {
  const totalPoints = sourceReports.reduce((sum, report) => sum + report.cohorts.reduce((groupSum, cohort) => groupSum + cohort.points.length, 0), 0);
  if (totalPoints > MAX_REGISTRY_COHORT_INPUT_POINTS) throw new CliUsageError(`Retained registry cohort input contains more than ${MAX_REGISTRY_COHORT_INPUT_POINTS} timeline points.`);
  const groups = new Map<string, SourceCohort[]>();
  for (const report of sourceReports) for (const cohort of report.cohorts) {
    const key = `${cohort.suffix}\u0000${cohort.profileId}`;
    groups.set(key, [...(groups.get(key) ?? []), cohort]);
  }
  if (!groups.size || groups.size > MAX_REGISTRY_COHORT_GROUPS) throw new CliUsageError(`Registry cohort output is limited to ${MAX_REGISTRY_COHORT_GROUPS} suffix/profile groups.`);
  let duplicateTimelinePoints = Math.max(0, ...sourceReports.map((report) => report.duplicateTimelinePoints));
  const cohorts = [...groups.entries()].map(([key, inputs]) => {
    const unique = new Map<string, TimelinePoint>();
    for (const input of inputs) for (const point of input.points) {
      const identity = canonicalArtifactJsonV2(point);
      if (unique.has(identity)) duplicateTimelinePoints += 1;
      else unique.set(identity, point);
    }
    const allPoints = [...unique.values()].sort(pointOrder);
    const locallyOmitted = Math.max(0, allPoints.length - MAX_REGISTRY_COHORT_TIMELINE_POINTS);
    const timeline = allPoints.slice(-MAX_REGISTRY_COHORT_TIMELINE_POINTS);
    const latest = timeline.at(-1)!;
    const upstreamTimelineOmitted = Math.max(0, ...inputs.map((input) => input.upstreamTimelineOmitted));
    const groupWindow = Object.freeze({
      from: inputs.map((input) => input.sampleWindow.from).sort()[0]!,
      to: inputs.map((input) => input.sampleWindow.to).sort().at(-1)!,
    });
    return Object.freeze({
      suffix: key.split('\u0000')[0]!,
      profileId: key.split('\u0000')[1]!,
      sampleCount: latest.sampleCount,
      state: conservativeState([...inputs.map((input) => input.inheritedState), ...allPoints.map((point) => point.state)]),
      latestState: latest.state,
      sampleWindow: groupWindow,
      sourceAlignment: latest.sourceAlignment,
      publication: latest.publication,
      timeline: Object.freeze(timeline),
      timelineOmitted: upstreamTimelineOmitted + locallyOmitted,
    });
  }).sort((left, right) => left.suffix.localeCompare(right.suffix) || left.profileId.localeCompare(right.profileId));
  const timelinePoints = cohorts.reduce((sum, cohort) => sum + cohort.timelineOmitted, 0);
  if (duplicateTimelinePoints > MAX_REGISTRY_COHORT_OMISSIONS || timelinePoints > MAX_REGISTRY_COHORT_OMISSIONS) {
    throw new CliUsageError(`Registry cohort omission accounting exceeds the ${MAX_REGISTRY_COHORT_OMISSIONS}-item bound.`);
  }
  const allWindows = sourceReports.map((report) => report.sampleWindow);
  return Object.freeze({
    schema: REGISTRY_COHORT_SCHEMA,
    version: REGISTRY_COHORT_VERSION,
    generatedAt: timestamp(generatedAt, 'Registry cohort generatedAt'),
    inputFamily,
    sampleCount: inputFamily === 'saved_lookups' ? directSampleCount : cohorts.reduce((sum, cohort) => sum + cohort.sampleCount, 0),
    reportsMerged: inputFamily === 'retained_reports' ? sourceReports.length : 0,
    minimumCohortSample: MIN_REGISTRY_COHORT_SAMPLE,
    sampleWindow: Object.freeze({
      from: allWindows.map((item) => item.from).sort()[0]!,
      to: allWindows.map((item) => item.to).sort().at(-1)!,
    }),
    cohorts: Object.freeze(cohorts),
    omissions: Object.freeze({ duplicateTimelinePoints, timelinePoints }),
    truncated: timelinePoints > 0,
    limitations: LIMITATIONS,
  });
}

export function buildRegistryCohortReport(text: string, generatedAt = new Date().toISOString()): RegistryCohortReport {
  const documents = parseInputDocuments(text);
  const families = new Set(documents.map((document) => document.schema === SAVED_LOOKUP_SCHEMA ? 'saved_lookups' : document.schema === REGISTRY_COHORT_SCHEMA ? 'retained_reports' : 'unsupported'));
  if (families.size !== 1 || families.has('unsupported')) throw new CliUsageError('Registry cohort input must contain only saved Lookups or only retained registry cohort reports; mixed families are rejected.');
  const inputFamily = [...families][0] as InputFamily;
  if (inputFamily === 'saved_lookups') {
    return buildCurrentReport(sourceReportsFromLookups(documents, timestamp(generatedAt, 'Registry cohort generatedAt')), generatedAt, inputFamily, documents.length);
  }
  const reports: SourceReport[] = [];
  let retainedPoints = 0;
  for (const document of documents) {
    const report = document.version === LEGACY_REGISTRY_COHORT_VERSION
      ? parseLegacyReport(document)
      : document.version === REGISTRY_COHORT_VERSION
        ? parseCurrentReport(document)
        : (() => { throw new CliUsageError('Registry cohort report version is unsupported.'); })();
    retainedPoints += report.cohorts.reduce((total, cohort) => total + cohort.points.length, 0);
    if (retainedPoints > MAX_REGISTRY_COHORT_INPUT_POINTS) {
      throw new CliUsageError(`Retained registry cohort input contains more than ${MAX_REGISTRY_COHORT_INPUT_POINTS} timeline points.`);
    }
    reports.push(report);
  }
  return buildCurrentReport(reports, generatedAt, inputFamily, 0);
}

export function formatRegistryCohortReport(report: RegistryCohortReport): string {
  const output = [
    'Registry quality cohort timeline',
    `Input family        ${report.inputFamily.replaceAll('_', ' ')}`,
    `Current samples     ${report.sampleCount}`,
    `Reports merged      ${report.reportsMerged}`,
    `Sample window       ${report.sampleWindow.from} → ${report.sampleWindow.to}`,
    `Minimum sample      ${report.minimumCohortSample}`,
    '',
  ];
  for (const cohort of report.cohorts) {
    output.push(`.${cohort.suffix} · ${cohort.profileId} [${cohort.state.replaceAll('_', ' ')}]`);
    output.push(`  Latest: ${cohort.latestState.replaceAll('_', ' ')} · ${cohort.sampleCount} samples`);
    output.push(`  Timeline points: ${cohort.timeline.length}${cohort.timelineOmitted ? ` · ${cohort.timelineOmitted} omitted` : ''}`);
    output.push(`  Source review items: ${cohort.sourceAlignment.investigate}`);
    output.push(`  Publication review items: ${cohort.publication.reviewItems}`);
  }
  if (report.omissions.duplicateTimelinePoints) output.push('', `Duplicate timeline points suppressed: ${report.omissions.duplicateTimelinePoints}`);
  output.push('', 'Limitations:');
  for (const limitation of report.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}

export type { CohortState, RegistryCohortReport, TimelinePoint };
