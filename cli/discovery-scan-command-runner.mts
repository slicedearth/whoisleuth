import { classifyQuery } from '../lib/classify.mts';
import { normalizeSelectedDnsResolvers } from '../lib/dns-resolver-selection.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import type { CliArguments } from './arguments.mts';
import { createBulkCheckpointWriter } from './bulk-checkpoint.mts';
import type { BulkLookupResult } from './bulk.mts';
import {
  buildDiscoveryScanDocument,
  formatDiscoveryScanCsv,
  formatDiscoveryScanDomains,
  formatDiscoveryScanJsonLines,
  formatTerminalDiscoveryScan,
  parseDiscoveryScanAllowlist,
  runDiscoveryScanChunks,
} from './discovery-scan.mts';
import { updateDiscoveryObservationSnapshot } from './discovery-observation-snapshot.mts';
import { generateDiscoveryCandidates } from './discovery-workflow.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { formatJsonDocument } from './formatters/json.mts';
import { createCliProgressEvents } from './progress-events.mts';
import { buildCollectionPreflight, formatCollectionPreflight } from './collection-preflight.mts';
import { evaluateCliFailPolicies, formatFailPolicyNotice } from './fail-policy.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';

type DiscoveryScanArguments = Extract<CliArguments, { action: 'discover-scan' }>;

async function readAllowlist(
  source: string | null,
  dependencies: CliDependencies,
  context: CliCommandContext,
  classify: typeof classifyQuery,
): Promise<Set<string>> {
  if (!source) return new Set<string>();
  try {
    const text = dependencies.readDiscoveryAllowlist
      ? await dependencies.readDiscoveryAllowlist(source)
      : await context.readInput(source, 64 * 1024, 'Discovery scan allowlist');
    return parseDiscoveryScanAllowlist(text, classify);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Could not read discovery scan allowlist: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
  }
}

