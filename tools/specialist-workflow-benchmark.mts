#!/usr/bin/env node

import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  generateTyposquatCandidateSet,
  MAX_GENERATED_CANDIDATES,
} from '../lib/typosquat-generator.mts';
import { parseWhoisChain } from '../lib/whois.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import { networkFeaturePolicy } from '../lib/feature-policy.mts';
import {
  CASE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/case-model.js';
import {
  BRAND_PROFILE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/brand-profile-model.js';
import {
  CAMPAIGN_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/campaign-model.js';
import {
  evaluateRuleSet,
} from '../frontend/src/lib/analysis/detection-rule-model.js';
import {
  buildInvestigationProjection,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import {
  buildCaseRelationships,
  buildInvestigationCaseRelationships,
} from '../frontend/src/lib/analysis/case-relationships.js';
import {
  buildCaseRelationshipGraph,
  MAX_RELATIONSHIP_GRAPH_CASES,
  MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS,
  projectCaseRelationshipGraph,
} from '../frontend/src/lib/analysis/case-relationship-graph.js';
import {
  buildWorkspaceArchive,
  readWorkspaceArchive,
  WORKSPACE_ARCHIVE_SECTION_IDS,
} from '../frontend/src/lib/analysis/workspace-archive.js';

type WritableLike = { write(value: string): unknown };
type BenchmarkStatus = 'pass' | 'fail';
type BenchmarkScenario = Readonly<{
  id: string;
  area: string;
  label: string;
  status: BenchmarkStatus;
  detail: string;
  assertions: number;
  failedAssertions: number;
  failures: readonly string[];
  failuresTruncated: boolean;
}>;
type ScenarioResult<T> = Readonly<{ scenario: BenchmarkScenario; metrics: T }>;
type WhoisFixture = Readonly<{
  name: string;
  capabilityProfile: string;
  scenario: string;
  chain: unknown[];
  expected: Record<string, unknown>;
}>;
type BenchmarkOptions = Readonly<{ now?: () => Date }>;
type BenchmarkMainOptions = BenchmarkOptions & Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export const SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA = 'whoisleuth.specialist-workflow-benchmark';
export const SPECIALIST_WORKFLOW_BENCHMARK_VERSION = 1;
export const MAX_SPECIALIST_WORKFLOW_SCENARIOS = 8;
export const MAX_SPECIALIST_WORKFLOW_FAILURES = 12;
export const MAX_SPECIALIST_WORKFLOW_DETAIL_LENGTH = 320;
export const MAX_SPECIALIST_WORKFLOW_REGISTRY_FIXTURES = 500;

const require = createRequire(import.meta.url);
const WHOIS_FIXTURES = require('../fixtures/whois-registry-fixtures.js') as WhoisFixture[];
const OBSERVED_AT = '2026-07-20T00:00:00.000Z';
const EARLIER = '2026-07-19T00:00:00.000Z';
const RULES = Object.freeze([Object.freeze({
  id: 'credential-language',
  name: 'Credential language review',
  enabled: true,
  match: 'all',
  conditions: Object.freeze([
    Object.freeze({ field: 'hasPasswordField', operator: 'equals', value: true }),
    Object.freeze({ field: 'phishingLanguageMatch', operator: 'contains', value: 'verify' }),
  ]),
  riskDelta: 0,
  tag: 'review',
})]);

function boundedText(value: unknown, fallback: string, maximum = MAX_SPECIALIST_WORKFLOW_DETAIL_LENGTH): string {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
  return (text || fallback).slice(0, maximum);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new TypeError('Benchmark generation time must be valid.');
  return new Date(parsed).toISOString();
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    capturedAt: OBSERVED_AT,
    firstCapturedAt: EARLIER,
    source: 'lookup',
    scanDepth: 'deep',
    availability: 'registered',
    nameservers: [],
    ...overrides,
  };
}

function caseRecord(
  id: string,
  domain: string,
  evidenceHistory: Record<string, unknown>[] = [snapshot()],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    domain,
    status: 'reviewing',
    disposition: 'unreviewed',
    tags: [],
    notes: [],
    source: 'lookup',
    evidenceHistory,
    createdAt: EARLIER,
    updatedAt: OBSERVED_AT,
    ...overrides,
  };
}

function projectionInput(cases: Record<string, unknown>[]): Record<string, unknown> {
  return {
    cases: { version: CASE_SCHEMA_VERSION, cases },
    campaigns: { version: CAMPAIGN_SCHEMA_VERSION, campaigns: [] },
    brandProfiles: { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [] },
    relationshipRows: [],
  };
}

function scenario<T>(
  id: string,
  area: string,
  label: string,
  assertions: readonly { pass: boolean; failure: string }[],
  metrics: T,
  passingDetail: string,
  assertionCount = assertions.length,
  failedAssertionCount = assertions.filter((item) => !item.pass).length,
): ScenarioResult<T> {
  const failures = assertions.filter((item) => !item.pass)
    .map((item) => boundedText(item.failure, 'An assertion failed.'))
    .slice(0, MAX_SPECIALIST_WORKFLOW_FAILURES);
  return Object.freeze({
    scenario: Object.freeze({
      id,
      area,
      label,
      status: failures.length ? 'fail' : 'pass',
      detail: failedAssertionCount
        ? boundedText(`${failedAssertionCount} assertion${failedAssertionCount === 1 ? '' : 's'} failed.`, 'Scenario failed.')
        : boundedText(passingDetail, 'Scenario passed.'),
      assertions: assertionCount,
      failedAssertions: failedAssertionCount,
      failures: Object.freeze(failures),
      failuresTruncated: failedAssertionCount > failures.length,
    }),
    metrics,
  });
}

function failedScenario<T>(id: string, area: string, label: string, error: unknown, metrics: T): ScenarioResult<T> {
  const message = boundedText(error instanceof Error ? error.message : error, 'The scenario could not run.');
  return scenario(id, area, label, [{ pass: false, failure: message }], metrics, '');
}

function registryParsingScenario(): ScenarioResult<Record<string, unknown>> {
  const failures: string[] = [];
  const failedFixtures = new Set<string>();
  let fieldsChecked = 0;
  const fixtures = WHOIS_FIXTURES.slice(0, MAX_SPECIALIST_WORKFLOW_REGISTRY_FIXTURES);
  for (const fixture of fixtures) {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseWhoisChain(fixture.chain) as Record<string, unknown>;
    } catch (error) {
      failures.push(`${fixture.name}: ${boundedText(error instanceof Error ? error.message : error, 'parser error', 160)}`);
      failedFixtures.add(fixture.name);
      continue;
    }
    for (const [field, expected] of Object.entries(fixture.expected)) {
      fieldsChecked += 1;
      if (!isDeepStrictEqual(parsed[field], expected)) {
        failures.push(`${fixture.name}: ${field}`);
        failedFixtures.add(fixture.name);
      }
    }
  }
  const assertions = [
    { pass: WHOIS_FIXTURES.length <= MAX_SPECIALIST_WORKFLOW_REGISTRY_FIXTURES, failure: 'The registry fixture catalogue exceeded the benchmark bound.' },
    { pass: fixtures.length > 0, failure: 'No registry fixtures were available.' },
    ...failures.slice(0, MAX_SPECIALIST_WORKFLOW_FAILURES).map((failure) => ({ pass: false, failure })),
  ];
  const metrics = Object.freeze({
    fixtureLimit: MAX_SPECIALIST_WORKFLOW_REGISTRY_FIXTURES,
    fixturesEvaluated: fixtures.length,
    parserFamilies: new Set(fixtures.map((fixture) => fixture.capabilityProfile)).size,
    fieldsChecked,
    passed: fixtures.length - failedFixtures.size,
    failed: failedFixtures.size,
    passRate: ratio(fixtures.length - failedFixtures.size, fixtures.length),
  });
  return scenario(
    'registry-family-parsing',
    'registry',
    'Registry family parsing',
    assertions,
    metrics,
    `${fixtures.length} sanitized WHOIS fixtures matched their authority-aware parser expectations.`,
    fieldsChecked + fixtures.length + 2,
    failures.length,
  );
}

function lookalikeGenerationScenario(): ScenarioResult<Record<string, unknown>> {
  const result = generateTyposquatCandidateSet('scope.test', ['net'], { preset: 'all' });
  const domains = result.candidates.map((candidate) => candidate.domain);
  const uniqueDomains = new Set(domains);
  const omission = result.candidates.find((candidate) => candidate.domain === 'scop.test');
  const tldSubstitution = result.candidates.find((candidate) => candidate.domain === 'scope.net');
  const unicode = result.candidates.find((candidate) => candidate.mutationTypes.includes('unicode_homoglyph'));
  const combined = result.candidates.filter((candidate) => candidate.mutationTypes.length > 1);
  const metrics = Object.freeze({
    candidateLimit: MAX_GENERATED_CANDIDATES,
    candidates: result.candidates.length,
    uniqueCandidates: uniqueDomains.size,
    duplicateOutputs: domains.length - uniqueDomains.size,
    combinedProvenanceCandidates: combined.length,
    deduplicationRate: ratio(domains.length - uniqueDomains.size, domains.length),
    truncated: result.truncated,
  });
  return scenario('lookalike-generation', 'detection', 'Lookalike generation and provenance', [
    { pass: result.inputValid, failure: 'The reserved seed was rejected.' },
    { pass: result.candidates.length > 0 && result.candidates.length <= MAX_GENERATED_CANDIDATES, failure: 'Candidate output was empty or unbounded.' },
    { pass: uniqueDomains.size === domains.length, failure: 'The generator emitted duplicate domains.' },
    { pass: omission?.mutationTypes.includes('character_omission') === true, failure: 'Character-omission provenance was missing.' },
    { pass: tldSubstitution?.mutationTypes.includes('tld_substitution') === true, failure: 'Selected-TLD provenance was missing.' },
    { pass: Boolean(unicode), failure: 'IDNA-safe confusable generation was not exercised.' },
    { pass: combined.length > 0, failure: 'Combined mutation provenance was not retained.' },
  ], metrics, `${result.candidates.length} unique bounded candidates retained machine-readable mutation provenance.`);
}

async function partialSourceScenario(): Promise<ScenarioResult<Record<string, unknown>>> {
  const partialCases = [
    caseRecord('partial-deep', 'partial.invalid', [snapshot({
      nameservers: ['ns.shared.invalid'],
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'partial',
      httpFinalOrigin: 'https://shared.invalid',
      httpResponseStatus: 200,
    })]),
    caseRecord('fast-only', 'fast.invalid', [snapshot({
      scanDepth: 'fast',
      nameservers: ['ns.fast.invalid'],
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://must-not-project.invalid',
      httpResponseStatus: 200,
    })]),
  ];
  const projection = buildInvestigationProjection(projectionInput(partialCases), { generatedAt: OBSERVED_AT });
  const future = buildInvestigationProjection({
    ...projectionInput([]),
    cases: { version: CASE_SCHEMA_VERSION + 1, cases: partialCases },
  }, { generatedAt: OBSERVED_AT });
  let sourceCalls = 0;
  const failedLookup = await runUnifiedLookup({
    type: 'domain',
    value: 'source-failure.invalid',
    inputHostname: 'source-failure.invalid',
    registrableDomain: 'source-failure.invalid',
    isSubdomain: false,
  }, {
    featurePolicy: networkFeaturePolicy({}),
    fetchRdapRecord: async () => { sourceCalls += 1; throw new Error('Synthetic RDAP failure'); },
    fetchRegistrarRdapRecord: async () => { throw new Error('Registrar follow-up must not run'); },
    buildWhoisChain: async () => { sourceCalls += 1; throw new Error('Synthetic WHOIS failure'); },
    checkDomainAvailability: async () => {
      sourceCalls += 1;
      return { state: 'unknown', confidence: 'low', detail: 'Registration sources were unavailable.' };
    },
  });
  const evidence = projection.observations.filter((item) => item.kind === 'case_evidence');
  const partial = evidence.filter((item) => item.status === 'partial');
  const deepOrigin = projection.relationships.find((item) => item.type === 'domain_reached_http_origin');
  const fastDomain = projection.entities.find((item) => item.type === 'domain' && item.canonical === 'fast.invalid');
  const fastOriginEdge = projection.relationships.find((item) => item.type === 'domain_reached_http_origin' && item.from === fastDomain?.id);
  const disclosed = partial.filter((item) => item.limitations.length > 0);
  const metrics = Object.freeze({
    evidenceObservations: evidence.length,
    incompleteObservations: partial.length,
    incompleteCollectionRate: ratio(partial.length, evidence.length),
    explicitlyDisclosed: disclosed.length,
    undisclosedIncomplete: partial.length - disclosed.length,
    unsupportedSources: Object.values(future.sources).filter((source) => source.state === 'unsupported').length,
    failedLookupSources: [failedLookup.diagnostics.rdap, failedLookup.diagnostics.whois]
      .filter((source) => source.status === 'error').length,
    lookupFunctionCalls: sourceCalls,
  });
  return scenario('partial-source-states', 'collection', 'Partial and unavailable source states', [
    { pass: evidence.length === 2, failure: 'The compact evidence observations were not retained.' },
    { pass: partial.length === evidence.length && disclosed.length === partial.length, failure: 'Incomplete compact evidence was not disclosed explicitly.' },
    { pass: Boolean(deepOrigin), failure: 'A partial deep observation lost its affirmative final-origin evidence.' },
    { pass: fastOriginEdge === undefined, failure: 'Fast evidence incorrectly created a deep-only origin relationship.' },
    { pass: future.sources.cases.state === 'unsupported' && future.relationships.length === 0, failure: 'A future source schema was interpreted as negative evidence.' },
    { pass: failedLookup.diagnostics.rdap.status === 'error' && failedLookup.diagnostics.whois.status === 'error', failure: 'Injected source failures were not retained independently.' },
    { pass: failedLookup.availability.state === 'unknown', failure: 'Unavailable registration sources were converted into a conclusive availability finding.' },
    { pass: sourceCalls === 3, failure: 'The source-failure fixture made an unexpected call.' },
  ], metrics, 'Partial deep evidence remained affirmative and attributed, while fast, failed, and unsupported sources created no deep-only or negative findings.');
}

function relationshipProvenanceScenario(): ScenarioResult<Record<string, unknown>> {
  const shared = {
    nameservers: ['ns.shared.invalid'],
    httpSummaryVersion: 1,
    httpEvidenceStatus: 'success',
    httpFinalOrigin: 'https://shared.invalid',
    httpResponseStatus: 200,
  };
  const projection = buildInvestigationProjection(projectionInput([
    caseRecord('relation-a', 'relation-a.invalid', [snapshot(shared)]),
    caseRecord('relation-b', 'relation-b.invalid', [snapshot(shared)]),
  ]), { generatedAt: OBSERVED_AT });
  const summary = buildInvestigationCaseRelationships(projection);
  const projectedGraph = projectCaseRelationshipGraph(summary);
  const observationIds = new Set(projection.observations.map((item) => item.id));
  const sourcedRelationships = projection.relationships.filter((item) => item.sourceObservationIds.length > 0
    && item.sourceObservationIds.every((id) => observationIds.has(id)));
  const sourcedEdges = projectedGraph.edges.filter((edge) => {
    const node = projectedGraph.relationshipNodes.find((item) => item.id === edge.relationshipId);
    return Boolean(node?.observations?.length && node.sources?.length);
  });
  const metrics = Object.freeze({
    projectionRelationships: projection.relationships.length,
    provenanceBackedRelationships: sourcedRelationships.length,
    graphEdges: projectedGraph.edges.length,
    provenanceBackedGraphEdges: sourcedEdges.length,
    graphEdgeProvenanceCompleteness: ratio(sourcedEdges.length, projectedGraph.edges.length),
    graphVersion: projectedGraph.version,
  });
  return scenario('relationship-provenance', 'relationships', 'Relationship provenance completeness', [
    { pass: projection.relationships.length > 0 && sourcedRelationships.length === projection.relationships.length, failure: 'A projected relationship lacked a valid source observation.' },
    { pass: summary.state === 'ready' && summary.groups.length === 2, failure: 'Expected shared nameserver and final-origin pivots were not grouped.' },
    { pass: projectedGraph.edges.length > 0 && sourcedEdges.length === projectedGraph.edges.length, failure: 'A graph edge lost relationship-node provenance.' },
    { pass: projectedGraph.limitations.some((value) => /not proof/i.test(value)), failure: 'The graph omitted its attribution limitation.' },
  ], metrics, 'Every retained graph edge resolves to bounded source observations and explicit relationship limitations.');
}

function detectionRuleScenario(): ScenarioResult<Record<string, unknown>> {
  const records = [
    caseRecord('label-positive', 'credential-review.invalid', [snapshot({
      hasPasswordField: true,
      phishingLanguageMatch: 'verify account',
    })], { disposition: 'confirmed_abuse' }),
    caseRecord('label-benign-a', 'benign-a.invalid', [snapshot({ nameservers: ['ns.platform.invalid'] })], { disposition: 'expected' }),
    caseRecord('label-benign-b', 'benign-b.invalid', [snapshot({ nameservers: ['ns.platform.invalid'] })], { disposition: 'false_positive' }),
  ];
  const evaluated = evaluateRuleSet(records, RULES);
  const labels = new Map(records.map((record) => [record.id, record.disposition]));
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  const matchKeys: string[] = [];
  for (const result of evaluated) {
    const positive = labels.get(result.caseId) === 'confirmed_abuse';
    const flagged = result.matchedRules.length > 0;
    if (positive && flagged) truePositive += 1;
    else if (positive) falseNegative += 1;
    else if (flagged) falsePositive += 1;
    else trueNegative += 1;
    for (const rule of result.matchedRules) matchKeys.push(`${result.caseId}:${rule.id}`);
  }
  const metrics = Object.freeze({
    labelledRecords: evaluated.length,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    falsePositiveRate: ratio(falsePositive, falsePositive + trueNegative),
    ruleMatchKeys: matchKeys.length,
    duplicateRuleMatchKeys: matchKeys.length - new Set(matchKeys).size,
  });
  return scenario('detection-rule-replay', 'detection', 'Labelled detection-rule replay', [
    { pass: truePositive === 1 && falseNegative === 0, failure: 'The positive fixture did not produce the expected review match.' },
    { pass: falsePositive === 0 && trueNegative === 2, failure: 'Benign shared-infrastructure fixtures produced a rule match.' },
    { pass: new Set(matchKeys).size === matchKeys.length, failure: 'Rule replay emitted duplicate case-rule match keys.' },
  ], metrics, 'The bounded rule replay matched the positive fixture and retained a zero false-positive rate on labelled benign fixtures.');
}

function benignInfrastructureScenario(): ScenarioResult<Record<string, unknown>> {
  const shared = {
    nameservers: ['ns.platform.invalid'],
    httpSummaryVersion: 1,
    httpEvidenceStatus: 'success',
    httpFinalOrigin: 'https://platform.invalid',
    httpResponseStatus: 200,
  };
  const records = [
    caseRecord('shared-benign-a', 'shared-benign-a.invalid', [snapshot(shared)], { disposition: 'expected' }),
    caseRecord('shared-benign-b', 'shared-benign-b.invalid', [snapshot(shared)], { disposition: 'false_positive' }),
  ];
  const relationships = buildCaseRelationships(records);
  const ruleResults = evaluateRuleSet(records, RULES);
  const metrics = Object.freeze({
    benignRecords: records.length,
    relationshipPivots: relationships.groups.length,
    automaticRuleMatches: ruleResults.reduce((total, item) => total + item.matchedRules.length, 0),
  });
  return scenario('benign-shared-infrastructure', 'relationships', 'Benign shared-infrastructure controls', [
    { pass: relationships.groups.length === 2, failure: 'The benign shared infrastructure was not retained as an investigative pivot.' },
    { pass: relationships.limitations.some((value) => /not proof.*ownership|not proof.*maliciousness/i.test(value)), failure: 'Shared infrastructure was not qualified as a lead rather than attribution.' },
    { pass: ruleResults.every((item) => item.matchedRules.length === 0), failure: 'Shared infrastructure alone triggered the credential-language rule.' },
  ], metrics, 'Shared hosting and DNS remained visible as pivots without becoming ownership, intent, or maliciousness findings.');
}

function graphTruncationScenario(): ScenarioResult<Record<string, unknown>> {
  const records: Record<string, unknown>[] = [];
  for (let index = 0; index < MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS + 1; index += 1) {
    records.push(
      caseRecord(`graph-a-${index}`, `graph-a-${index}.invalid`, [snapshot({ nameservers: [`ns-${index}.invalid`] })]),
      caseRecord(`graph-b-${index}`, `graph-b-${index}.invalid`, [snapshot({ nameservers: [`ns-${index}.invalid`] })]),
    );
  }
  const graph = buildCaseRelationshipGraph(records);
  const metrics = Object.freeze({
    inputCases: records.length,
    retainedCases: graph.caseNodes.length,
    retainedRelationships: graph.relationshipNodes.length,
    retainedEdges: graph.edges.length,
    truncated: graph.truncated,
  });
  return scenario('graph-truncation', 'relationships', 'Bounded graph truncation', [
    { pass: graph.truncated === true, failure: 'An oversized graph was not marked truncated.' },
    { pass: graph.relationshipNodes.length === MAX_RELATIONSHIP_GRAPH_RELATIONSHIPS, failure: 'The relationship-node cap was not applied.' },
    { pass: graph.caseNodes.length === MAX_RELATIONSHIP_GRAPH_CASES, failure: 'The graph case-node cap was not applied.' },
    { pass: graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.caseId) && graph.nodes.some((node) => node.id === edge.relationshipId)), failure: 'A retained graph edge referenced an omitted node.' },
  ], metrics, 'The graph disclosed a bounded partial view while every retained edge continued to resolve to retained nodes.');
}

