export const CLI_COLLECTION_PREFLIGHT_SCHEMA = 'whoisleuth.cli.collection-preflight';
export const CLI_COLLECTION_PREFLIGHT_VERSION = 1;

type CollectionPreflightOptions = Readonly<{
  command: 'bulk' | 'discover-scan';
  targetCount: number;
  targetLimit: number;
  deep: boolean;
  concurrency: number;
  output: string;
  checkpoint: boolean;
  customResolvers?: boolean;
  allowlist?: boolean;
}>;

export function buildCollectionPreflight(options: CollectionPreflightOptions) {
  const sourceFamilies = options.deep
    ? ['RDAP', 'WHOIS', 'DNS', 'HTTP and static page identity', 'TLS', 'network allocation and routing context', 'configured optional threat sources']
    : ['RDAP', 'conditional DNS authority evidence'];
  return Object.freeze({
    schema: CLI_COLLECTION_PREFLIGHT_SCHEMA,
    version: CLI_COLLECTION_PREFLIGHT_VERSION,
    command: options.command,
    mode: options.deep ? 'deep' : 'fast',
    networkRequestsMade: false,
    scope: Object.freeze({
      selectedTargets: options.targetCount,
      commandTargetLimit: options.targetLimit,
      concurrency: options.concurrency,
      sourceFamilies: Object.freeze(sourceFamilies),
      exactRequestCountKnown: false,
      requestBoundary: 'Collector-specific timeouts, response limits, referrals, redirects, retries, registry policy and provider quotas remain enforced independently.',
    }),
    disclosure: Object.freeze([
      'Targets are sent only to the source families required by the selected mode and permitted by registry/provider policy.',
      ...(options.customResolvers ? ['Selected public DNS resolvers receive the DNS questions needed for collection.'] : ['The runtime DNS resolver receives DNS questions when DNS collection is required.']),
      ...(options.deep ? ['Target web infrastructure receives bounded homepage, favicon and TLS requests; configured optional providers can receive the documented target representation.'] : []),
    ]),
    persistence: Object.freeze({
      output: options.output,
      checkpoint: options.checkpoint,
      note: options.checkpoint
        ? 'A private resumable checkpoint is written locally; final output remains separate.'
        : 'No checkpoint is written. Final output is emitted only to the selected destination.',
    }),
    review: Object.freeze({
      allowlistAffectsPriorityOnly: options.allowlist === true,
      enforcementActions: false,
    }),
    limitations: Object.freeze([
      'This offline preflight reports collection families and hard target/concurrency bounds, not an exact raw request count.',
      'Redirects, WHOIS referrals, cache state, feature configuration, policy decisions, source availability and prerequisite evidence can change the requests actually made.',
      'A planned source may still return unsupported, unavailable, partial, rate-limited or inconclusive evidence.',
    ]),
  });
}

export function formatCollectionPreflight(document: ReturnType<typeof buildCollectionPreflight>): string {
  return [
    `WHOISleuth ${document.command} preflight`,
    `Mode              ${document.mode}`,
    `Selected targets  ${document.scope.selectedTargets} / ${document.scope.commandTargetLimit}`,
    `Concurrency       ${document.scope.concurrency}`,
    'Network requests  none',
    '',
    'Collector families',
    ...document.scope.sourceFamilies.map((source) => `  ${source}`),
    '',
    ...document.disclosure.map((item) => `Disclosure: ${item}`),
    ...document.limitations.map((item) => `Limitation: ${item}`),
    '',
  ].join('\n');
}
