import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

import type { CliArguments } from './arguments.mts';
import {
  DEFAULT_DISCOVERY_TLDS,
  MAX_DISCOVERY_DICTIONARY_BYTES,
  normalizeDiscoveryTlds,
  readDiscoveryDictionaryBounded,
} from './discover.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
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
  const seed = args.seed || await context.readSingleInput();
  if (!seed) throw new CliUsageError('discover requires one brand label or domain as an argument or on stdin.');
  const loadGenerator = dependencies.loadTyposquatGenerator || (() => import('../lib/typosquat-generator.mts'));
  const generator = await loadGenerator();
  const tlds = normalizeDiscoveryTlds(
    args.tldText || DEFAULT_DISCOVERY_TLDS.join(','),
    generator.MAX_GENERATION_TLDS,
  );
  const requestedFamilies = args.familyText
    ? [...new Set(args.familyText.split(',').map((value) => value.trim()).filter(Boolean))]
    : [];
  const mutationFamilies = args.preset === 'custom'
    ? generator.normalizeMutationFamilyIds(requestedFamilies)
    : [];
  if (args.preset === 'custom'
    && (!mutationFamilies.length || mutationFamilies.length !== requestedFamilies.length)) {
    throw new CliUsageError(`--families requires one or more supported IDs: ${generator.MUTATION_FAMILY_IDS.join(', ')}.`);
  }

  let dictionaryText = '';
  if (args.dictionarySource) {
    if (args.preset === 'custom'
      && !mutationFamilies.includes('dictionary')
      && !mutationFamilies.includes('dictionary_token_replacement')) {
      throw new CliUsageError('--dictionary requires a dictionary mutation family.');
    }
    try {
      dictionaryText = dependencies.readDiscoveryDictionary
        ? await dependencies.readDiscoveryDictionary(args.dictionarySource)
        : await readDiscoveryDictionaryBounded(
          createReadStream(args.dictionarySource, { highWaterMark: MAX_DISCOVERY_DICTIONARY_BYTES }),
          MAX_DISCOVERY_DICTIONARY_BYTES,
        );
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read discovery dictionary: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    const normalizedDictionary = generator.normalizeCustomDictionaryTerms(dictionaryText);
    if (!normalizedDictionary.values.length) {
      throw new CliUsageError('The discovery dictionary did not contain any valid terms.');
    }
  }

  const result = generator.generateTyposquatCandidateSet(seed, tlds, {
    preset: args.preset,
    keyboardLayout: args.keyboardLayout,
    dictionaryTerms: dictionaryText,
    ...(args.preset === 'custom' ? { mutationTypes: mutationFamilies } : {}),
  });
  if (!result.inputValid) {
    throw new CliUsageError('discover requires a valid brand label or domain with one suffix label.');
  }
  const normalizedDictionary = generator.normalizeCustomDictionaryTerms(dictionaryText);
  const metadata = {
    generatedAt: context.now(),
    seed,
    preset: args.preset,
    keyboardLayout: args.keyboardLayout,
    tlds,
    mutationFamilies,
    dictionaryTermCount: normalizedDictionary.values.length,
    rejectedDictionaryTermCount: normalizedDictionary.rejectedCount,
  };
  const snapshot = args.snapshotSource
    ? await updateDiscoverySnapshot(
        args.snapshotSource,
        result.candidates.map((candidate) => candidate.domain),
        {
          seed,
          preset: args.preset,
          keyboardLayout: args.keyboardLayout,
          tlds,
          mutationFamilies,
          dictionaryDigestSha256: dictionaryText
            ? createHash('sha256').update(dictionaryText).digest('hex')
            : null,
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