async function exportCompatibilityScenario(): Promise<ScenarioResult<Record<string, unknown>>> {
  const archive = await buildWorkspaceArchive({
    cases: [caseRecord('archive-case', 'archive.invalid', [], { secret: 'discard-me' })],
    campaigns: [],
    brandProfiles: [],
    watchlists: {},
    shortlist: [],
    detectionRules: [{ ...RULES[0], secret: 'discard-me' }],
    settings: { activeProfileId: '', theme: 'system' },
  }, { generatedAt: OBSERVED_AT });
  const read = await readWorkspaceArchive(archive);
  const serialized = JSON.stringify(archive);
  const metrics = Object.freeze({
    sectionsExpected: WORKSPACE_ARCHIVE_SECTION_IDS.length,
    sectionsRead: read.sections.length,
    readySections: read.sections.filter((section) => section.status === 'ready').length,
    archiveBytes: read.bytes,
  });
  return scenario('export-compatibility', 'interchange', 'Workspace export compatibility', [
    { pass: read.sections.length === WORKSPACE_ARCHIVE_SECTION_IDS.length, failure: 'The archive did not retain every declared section.' },
    { pass: read.sections.every((section) => section.status === 'ready'), failure: 'A current archive section failed schema or checksum validation.' },
    { pass: !serialized.includes('discard-me'), failure: 'Unknown fixture fields leaked into the portable archive.' },
  ], metrics, 'The current workspace archive round-tripped through manifest, byte-count, schema, and checksum validation.');
}

