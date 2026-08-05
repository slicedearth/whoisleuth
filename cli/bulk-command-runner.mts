import { createReadStream } from 'node:fs';

import { classifyQuery } from '../lib/classify.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import type { CliArguments } from './arguments.mts';
import { createBulkCheckpointWriter } from './bulk-checkpoint.mts';
import {
  MAX_BULK_INPUT_BYTES,
  parseBulkQueries,
  readTextStreamBounded,
  runBulkLookups,
} from './bulk.mts';
import { formatBulkCsv, formatBulkDomainList, formatBulkQueryList, selectBulkItems } from './bulk-output.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { buildCliBulkDocument, formatJsonDocument, formatJsonLines } from './formatters/json.mts';
import { formatTerminalBulk } from './formatters/terminal.mts';
import { buildCollectionPreflight, formatCollectionPreflight } from './collection-preflight.mts';
import { evaluateCliFailPolicies, formatFailPolicyNotice } from './fail-policy.mts';
import { createCliProgressEvents } from './progress-events.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';

type BulkCommandArguments = Extract<CliArguments, { action: 'bulk' }>;

async function runBulkCommand(
  args: BulkCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  const eventProgress = createCliProgressEvents(context.stderr, {
    command: 'bulk',
    enabled: args.events,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  context.setEventProgress(eventProgress);
  eventProgress.emit({ event: 'started' });

  let input: string;
  try {
    input = dependencies.readBulkInput
      ? await dependencies.readBulkInput(args.source)
      : await readTextStreamBounded(args.source
        ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
        : dependencies.stdin || process.stdin, MAX_BULK_INPUT_BYTES);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read bulk input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }

  const parsed = parseBulkQueries(input, { deep: args.deep });
  if (args.plan) {
    const document = buildCollectionPreflight({
      command: 'bulk', targetCount: parsed.queries.length, targetLimit: args.deep ? 50 : 500,
      deep: args.deep, concurrency: args.concurrency, output: args.output, checkpoint: false,
    });
    context.writeStdout(args.output === 'json' ? formatJsonDocument(document) : context.terminal(formatCollectionPreflight(document), args.color));
    return EXIT_CODES.SUCCESS;
  }
  const classify = dependencies.classifyQuery || classifyQuery;
  const checkpointWriter = dependencies.createBulkCheckpointWriter || createBulkCheckpointWriter;
  const checkpoint = args.checkpoint
    ? await checkpointWriter({
        path: args.checkpoint,
        queries: parsed.queries,
        deep: args.deep,
        resume: args.resume,
        classifyQuery: classify,
        ...(dependencies.now ? { now: dependencies.now } : {}),
      })
    : null;
  const indicator = context.beginProgress(`Collecting 0 of ${parsed.queries.length} targets`);
  let completed = checkpoint?.initialResults.length || 0;
  if (completed) indicator.update(`Resumed ${completed} of ${parsed.queries.length} targets`);
  let items: Awaited<ReturnType<typeof runBulkLookups>>;
  let checkpointFailure: unknown = null;
  try {
    items = await runBulkLookups(parsed.queries, {
      deep: args.deep,
      concurrency: args.concurrency,
      classifyQuery: classify,
      runUnifiedLookup: dependencies.runUnifiedLookup || runUnifiedLookup,
      ...(checkpoint ? { initialResults: checkpoint.initialResults } : {}),
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      onItemSettled: (item) => {
        completed += 1;
        indicator.update(`Collected ${completed} of ${parsed.queries.length} targets`);
        eventProgress.emit({ event: 'item_settled', index: item.index, ok: item.ok });
        checkpoint?.record(item);
      },
    });
  } finally {
    context.endProgress();
    try {
      await checkpoint?.flush();
    } catch (error) {
      checkpointFailure = error;
    }
  }

  const metadata = {
    deep: args.deep,
    duplicates: parsed.duplicates,
    generatedAt: context.now(),
    collectedTotal: items.length,
    filter: args.filter,
  };
  const selectedItems = selectBulkItems(items, args.filter);
  if (!args.quiet) {
    if (args.output === 'json') context.writeStdout(formatJsonDocument(buildCliBulkDocument(selectedItems, metadata)));
    else if (args.output === 'jsonl') context.writeStdout(formatJsonLines(selectedItems, metadata));
    else if (args.output === 'csv') context.writeStdout(formatBulkCsv(selectedItems));
    else if (args.output === 'domains') context.writeStdout(formatBulkDomainList(selectedItems));
    else if (args.output === 'queries') context.writeStdout(formatBulkQueryList(selectedItems));
    else context.writeStdout(context.terminal(formatTerminalBulk(selectedItems, metadata), args.color));
  }
  if (checkpointFailure) {
    eventProgress.emit({ event: 'warning', state: 'checkpoint_unavailable' });
    if (!eventProgress.enabled) {
      context.writeStderr(`Checkpoint warning: ${boundedCliErrorMessage(checkpointFailure, 'Checkpoint could not be written')}. Completed output is still available.\n`);
    }
  }
  const policyFindings = evaluateCliFailPolicies(buildCliBulkDocument(items, { ...metadata, filter: 'all' }), args.failOn || []);
  if (policyFindings.length && !eventProgress.enabled) context.writeStderr(formatFailPolicyNotice(policyFindings));
  const exitCode = checkpointFailure || items.some((item) => !item.ok) || policyFindings.length
    ? EXIT_CODES.PARTIAL_FAILURE
    : EXIT_CODES.SUCCESS;
  eventProgress.emit({ event: 'completed', exitCode });
  return exitCode;
}

export { runBulkCommand };
