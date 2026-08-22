import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';

import { recordOrNull } from '../lib/bounded-contract-normalizers.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import type { BulkLookupResult } from './bulk.mts';
import { boundedCliInputError, CliUsageError } from './errors.mts';
import { writePrivateFile } from './output-file.mts';

export const CLI_BULK_CHECKPOINT_SCHEMA = 'whoisleuth.cli.bulk-checkpoint';
export const CLI_BULK_CHECKPOINT_VERSION = 2;
export const MAX_BULK_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_CHECKPOINT_JSON_DEPTH = 12;
const MAX_CHECKPOINT_OBJECT_KEYS = 256;
const MAX_CHECKPOINT_ARRAY_ITEMS = 1_024;
const MAX_CHECKPOINT_STRING_LENGTH = 32_768;
const COMPACT_RESULT_KEYS = new Set(['availability', 'diagnostics']);

type BulkCheckpointDocument = Readonly<{
  schema: typeof CLI_BULK_CHECKPOINT_SCHEMA;
  version: number;
  mode: 'deep' | 'fast';
  inputDigestSha256: string;
  queryCount: number;
  startedAt: string;
  updatedAt: string;
  results: readonly BulkLookupResult[];
}>;

type BulkCheckpointWriter = Readonly<{
  initialResults: readonly BulkLookupResult[];
  record(result: BulkLookupResult): void;
  flush(): Promise<void>;
}>;

type ClassifyQuery = (query: string) => ClassifiedQuery;

function checkpointDigest(queries: readonly string[], deep: boolean): string {
  return createHash('sha256')
    .update(deep ? 'deep\n' : 'fast\n')
    .update(queries.join('\n'))
    .digest('hex');
}

function normalizedTimestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

function isBoundedCheckpointJson(value: unknown, depth = 0): boolean {
  if (depth > MAX_CHECKPOINT_JSON_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_CHECKPOINT_STRING_LENGTH;
  if (Array.isArray(value)) {
    return value.length <= MAX_CHECKPOINT_ARRAY_ITEMS
      && value.every((item) => isBoundedCheckpointJson(item, depth + 1));
  }
  const object = recordOrNull(value);
  if (!object) return false;
  const entries = Object.entries(object);
  return entries.length <= MAX_CHECKPOINT_OBJECT_KEYS
    && entries.every(([key, item]) => key.length <= 128 && isBoundedCheckpointJson(item, depth + 1));
}

function normalizeCompactResult(value: unknown): Record<string, unknown> | null {
  const result = recordOrNull(value);
  if (!result || !isBoundedCheckpointJson(result)) return null;
  const keys = Object.keys(result);
  if (keys.length !== COMPACT_RESULT_KEYS.size || keys.some((key) => !COMPACT_RESULT_KEYS.has(key))) return null;
  if (!recordOrNull(result.availability) || !recordOrNull(result.diagnostics)) return null;
  return result;
}

function normalizeCheckpointResult(
  value: unknown,
  queries: readonly string[],
  classifyQuery: ClassifyQuery,
): BulkLookupResult | null {
  const item = recordOrNull(value);
  const index = item?.index;
  if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= queries.length) return null;
  const query = queries[Number(index)];
  if (typeof item?.query !== 'string' || item.query !== query) return null;
  const observedAt = item.observedAt === null
    ? null
    : normalizedTimestamp(item.observedAt) ?? undefined;
  if (observedAt === undefined) return null;
  if (item.ok === false) {
    if (typeof item.error !== 'string' || !item.error || item.error.length > 300) return null;
    return { index: Number(index), query, ok: false, error: item.error, observedAt };
  }
  const result = normalizeCompactResult(item.result);
  if (item.ok !== true || !result) return null;
  const classified = classifyQuery(query);
  const storedClassified = recordOrNull(item.classified);
  if (storedClassified?.type !== classified.type || storedClassified.value !== classified.value) return null;
  return { index: Number(index), query, ok: true, classified, result, observedAt };
}

function parseBulkCheckpoint(
  text: unknown,
  options: Readonly<{ queries: readonly string[]; deep: boolean; classifyQuery: ClassifyQuery }>,
): BulkCheckpointDocument {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BULK_CHECKPOINT_BYTES) {
    throw new CliUsageError(`Bulk checkpoint input is limited to ${MAX_BULK_CHECKPOINT_BYTES} bytes.`);
  }
  const normalized = text.replace(/^\uFEFF/u, '');
  let parsed: unknown;
  try {
    scanBoundedJson(normalized);
    parsed = JSON.parse(normalized);
  } catch {
    throw new CliUsageError('Bulk checkpoint must be valid bounded JSON without duplicate keys.');
  }
  const document = recordOrNull(parsed);
  const expectedDigest = checkpointDigest(options.queries, options.deep);
  const version = typeof document?.version === 'number' && Number.isSafeInteger(document.version)
    ? document.version
    : 0;
  if (document?.schema !== CLI_BULK_CHECKPOINT_SCHEMA || version !== CLI_BULK_CHECKPOINT_VERSION) {
    throw new CliUsageError(`Bulk checkpoint must use ${CLI_BULK_CHECKPOINT_SCHEMA} version ${CLI_BULK_CHECKPOINT_VERSION}.`);
  }
  if (document.mode !== (options.deep ? 'deep' : 'fast')
    || document.inputDigestSha256 !== expectedDigest
    || document.queryCount !== options.queries.length) {
    throw new CliUsageError('Bulk checkpoint does not match the current input or scan mode.');
  }
  const startedAt = normalizedTimestamp(document.startedAt);
  const updatedAt = normalizedTimestamp(document.updatedAt);
  if (!startedAt || !updatedAt || !Array.isArray(document.results)) {
    throw new CliUsageError('Bulk checkpoint metadata is invalid.');
  }
  const results: BulkLookupResult[] = [];
  const seen = new Set<number>();
  for (const candidate of document.results.slice(0, options.queries.length + 1)) {
    const result = normalizeCheckpointResult(candidate, options.queries, options.classifyQuery);
    if (!result || seen.has(result.index)) throw new CliUsageError('Bulk checkpoint contains an invalid or duplicate result.');
    seen.add(result.index);
    results.push({ ...result, collectionOrigin: 'resumed_checkpoint' });
  }
  return {
    schema: CLI_BULK_CHECKPOINT_SCHEMA,
    version: CLI_BULK_CHECKPOINT_VERSION,
    mode: options.deep ? 'deep' : 'fast',
    inputDigestSha256: expectedDigest,
    queryCount: options.queries.length,
    startedAt,
    updatedAt,
    results: results.sort((left, right) => left.index - right.index),
  };
}

