#!/usr/bin/env node

// Aggregates deliberately recorded first-use task outcomes. The input contract
// excludes participant identity, targets, queries, recordings, and free notes,
// so the report can guide UX work without becoming product analytics.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIRST_USE_ANALYST_STUDY_TASKS,
  FIRST_USE_STUDY_TASK_SCHEMA,
  FIRST_USE_STUDY_TASK_VERSION,
} from '../fixtures/first-use-analyst-study-tasks.mts';

export const FIRST_USE_STUDY_SESSION_SCHEMA = 'whoisleuth.first-use-study-session';
export const FIRST_USE_STUDY_REPORT_SCHEMA = 'whoisleuth.first-use-study-report';
export const FIRST_USE_STUDY_VERSION = 1;
export const MAX_FIRST_USE_STUDY_INPUT_BYTES = 256 * 1024;
export const MAX_FIRST_USE_STUDY_SESSIONS = 40;
export const MAX_FIRST_USE_STUDY_OBSERVATIONS = 20;
export const MAX_FIRST_USE_STUDY_SECONDS = 4 * 60 * 60;
export const MAX_FIRST_USE_STUDY_EVENT_COUNT = 100;

type Device = 'desktop' | 'mobile';
type TerminologyIssue =
  | 'source_state'
  | 'collection_depth'
  | 'risk_vs_evidence'
  | 'pivot_vs_attribution'
  | 'case_vs_workspace'
  | 'recipe_progress'
  | 'archive_boundary'
  | 'other_controlled';
type UnknownRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type StudyObservation = Readonly<{
  taskId: string;
  completed: boolean;
  durationSeconds: number;
  firstUsefulPivotSeconds: number | null;
  errors: number;
  backtracks: number;
  terminologyIssues: readonly TerminologyIssue[];
}>;
type StudySession = Readonly<{
  taskVersion: typeof FIRST_USE_STUDY_TASK_VERSION;
  taskDigestSha256: string;
  device: Device;
  observations: readonly StudyObservation[];
}>;

const TASK_IDS = new Set(FIRST_USE_ANALYST_STUDY_TASKS.map((task) => task.id));
const TERMINOLOGY_ISSUES = new Set<TerminologyIssue>([
  'source_state',
  'collection_depth',
  'risk_vs_evidence',
  'pivot_vs_attribution',
  'case_vs_workspace',
  'recipe_progress',
  'archive_boundary',
  'other_controlled',
]);
const SESSION_KEYS = new Set([
  'schema',
  'version',
  'taskVersion',
  'taskDigestSha256',
  'device',
  'observations',
]);
const OBSERVATION_KEYS = new Set([
  'taskId',
  'completed',
  'durationSeconds',
  'firstUsefulPivotSeconds',
  'errors',
  'backtracks',
  'terminologyIssues',
]);
export const FIRST_USE_STUDY_TASK_DIGEST_SHA256 = createHash('sha256')
  .update(JSON.stringify({
    schema: FIRST_USE_STUDY_TASK_SCHEMA,
    version: FIRST_USE_STUDY_TASK_VERSION,
    tasks: FIRST_USE_ANALYST_STUDY_TASKS,
  }), 'utf8')
  .digest('hex');

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function assertExactKeys(value: UnknownRecord, expected: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = [...expected].filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    throw new TypeError(`${label} must use only the documented fields.`);
  }
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`${label} must be an integer from 0 to ${maximum}.`);
  }
  return value as number;
}

function optionalSeconds(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  return boundedInteger(value, label, MAX_FIRST_USE_STUDY_SECONDS);
}

