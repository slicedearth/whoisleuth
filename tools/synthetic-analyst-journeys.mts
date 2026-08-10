#!/usr/bin/env node

// Builds bounded summaries for deterministic analyst-journey runs. These
// results describe fixture-bound workflow regression evidence only.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SYNTHETIC_ANALYST_JOURNEY_SCHEMA,
  SYNTHETIC_ANALYST_JOURNEY_VERSION,
  SYNTHETIC_ANALYST_JOURNEYS,
  SYNTHETIC_ANALYST_PERSONAS,
  SYNTHETIC_ANALYST_TASK_IDS,
  type SyntheticAnalystDevice,
  type SyntheticEvidenceState,
} from '../fixtures/synthetic-analyst-journeys.mts';
import { readBoundedRegularFile } from '../lib/bounded-file.mts';
import {
  boundedNonNegativeInteger as boundedInteger,
  medianOneDecimal as median,
  optionalJsonRecord as record,
} from './maintainer-tool-helpers.mts';

export const SYNTHETIC_ANALYST_RESULT_SCHEMA = 'whoisleuth.synthetic-analyst-result';
export const SYNTHETIC_ANALYST_REPORT_SCHEMA = 'whoisleuth.synthetic-analyst-report';
export const SYNTHETIC_ANALYST_RESULT_VERSION = 1;
export const MAX_SYNTHETIC_ANALYST_INPUT_BYTES = 256 * 1024;
export const MAX_SYNTHETIC_ANALYST_RESULTS = 100;
export const MAX_SYNTHETIC_ANALYST_DURATION_MS = 30 * 60 * 1000;
export const MAX_SYNTHETIC_ANALYST_EVENT_COUNT = 100;

type UnknownRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };

export type SyntheticAnalystResult = Readonly<{
  journeyId: string;
  personaId: string;
  device: SyntheticAnalystDevice;
  evidenceState: SyntheticEvidenceState;
  completed: boolean;
  durationMs: number;
  actions: number;
  backtracks: number;
  helpOpens: number;
  scrollReversals: number;
  milestones: readonly string[];
}>;

const RESULT_KEYS = new Set([
  'schema',
  'version',
  'journeyVersion',
  'journeyDigestSha256',
  'journeyId',
  'personaId',
  'device',
  'evidenceState',
  'completed',
  'durationMs',
  'actions',
  'backtracks',
  'helpOpens',
  'scrollReversals',
  'milestones',
]);

export const SYNTHETIC_ANALYST_JOURNEY_DIGEST_SHA256 = createHash('sha256')
  .update(JSON.stringify({
    schema: SYNTHETIC_ANALYST_JOURNEY_SCHEMA,
    version: SYNTHETIC_ANALYST_JOURNEY_VERSION,
    personas: SYNTHETIC_ANALYST_PERSONAS,
    journeys: SYNTHETIC_ANALYST_JOURNEYS,
  }), 'utf8')
  .digest('hex');

