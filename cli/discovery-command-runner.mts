import type { CliArguments } from './arguments.mts';
import { generateDiscoveryCandidates, type DiscoveryDependencies } from './discovery-workflow.mts';
import EXIT_CODES from './exit-codes.mts';
import {
  buildCliDiscoverDocument,
  formatDiscoverDomainList,
  formatDiscoverJsonLines,
  formatJsonDocument,
} from './formatters/json.mts';
import { updateDiscoverySnapshot } from './discovery-snapshot.mts';
import { formatTerminalDiscover } from './formatters/terminal.mts';
import type { CliCommandContext } from './runner-types.mts';
import { createHash } from 'node:crypto';
import { MAX_POPULARITY_LIST_BYTES, POPULARITY_LIMITATION, readPopularityRanks } from '../packages/analysis/popularity-list.mts';
import { CliUsageError } from './errors.mts';

/** Ranks from a selected local list; nothing is fetched and the list itself is not copied into output. */
async function popularityContext(source: string, domains: readonly string[], context: CliCommandContext) {
  const text = await context.readInput(source, MAX_POPULARITY_LIST_BYTES, 'Popularity list');
  let list;
  try { list = readPopularityRanks(text, domains); }
  catch (error) { throw new CliUsageError(error instanceof Error ? error.message : 'The popularity list is invalid.'); }
  const ranked = domains.flatMap((domain) => {
    const rank = list.ranks.get(domain);
    return rank === undefined ? [] : [{ domain, rank }];
  }).sort((left, right) => left.rank - right.rank || left.domain.localeCompare(right.domain));
  return Object.freeze({
    listSha256: createHash('sha256').update(text).digest('hex'),
    entries: list.entries, rejectedLines: list.rejectedLines, truncated: list.truncated,
    ranked, limitation: POPULARITY_LIMITATION,
  });
}

type DiscoveryCommandArguments = Extract<CliArguments, { action: 'discover' }>;

async function runDiscoveryCommand(
  args: DiscoveryCommandArguments,
  dependencies: DiscoveryDependencies,
  context: CliCommandContext,
): Promise<number> {
  const { dictionaryDigestSha256, generator, metadata, result } = await generateDiscoveryCandidates(
    args,
    dependencies,
    context,
  );
  const { seed } = metadata;
  // Read and validate every selected input before the snapshot, the first durable write.
  const popularity = args.popularityListSource
    ? await popularityContext(args.popularityListSource,
      result.candidates.flatMap((candidate) => typeof candidate.domain === 'string' ? [candidate.domain] : []), context)
    : null;
  const snapshot = args.snapshotSource
    ? await updateDiscoverySnapshot(
        args.snapshotSource,
        result.candidates.map((candidate) => candidate.domain),
        {
          seed,
          preset: args.preset,
          keyboardLayout: args.keyboardLayout,
          tlds: metadata.tlds,
          mutationFamilies: metadata.mutationFamilies,
          dictionaryDigestSha256,
        },
        metadata.generatedAt,
      )
    : null;
  const baseDocument = buildCliDiscoverDocument(seed, result, metadata);
  const document = { ...baseDocument, ...(snapshot ? { snapshot } : {}), ...(popularity ? { popularity } : {}) };
  if (!args.quiet) {
    if (args.output === 'json') context.writeStdout(formatJsonDocument(document));
    else if (args.output === 'jsonl') context.writeStdout(formatDiscoverJsonLines(result.candidates, metadata));
    else if (args.output === 'domains') context.writeStdout(formatDiscoverDomainList(result.candidates));
    else context.writeStdout(context.terminal(formatTerminalDiscover(document, generator.MUTATION_LABELS), args.color));
  }
  if (snapshot && ['domains', 'jsonl'].includes(args.output)) {
    context.writeStderr(
      `Discovery snapshot: ${snapshot.baselineCreated ? 'baseline created' : `${snapshot.added.length} added, ${snapshot.removed.length} removed`} (${snapshot.currentCandidateCount} current).\n`,
    );
  }
  if (popularity && ['domains', 'jsonl'].includes(args.output)) {
    context.writeStderr(`Popularity list: ${popularity.ranked.length} of ${result.candidates.length} candidates ranked.\n`);
  }
  return EXIT_CODES.SUCCESS;
}

export { runDiscoveryCommand };