function normalizeObservation(value: unknown, device: Device): StudyObservation {
  const source = record(value);
  if (!source || typeof source.taskId !== 'string' || !TASK_IDS.has(source.taskId)) {
    throw new TypeError('Study observations must reference a current task id.');
  }
  assertExactKeys(source, OBSERVATION_KEYS, 'Study observation');
  const task = FIRST_USE_ANALYST_STUDY_TASKS.find((candidate) => candidate.id === source.taskId);
  if (!task?.allowedDevices.includes(device)) {
    throw new TypeError(`Task ${source.taskId} is not available on ${device}.`);
  }
  if (typeof source.completed !== 'boolean') {
    throw new TypeError('Study observation completion must be boolean.');
  }
  if (!Array.isArray(source.terminologyIssues) || source.terminologyIssues.length > 8) {
    throw new TypeError('Study terminology issues must contain at most 8 controlled values.');
  }
  const issues = [...new Set(source.terminologyIssues.map((item) => {
    if (typeof item !== 'string' || !TERMINOLOGY_ISSUES.has(item as TerminologyIssue)) {
      throw new TypeError('Study terminology issues must use the controlled vocabulary.');
    }
    return item as TerminologyIssue;
  }))].sort();
  const durationSeconds = boundedInteger(
    source.durationSeconds,
    'Study duration',
    MAX_FIRST_USE_STUDY_SECONDS,
  );
  const firstUsefulPivotSeconds = optionalSeconds(
    source.firstUsefulPivotSeconds,
    'Time to first useful pivot',
  );
  if (firstUsefulPivotSeconds !== null && firstUsefulPivotSeconds > durationSeconds) {
    throw new TypeError('Time to first useful pivot must not exceed task duration.');
  }
  return Object.freeze({
    taskId: source.taskId,
    completed: source.completed,
    durationSeconds,
    firstUsefulPivotSeconds,
    errors: boundedInteger(source.errors, 'Study error count', MAX_FIRST_USE_STUDY_EVENT_COUNT),
    backtracks: boundedInteger(source.backtracks, 'Study backtrack count', MAX_FIRST_USE_STUDY_EVENT_COUNT),
    terminologyIssues: Object.freeze(issues),
  });
}