function exactKeys(value: UnknownRecord, expected: ReadonlySet<string>, label: string): void {
  if (Object.keys(value).some((key) => !expected.has(key))
    || [...expected].some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} must use only the documented fields.`);
  }
}

export function buildSyntheticAnalystCoverageReport() {
  const taskCoverage = SYNTHETIC_ANALYST_TASK_IDS.map((taskId) => {
    const journeys = SYNTHETIC_ANALYST_JOURNEYS.filter((journey) => journey.taskIds.includes(taskId));
    return Object.freeze({
      taskId,
      journeyIds: Object.freeze(journeys.map((journey) => journey.id)),
      browserTags: Object.freeze(journeys.map((journey) => `@journey-${journey.id}`)),
      devices: Object.freeze([...new Set(journeys.flatMap((journey) => journey.devices))].sort()),
    });
  });
  return Object.freeze({
    schema: SYNTHETIC_ANALYST_JOURNEY_SCHEMA,
    version: SYNTHETIC_ANALYST_JOURNEY_VERSION,
    digestSha256: SYNTHETIC_ANALYST_JOURNEY_DIGEST_SHA256,
    personaCount: SYNTHETIC_ANALYST_PERSONAS.length,
    journeyCount: SYNTHETIC_ANALYST_JOURNEYS.length,
    taskCoverage: Object.freeze(taskCoverage),
    uncoveredTaskIds: Object.freeze(taskCoverage.filter((item) => (
      item.journeyIds.length === 0
      || !item.devices.includes('desktop')
      || !item.devices.includes('mobile')
    )).map((item) => item.taskId)),
    interpretation: Object.freeze([
      'This plan defines deterministic workflow coverage for the declared routes and fixtures.',
      'Completion means the required observable milestones were reached within the reviewed action and backtrack budgets.',
      'A passing journey does not establish evidence correctness beyond the fixture contract.',
    ]),
  });
}

export function buildSyntheticAnalystResultTemplate(
  journeyId: string,
  device: SyntheticAnalystDevice,
) {
  const journey = SYNTHETIC_ANALYST_JOURNEYS.find((candidate) => candidate.id === journeyId);
  if (!journey || !journey.devices.includes(device)) {
    throw new TypeError('Synthetic journey and device must reference the current coverage plan.');
  }
  return Object.freeze({
    schema: SYNTHETIC_ANALYST_RESULT_SCHEMA,
    version: SYNTHETIC_ANALYST_RESULT_VERSION,
    journeyVersion: SYNTHETIC_ANALYST_JOURNEY_VERSION,
    journeyDigestSha256: SYNTHETIC_ANALYST_JOURNEY_DIGEST_SHA256,
    journeyId: journey.id,
    personaId: journey.personaId,
    device,
    evidenceState: journey.evidenceStates[0] as SyntheticEvidenceState,
    completed: false,
    durationMs: 0,
    actions: 0,
    backtracks: 0,
    helpOpens: 0,
    scrollReversals: 0,
    milestones: Object.freeze([]),
  });
}

export function normalizeSyntheticAnalystResult(value: unknown): SyntheticAnalystResult {
  const source = record(value);
  if (!source
    || source.schema !== SYNTHETIC_ANALYST_RESULT_SCHEMA
    || source.version !== SYNTHETIC_ANALYST_RESULT_VERSION
    || source.journeyVersion !== SYNTHETIC_ANALYST_JOURNEY_VERSION
    || source.journeyDigestSha256 !== SYNTHETIC_ANALYST_JOURNEY_DIGEST_SHA256) {
    throw new TypeError('Synthetic analyst result uses an unsupported or invalid contract.');
  }
  exactKeys(source, RESULT_KEYS, 'Synthetic analyst result');
  const journey = typeof source.journeyId === 'string'
    ? SYNTHETIC_ANALYST_JOURNEYS.find((candidate) => candidate.id === source.journeyId)
    : null;
  if (!journey || source.personaId !== journey.personaId
    || (source.device !== 'desktop' && source.device !== 'mobile')
    || !journey.devices.includes(source.device)
    || typeof source.evidenceState !== 'string'
    || !journey.evidenceStates.includes(source.evidenceState as SyntheticEvidenceState)
    || typeof source.completed !== 'boolean'
    || !Array.isArray(source.milestones)) {
    throw new TypeError('Synthetic analyst result does not match its declared journey.');
  }
  if (source.milestones.length > journey.requiredMilestones.length
    || source.milestones.some((item) => typeof item !== 'string' || !journey.requiredMilestones.includes(item))) {
    throw new TypeError('Synthetic analyst milestones must use the journey vocabulary.');
  }
  const milestones = [...new Set(source.milestones as string[])];
  if (milestones.length !== source.milestones.length) {
    throw new TypeError('Synthetic analyst milestones must not repeat.');
  }
  if (source.completed && journey.requiredMilestones.some((item) => !milestones.includes(item))) {
    throw new TypeError('A completed synthetic journey must include every required milestone.');
  }
  const actions = boundedInteger(source.actions, 'Synthetic action count', MAX_SYNTHETIC_ANALYST_EVENT_COUNT);
  const backtracks = boundedInteger(source.backtracks, 'Synthetic backtrack count', MAX_SYNTHETIC_ANALYST_EVENT_COUNT);
  if (actions > journey.maxActions || backtracks > journey.maxBacktracks) {
    throw new TypeError('Synthetic analyst result exceeds the reviewed journey budget.');
  }
  return Object.freeze({
    journeyId: journey.id,
    personaId: journey.personaId,
    device: source.device,
    evidenceState: source.evidenceState as SyntheticEvidenceState,
    completed: source.completed,
    durationMs: boundedInteger(source.durationMs, 'Synthetic duration', MAX_SYNTHETIC_ANALYST_DURATION_MS),
    actions,
    backtracks,
    helpOpens: boundedInteger(source.helpOpens, 'Synthetic help-open count', MAX_SYNTHETIC_ANALYST_EVENT_COUNT),
    scrollReversals: boundedInteger(source.scrollReversals, 'Synthetic scroll-reversal count', MAX_SYNTHETIC_ANALYST_EVENT_COUNT),
    milestones: Object.freeze(milestones),
  });
}

export function buildSyntheticAnalystReport(rawResults: unknown) {
  if (!Array.isArray(rawResults) || rawResults.length === 0 || rawResults.length > MAX_SYNTHETIC_ANALYST_RESULTS) {
    throw new TypeError(`Synthetic analyst input must contain 1 to ${MAX_SYNTHETIC_ANALYST_RESULTS} results.`);
  }
  const results = rawResults.map(normalizeSyntheticAnalystResult);
  const resultKeys = results.map((result) => `${result.journeyId}:${result.device}:${result.evidenceState}`);
  if (new Set(resultKeys).size !== resultKeys.length) {
    throw new TypeError('Synthetic analyst input repeats a journey, device, and evidence-state result.');
  }
  const completed = results.filter((result) => result.completed).length;
  return Object.freeze({
    schema: SYNTHETIC_ANALYST_REPORT_SCHEMA,
    version: SYNTHETIC_ANALYST_RESULT_VERSION,
    journeyContract: Object.freeze({
      schema: SYNTHETIC_ANALYST_JOURNEY_SCHEMA,
      version: SYNTHETIC_ANALYST_JOURNEY_VERSION,
      digestSha256: SYNTHETIC_ANALYST_JOURNEY_DIGEST_SHA256,
    }),
    results: results.length,
    completed,
    completionRate: Number((completed / results.length).toFixed(4)),
    devices: Object.freeze({
      desktop: results.filter((result) => result.device === 'desktop').length,
      mobile: results.filter((result) => result.device === 'mobile').length,
    }),
    medians: Object.freeze({
      durationMs: median(results.map((result) => result.durationMs)),
      actions: median(results.map((result) => result.actions)),
      backtracks: median(results.map((result) => result.backtracks)),
      helpOpens: median(results.map((result) => result.helpOpens)),
      scrollReversals: median(results.map((result) => result.scrollReversals)),
    }),
    privacy: Object.freeze({
      identitiesRetained: false,
      targetsRetained: false,
      queriesRetained: false,
      pageContentsRetained: false,
      recordingsRetained: false,
      freeTextRetained: false,
      uploaded: false,
    }),
    interpretation: Object.freeze([
      'This report measures deterministic workflow execution against the declared fixture contract.',
      'Action and timing changes are regression leads that require inspection before a product conclusion.',
      'Review failure traces locally and preserve source-state boundaries when correcting a regression.',
    ]),
  });
}

export async function main(
  args = process.argv.slice(2),
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): Promise<number> {
  try {
    if (args.length === 1 && args[0] === '--plan') {
      output.write(`${JSON.stringify(buildSyntheticAnalystCoverageReport(), null, 2)}\n`);
      return 0;
    }
    if (args.length === 1 && args[0]?.startsWith('--template=')) {
      const [journeyId, device] = args[0].slice('--template='.length).split(':');
      if (!journeyId || (device !== 'desktop' && device !== 'mobile')) {
        throw new TypeError('Synthetic template must use --template=JOURNEY:desktop|mobile.');
      }
      output.write(`${JSON.stringify(buildSyntheticAnalystResultTemplate(journeyId, device), null, 2)}\n`);
      return 0;
    }
    if (args.length !== 1 || !args[0] || args[0].startsWith('-')) {
      throw new TypeError('Usage: node tools/synthetic-analyst-journeys.mts --plan | --template=JOURNEY:desktop|mobile | RESULTS.json');
    }
    const raw = await readBoundedRegularFile(args[0], {
      allowSymbolicLink: true,
      maximumBytes: MAX_SYNTHETIC_ANALYST_INPUT_BYTES,
      minimumBytes: 1,
      label: 'Synthetic analyst input',
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      throw new TypeError('Synthetic analyst input must be valid JSON.');
    }
    output.write(`${JSON.stringify(buildSyntheticAnalystReport(parsed), null, 2)}\n`);
    return 0;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'Synthetic analyst journey command failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