async function runDiscoveryScanCommand(
  args: DiscoveryScanArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  const eventProgress = createCliProgressEvents(context.stderr, {
    command: 'discover-scan',
    enabled: args.events,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  context.setEventProgress(eventProgress);
  eventProgress.emit({ event: 'started' });

  const { metadata: generationMetadata, result } = await generateDiscoveryCandidates(args, dependencies, context);
  const candidates = result.candidates
    .filter((candidate) => typeof candidate.domain === 'string' && candidate.domain.length > 0)
    .slice(0, args.scanLimit);
  if (!candidates.length) throw new CliUsageError('discover-scan did not generate any valid candidates to collect.');
  const queries = candidates.map((candidate) => String(candidate.domain));
  if (args.plan) {
    const document = buildCollectionPreflight({
      command: 'discover-scan', targetCount: queries.length, targetLimit: args.deep ? 50 : 500,
      deep: args.deep, concurrency: args.concurrency, output: args.output, checkpoint: false,
      customResolvers: Boolean(args.resolverText), allowlist: Boolean(args.allowlistSource),
    });
    context.writeStdout(args.output === 'json' ? formatJsonDocument(document) : context.terminal(formatCollectionPreflight(document), args.color));
    return EXIT_CODES.SUCCESS;
  }
  const classify = dependencies.classifyQuery || classifyQuery;
  let resolverServers: string[] = [];
  if (args.resolverText) {
    try {
      resolverServers = normalizeSelectedDnsResolvers(args.resolverText);
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, 'Invalid DNS resolver selection'));
    }
  }
  const allowlist = await readAllowlist(args.allowlistSource, dependencies, context, classify);
  const checkpointWriter = dependencies.createBulkCheckpointWriter || createBulkCheckpointWriter;
  const checkpoint = args.checkpoint
    ? await checkpointWriter({
        path: args.checkpoint,
        queries,
        deep: args.deep,
        resume: args.resume,
        classifyQuery: classify,
        ...(dependencies.now ? { now: dependencies.now } : {}),
      })
    : null;
  const indicator = context.beginProgress(`Collecting 0 of ${queries.length} generated candidates`);
  let completed = checkpoint?.initialResults.length || 0;
  const resumedItems = new Map((checkpoint?.initialResults ?? []).map((item) => [item.index, item]));
  const settledItems = new Map<number, BulkLookupResult>();
  if (completed) indicator.update(`Resumed ${completed} of ${queries.length} generated candidates`);
  let checkpointFailure: unknown = null;
  let items;
  try {
    items = await runDiscoveryScanChunks(queries, {
      deep: args.deep,
      chunkSize: args.chunkSize,
      concurrency: args.concurrency,
      classifyQuery: classify,
      runUnifiedLookup: dependencies.runUnifiedLookup || runUnifiedLookup,
      ...(resolverServers.length ? { dnsResolverServers: resolverServers } : {}),
      ...(checkpoint ? { initialResults: checkpoint.initialResults } : {}),
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      onItemSettled: (item) => {
        const observed = {
          ...item,
          observedAt: context.now(),
          collectionOrigin: 'current_run' as const,
        };
        settledItems.set(item.index, observed);
        completed += 1;
        indicator.update(`Collected ${completed} of ${queries.length} generated candidates`);
        eventProgress.emit({ event: 'item_settled', index: item.index, ok: item.ok });
        checkpoint?.record(observed);
      },
    });
    items = items.map((item) => resumedItems.get(item.index) ?? settledItems.get(item.index) ?? {
      ...item,
      observedAt: null,
      collectionOrigin: 'current_run' as const,
    });
  } finally {
    context.endProgress();
    try {
      await checkpoint?.flush();
    } catch (error) {
      checkpointFailure = error;
    }
  }

  const snapshot = args.observationSnapshot
    ? await updateDiscoveryObservationSnapshot(
        args.observationSnapshot,
        candidates,
        items,
        { deep: args.deep, resolverServers },
        generationMetadata.generatedAt,
      )
    : null;
  const document = buildDiscoveryScanDocument(candidates, items, {
    generatedAt: generationMetadata.generatedAt,
    seed: generationMetadata.seed,
    preset: generationMetadata.preset,
    keyboardLayout: generationMetadata.keyboardLayout,
    tlds: generationMetadata.tlds,
    mutationFamilies: generationMetadata.mutationFamilies,
    generatedCandidateCount: result.candidates.length,
    selectedCandidateCount: candidates.length,
    scanLimit: args.scanLimit,
    chunkSize: args.chunkSize,
    concurrency: args.concurrency,
    deep: args.deep,
    filter: args.filter,
    resolverServers,
  }, allowlist, snapshot);
  if (!args.quiet) {
    if (args.output === 'json') context.writeStdout(formatJsonDocument(document));
    else if (args.output === 'jsonl') context.writeStdout(formatDiscoveryScanJsonLines(document));
    else if (args.output === 'csv') context.writeStdout(formatDiscoveryScanCsv(document));
    else if (args.output === 'domains') context.writeStdout(formatDiscoveryScanDomains(document));
    else context.writeStdout(context.terminal(formatTerminalDiscoveryScan(document), args.color));
  }
  if (checkpointFailure) {
    eventProgress.emit({ event: 'warning', state: 'checkpoint_unavailable' });
    if (!eventProgress.enabled) {
      context.writeStderr(`Checkpoint warning: ${boundedCliErrorMessage(checkpointFailure, 'Checkpoint could not be written')}. Completed output is still available.\n`);
    }
  }
  const policyFindings = evaluateCliFailPolicies(document, args.failOn || []);
  if (policyFindings.length && !eventProgress.enabled) context.writeStderr(formatFailPolicyNotice(policyFindings));
  const exitCode = checkpointFailure || items.some((item) => !item.ok) || policyFindings.length
    ? EXIT_CODES.PARTIAL_FAILURE
    : EXIT_CODES.SUCCESS;
  eventProgress.emit({ event: 'completed', exitCode });
  return exitCode;
}

export { runDiscoveryScanCommand };