export async function buildSpecialistWorkflowBenchmark(options: BenchmarkOptions = {}) {
  const generatedAt = timestamp(options.now?.() || new Date());
  const results: ScenarioResult<Record<string, unknown>>[] = [];
  for (const [id, area, label, run] of [
    ['registry-family-parsing', 'registry', 'Registry family parsing', registryParsingScenario],
    ['lookalike-generation', 'detection', 'Lookalike generation and provenance', lookalikeGenerationScenario],
    ['partial-source-states', 'collection', 'Partial and unavailable source states', partialSourceScenario],
    ['relationship-provenance', 'relationships', 'Relationship provenance completeness', relationshipProvenanceScenario],
    ['detection-rule-replay', 'detection', 'Labelled detection-rule replay', detectionRuleScenario],
    ['benign-shared-infrastructure', 'relationships', 'Benign shared-infrastructure controls', benignInfrastructureScenario],
    ['graph-truncation', 'relationships', 'Bounded graph truncation', graphTruncationScenario],
  ] as const) {
    try {
      results.push(await run());
    } catch (error) {
      results.push(failedScenario(id, area, label, error, {}));
    }
  }
  try {
    results.push(await exportCompatibilityScenario());
  } catch (error) {
    results.push(failedScenario('export-compatibility', 'interchange', 'Workspace export compatibility', error, {}));
  }
  if (results.length > MAX_SPECIALIST_WORKFLOW_SCENARIOS) {
    throw new RangeError(`The specialist workflow benchmark is limited to ${MAX_SPECIALIST_WORKFLOW_SCENARIOS} scenarios.`);
  }

  const scenarios = Object.freeze(results.map((result) => result.scenario));
  const passed = scenarios.filter((item) => item.status === 'pass').length;
  const metricsByScenario = new Map(results.map((result) => [result.scenario.id, result.metrics]));
  const metrics = Object.freeze({
    registry: metricsByScenario.get('registry-family-parsing') || {},
    lookalikeGeneration: metricsByScenario.get('lookalike-generation') || {},
    collectionCompleteness: metricsByScenario.get('partial-source-states') || {},
    relationshipProvenance: metricsByScenario.get('relationship-provenance') || {},
    ruleReplay: metricsByScenario.get('detection-rule-replay') || {},
    benignSharedInfrastructure: metricsByScenario.get('benign-shared-infrastructure') || {},
    graphTruncation: metricsByScenario.get('graph-truncation') || {},
    exportCompatibility: metricsByScenario.get('export-compatibility') || {},
    workflow: Object.freeze({
      timeToFirstUsefulPivot: Object.freeze({ measurement: 'workflow_step_proxy', value: 3, unit: 'steps', wallClockMeasured: false }),
      stepsToReviewedCase: 5,
      steps: Object.freeze(['seed', 'collect', 'pivot', 'review', 'save']),
    }),
  });
  return Object.freeze({
    schema: SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA,
    version: SPECIALIST_WORKFLOW_BENCHMARK_VERSION,
    generatedAt,
    mode: 'offline_synthetic',
    summary: Object.freeze({ total: scenarios.length, passed, failed: scenarios.length - passed, passRate: ratio(passed, scenarios.length) }),
    bounds: Object.freeze({
      scenarioLimit: MAX_SPECIALIST_WORKFLOW_SCENARIOS,
      registryFixtureLimit: MAX_SPECIALIST_WORKFLOW_REGISTRY_FIXTURES,
      failureDetailLimit: MAX_SPECIALIST_WORKFLOW_FAILURES,
      generatedCandidateLimit: MAX_GENERATED_CANDIDATES,
      networkRequests: 0,
    }),
    metrics,
    scenarios,
    limitations: Object.freeze([
      'This benchmark replays checked-in sanitized registry fixtures, reserved domains, controlled synthetic page-evidence records, and deterministic local evidence only. It makes no network requests.',
      'It is a regression and workflow-contract benchmark, not a live coverage or production-performance claim.',
      'The time-to-first-pivot measure is a deterministic workflow-step proxy, not an analyst wall-clock measurement.',
      'Fixture labels, rule matches, scores, shared infrastructure, and pass rates do not prove ownership, intent, safety, or maliciousness.',
    ]),
  });
}