async function readCheckpointFile(path: string): Promise<string> {
  try {
    return await readBoundedRegularTextFile(path, {
      maximumBytes: MAX_BULK_CHECKPOINT_BYTES,
      label: 'Bulk checkpoint input',
      allowSymbolicLink: true,
    });
  } catch (error) {
    throw boundedCliInputError(error, 'Bulk checkpoint input');
  }
}

async function checkpointFileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'ENOENT') return false;
    throw boundedCliInputError(error, 'Bulk checkpoint input');
  }
}

async function createBulkCheckpointWriter(options: Readonly<{
  path: string;
  queries: readonly string[];
  deep: boolean;
  resume: boolean;
  classifyQuery: ClassifyQuery;
  now?: () => string;
  writeFile?: typeof writePrivateFile;
}>): Promise<BulkCheckpointWriter> {
  const now = options.now || (() => new Date().toISOString());
  const writeCheckpoint = options.writeFile ?? writePrivateFile;
  const exists = await checkpointFileExists(options.path);
  if (options.resume && !exists) throw new CliUsageError('Bulk checkpoint does not exist; remove --resume to start a new checkpoint.');
  if (!options.resume && exists) throw new CliUsageError('Bulk checkpoint already exists; use --resume or choose another path.');
  const resumed = options.resume
    ? parseBulkCheckpoint(await readCheckpointFile(options.path), options)
    : null;
  const currentTimestamp = (): string => {
    const timestamp = normalizedTimestamp(now());
    if (!timestamp) throw new CliUsageError('Bulk checkpoint collection time is invalid.');
    return timestamp;
  };
  const startedAt = resumed?.startedAt || currentTimestamp();
  const results = new Map<number, BulkLookupResult>((resumed?.results || []).map((item) => [item.index, item]));
  let activeWrite: Promise<void> | null = null;
  let dirty = false;
  let writeFailure: unknown = null;
  let created = resumed !== null;

  function document(): BulkCheckpointDocument {
    const updatedAt = currentTimestamp();
    return {
      schema: CLI_BULK_CHECKPOINT_SCHEMA,
      version: CLI_BULK_CHECKPOINT_VERSION,
      mode: options.deep ? 'deep' : 'fast',
      inputDigestSha256: checkpointDigest(options.queries, options.deep),
      queryCount: options.queries.length,
      startedAt,
      updatedAt,
      results: [...results.values()]
        .sort((left, right) => left.index - right.index)
        .map(({ collectionOrigin: _collectionOrigin, ...result }) => result),
    };
  }

  async function drainWrites(): Promise<void> {
    while (dirty && !writeFailure) {
      dirty = false;
      try {
        const content = `${JSON.stringify(document(), null, 2)}\n`;
        if (Buffer.byteLength(content, 'utf8') > MAX_BULK_CHECKPOINT_BYTES) {
          throw new CliUsageError(`Bulk checkpoints are limited to ${MAX_BULK_CHECKPOINT_BYTES} bytes.`);
        }
        await writeCheckpoint(options.path, content, {
          force: created,
          existingFileMessage: 'Bulk checkpoint already exists; use --resume or choose another path.',
        });
        created = true;
      } catch (error) {
        writeFailure = error;
      }
    }
  }

  function scheduleWrite(): void {
    dirty = true;
    if (activeWrite || writeFailure) return;
    const pending = drainWrites();
    activeWrite = pending;
    void pending.then(
      () => {
        if (activeWrite === pending) activeWrite = null;
        if (dirty && !writeFailure) scheduleWrite();
      },
      (error) => {
        writeFailure ||= error;
        if (activeWrite === pending) activeWrite = null;
      },
    );
  }

  if (!resumed) scheduleWrite();
  return Object.freeze({
    initialResults: Object.freeze([...results.values()].sort((left, right) => left.index - right.index)),
    record(result: BulkLookupResult): void {
      const observedAt = normalizedTimestamp(result.observedAt) ?? normalizedTimestamp(now());
      if (!observedAt) {
        writeFailure ||= new CliUsageError('Bulk checkpoint collection time is invalid.');
        return;
      }
      const normalized = normalizeCheckpointResult(
        { ...result, observedAt },
        options.queries,
        options.classifyQuery,
      );
      if (!normalized) {
        writeFailure ||= new CliUsageError('Bulk checkpoint result is not a bounded compact lookup result.');
        return;
      }
      results.set(normalized.index, { ...normalized, collectionOrigin: 'current_run' });
      scheduleWrite();
    },
    async flush(): Promise<void> {
      while (activeWrite || dirty) {
        if (!activeWrite) scheduleWrite();
        if (activeWrite) await activeWrite;
      }
      if (writeFailure) throw writeFailure;
    },
  });
}

export {
  createBulkCheckpointWriter,
  parseBulkCheckpoint,
};
export type { BulkCheckpointDocument, BulkCheckpointWriter };