function normalizeSession(value: unknown): StudySession {
  const source = record(value);
  if (!source || source.schema !== FIRST_USE_STUDY_SESSION_SCHEMA
    || source.version !== FIRST_USE_STUDY_VERSION
    || source.taskVersion !== FIRST_USE_STUDY_TASK_VERSION
    || source.taskDigestSha256 !== FIRST_USE_STUDY_TASK_DIGEST_SHA256
    || (source.device !== 'desktop' && source.device !== 'mobile')
    || !Array.isArray(source.observations)
    || source.observations.length === 0
    || source.observations.length > MAX_FIRST_USE_STUDY_OBSERVATIONS) {
    throw new TypeError('First-use study session uses an unsupported or invalid contract.');
  }
  const device = source.device;
  const observations = source.observations.map((item) => normalizeObservation(item, device));
  if (new Set(observations.map((item) => item.taskId)).size !== observations.length) {
    throw new TypeError('A study session must not repeat a task.');
  }
  assertExactKeys(source, SESSION_KEYS, 'Study session');
  return Object.freeze({
    taskVersion: FIRST_USE_STUDY_TASK_VERSION,
    taskDigestSha256: FIRST_USE_STUDY_TASK_DIGEST_SHA256,
    device,
    observations: Object.freeze(observations),
  });
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number((((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2).toFixed(1))
    : sorted[middle] as number;
}

export function buildFirstUseStudyReport(rawSessions: unknown) {
  if (!Array.isArray(rawSessions) || rawSessions.length === 0
    || rawSessions.length > MAX_FIRST_USE_STUDY_SESSIONS) {
    throw new TypeError(`Study input must contain 1 to ${MAX_FIRST_USE_STUDY_SESSIONS} sessions.`);
  }
  const sessions = rawSessions.map(normalizeSession);
  const canonicalSessions = sessions.map((session) => JSON.stringify(session));
  if (new Set(canonicalSessions).size !== canonicalSessions.length) {
    throw new TypeError('Study input contains a duplicate canonical session.');
  }
  const taskRows = (['desktop', 'mobile'] as const).flatMap((device) => (
    FIRST_USE_ANALYST_STUDY_TASKS.map((task) => {
      const observations = sessions
        .filter((session) => session.device === device)
        .flatMap((session) => session.observations)
        .filter((observation) => observation.taskId === task.id);
      if (!observations.length) return null;
      const completed = observations.filter((observation) => observation.completed).length;
      const terminologyIssues = [...TERMINOLOGY_ISSUES].map((issue) => Object.freeze({
        issue,
        count: observations.filter((observation) => observation.terminologyIssues.includes(issue)).length,
      })).filter((item) => item.count > 0);
      return Object.freeze({
        device,
        taskId: task.id,
        attempts: observations.length,
        completed,
        completionRate: Number((completed / observations.length).toFixed(4)),
        medianDurationSeconds: median(observations.map((observation) => observation.durationSeconds)),
        medianFirstUsefulPivotSeconds: median(observations.flatMap((observation) => (
          observation.firstUsefulPivotSeconds === null ? [] : [observation.firstUsefulPivotSeconds]
        ))),
        errors: observations.reduce((total, observation) => total + observation.errors, 0),
        backtracks: observations.reduce((total, observation) => total + observation.backtracks, 0),
        terminologyIssues: Object.freeze(terminologyIssues),
      });
    }).filter((row) => row !== null)
  ));
  return Object.freeze({
    schema: FIRST_USE_STUDY_REPORT_SCHEMA,
    version: FIRST_USE_STUDY_VERSION,
    taskContract: Object.freeze({
      schema: FIRST_USE_STUDY_TASK_SCHEMA,
      version: FIRST_USE_STUDY_TASK_VERSION,
      digestSha256: FIRST_USE_STUDY_TASK_DIGEST_SHA256,
    }),
    sessions: sessions.length,
    devices: Object.freeze({
      desktop: sessions.filter((session) => session.device === 'desktop').length,
      mobile: sessions.filter((session) => session.device === 'mobile').length,
    }),
    tasks: Object.freeze(taskRows),
    privacy: Object.freeze({
      participantIdentityRetained: false,
      targetsRetained: false,
      queriesRetained: false,
      recordingsRetained: false,
      freeTextRetained: false,
      uploaded: false,
    }),
    interpretation: Object.freeze([
      'This report describes a small moderated sample and is not product analytics.',
      'Compare desktop and mobile only when both use the same task script and supplied test material.',
      'Completion time alone does not establish usability; review errors, backtracking, and controlled terminology issues together.',
    ]),
  });
}

export function buildFirstUseStudySessionTemplate(device: Device) {
  return Object.freeze({
    schema: FIRST_USE_STUDY_SESSION_SCHEMA,
    version: FIRST_USE_STUDY_VERSION,
    taskVersion: FIRST_USE_STUDY_TASK_VERSION,
    taskDigestSha256: FIRST_USE_STUDY_TASK_DIGEST_SHA256,
    device,
    observations: Object.freeze(FIRST_USE_ANALYST_STUDY_TASKS
      .filter((task) => task.allowedDevices.includes(device))
      .map((task) => Object.freeze({
        taskId: task.id,
        completed: false,
        durationSeconds: 0,
        firstUsefulPivotSeconds: null,
        errors: 0,
        backtracks: 0,
        terminologyIssues: Object.freeze([]),
      }))),
  });
}

export async function main(
  args = process.argv.slice(2),
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): Promise<number> {
  try {
    if (args.length === 1 && (args[0] === '--template=desktop' || args[0] === '--template=mobile')) {
      const device = args[0].endsWith('desktop') ? 'desktop' : 'mobile';
      output.write(`${JSON.stringify(buildFirstUseStudySessionTemplate(device), null, 2)}\n`);
      return 0;
    }
    if (args.length !== 1 || !args[0] || args[0].startsWith('-')) {
      throw new TypeError('Usage: node tools/first-use-analyst-study.mts SESSIONS.json | --template=desktop | --template=mobile');
    }
    const raw = await readFile(args[0]);
    if (raw.byteLength === 0 || raw.byteLength > MAX_FIRST_USE_STUDY_INPUT_BYTES) {
      throw new TypeError(`Study input must be between 1 byte and ${MAX_FIRST_USE_STUDY_INPUT_BYTES} bytes.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      throw new TypeError('Study input must be valid JSON.');
    }
    output.write(`${JSON.stringify(buildFirstUseStudyReport(parsed), null, 2)}\n`);
    return 0;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'First-use study aggregation failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