export function formatSpecialistWorkflowBenchmark(report: Awaited<ReturnType<typeof buildSpecialistWorkflowBenchmark>>): string {
  if (report.schema !== SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA || report.version !== SPECIALIST_WORKFLOW_BENCHMARK_VERSION) {
    throw new TypeError('Specialist workflow output requires the current benchmark contract.');
  }
  const lines = [
    'WHOISleuth specialist workflow benchmark',
    `Summary: ${report.summary.passed}/${report.summary.total} scenarios passed`,
    `Mode: ${report.mode}; network requests: ${report.bounds.networkRequests}`,
    '',
  ];
  for (const item of report.scenarios) {
    lines.push(`${item.status.toUpperCase().padEnd(5)} ${item.label}`);
    lines.push(`  ${item.detail}`);
    for (const failure of item.failures) lines.push(`  Failure: ${failure}`);
  }
  lines.push(
    '',
    `Registry fixture pass rate: ${String((report.metrics.registry as Record<string, unknown>).passRate)}`,
    `Labelled false-positive rate: ${String((report.metrics.ruleReplay as Record<string, unknown>).falsePositiveRate)}`,
    `Graph-edge provenance completeness: ${String((report.metrics.relationshipProvenance as Record<string, unknown>).graphEdgeProvenanceCompleteness)}`,
    `First useful pivot proxy: ${report.metrics.workflow.timeToFirstUsefulPivot.value} workflow steps`,
    'Use --json for the complete versioned metrics and limitations.',
  );
  return `${lines.join('\n')}\n`;
}

export function parseArguments(args: readonly string[]): { json: boolean } {
  let json = false;
  for (const arg of args) {
    if (arg === '--json') {
      if (json) throw new TypeError('--json may be supplied only once.');
      json = true;
    } else throw new TypeError(`Unknown option: ${arg}`);
  }
  return { json };
}

export async function main(args = process.argv.slice(2), options: BenchmarkMainOptions = {}): Promise<number> {
  try {
    const { json } = parseArguments(args);
    const report = await buildSpecialistWorkflowBenchmark(options);
    (options.stdout || process.stdout).write(json ? `${JSON.stringify(report, null, 2)}\n` : formatSpecialistWorkflowBenchmark(report));
    return report.summary.failed > 0 ? 1 : 0;
  } catch (error) {
    (options.stderr || process.stderr).write(`${boundedText(error instanceof Error ? error.message : error, 'Specialist workflow benchmark failed.')}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}

export type { BenchmarkMainOptions, BenchmarkOptions, BenchmarkScenario };
