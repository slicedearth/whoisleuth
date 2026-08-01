import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import type { CliArguments } from './arguments.mts';
import {
  DEFAULT_DISCOVERY_TLDS,
  MAX_DISCOVERY_DICTIONARY_BYTES,
  normalizeDiscoveryTlds,
  readDiscoveryDictionaryBounded,
} from './discover.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';

type DiscoveryOptions = Pick<
  Extract<CliArguments, { action: 'discover' }>,
  'dictionarySource' | 'familyText' | 'keyboardLayout' | 'preset' | 'seed' | 'tldText'
>;

async function generateDiscoveryCandidates(
  args: DiscoveryOptions,
  dependencies: CliDependencies,
  context: CliCommandContext,
) {
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
  return {
    generator,
    result,
    metadata,
    dictionaryDigestSha256: dictionaryText
      ? createHash('sha256').update(dictionaryText).digest('hex')
      : null,
  };
}

export { generateDiscoveryCandidates };
export type { DiscoveryOptions };
