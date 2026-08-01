import type { CliArguments } from './arguments.mts';
import { generateDiscoveryCandidates } from './discovery-workflow.mts';
import EXIT_CODES from './exit-codes.mts';
import {
  buildCliDiscoverDocument,
  formatDiscoverDomainList,
  formatDiscoverJsonLines,
  formatJsonDocument,
} from './formatters/json.mts';
import { updateDiscoverySnapshot } from './discovery-snapshot.mts';
import { formatTerminalDiscover } from './formatters/terminal.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';

type DiscoveryCommandArguments = Extract<CliArguments, { action: 'discover' }>;

async function runDiscoveryCommand(
  args: DiscoveryCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  const { dictionaryDigestSha256, generator, metadata, result } = await generateDiscoveryCandidates(
    args,
    dependencies,
    context,
  );
  const { seed } = metadata;
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
  const document = snapshot ? { ...baseDocument, snapshot } : baseDocument;
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
  return EXIT_CODES.SUCCESS;
}

export { runDiscoveryCommand };
