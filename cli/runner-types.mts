import type { ClassifiedQuery, classifyQuery } from '../lib/classify.mts';
import type { LookupSourceSettlement } from '../lib/lookup.mts';
import type { explainRiskScore } from '../lib/risk-scoring.mts';
import type { RegistryCompatibilityRow } from '../lib/registry-capabilities.mts';
import type { resolvePublicAddresses, safeFetch } from '../lib/safe-fetch.mts';
import type { whoisQuery } from '../lib/whois-transport.mts';
import type { validateDnssecChain } from '../lib/dnssec-chain-validation.mts';
import type { collectMailTransportReview } from '../lib/smtp-transport-review.mts';
import type { BoundedTextStream } from './bulk.mts';
import type { createBulkCheckpointWriter } from './bulk-checkpoint.mts';
import type { CliProgressEvents } from './progress-events.mts';
import type { TerminalProgress } from './progress.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import type { TerminalEnvironment, TerminalPresentation, WritableTerminal } from './terminal-presentation.mts';
import type { browseLookupDocument, browseLookupOperation, canBrowseLookup } from './lookup-browser.mts';
import type { canLaunchInteractiveCli, launchInteractiveCli } from './interactive-launcher.mts';
import type { cleanupPendingOutputFiles, writePrivateFile } from './output-file.mts';

type WritableLike = WritableTerminal;

type LookupDependency = (
  classified: ClassifiedQuery,
  options?: {
    fast?: boolean;
    compact?: boolean;
    onSourceSettled?: (settlement: LookupSourceSettlement) => void;
    signal?: AbortSignal;
    dnsResolverServers?: readonly string[];
  },
) => unknown | Promise<unknown>;

type DiscoveryGeneratorDependency = {
  MAX_GENERATION_TLDS: number;
  MUTATION_FAMILY_IDS: readonly string[];
  MUTATION_LABELS: Readonly<Record<string, string>>;
  normalizeMutationFamilyIds(raw: unknown): string[];
  normalizeCustomDictionaryTerms(raw: unknown): { values: string[]; rejectedCount: number };
  generateTyposquatCandidateSet(
    seed: string,
    tlds: string[],
    options: Record<string, unknown>,
  ): UnknownRecord & {
    inputValid: boolean;
    candidates: Array<{ domain: unknown; source: unknown; tld: unknown; mutationTypes: unknown }>;
  };
};

type CliDependencies = {
  stdout?: WritableLike;
  stderr?: WritableLike;
  stdin?: BoundedTextStream;
  readStdin?: () => string | Promise<string>;
  readBulkInput?: (source?: string | null) => string | Promise<string>;
  readCompareInput?: (source?: string | null) => string | Promise<string>;
  readDiffInput?: (source: string) => string | Promise<string>;
  readDiscoveryDictionary?: (source: string) => string | Promise<string>;
  readDiscoveryAllowlist?: (source: string) => string | Promise<string>;
  readExportInput?: (source?: string | null) => string | Promise<string>;
  readRiskCalibrationInput?: (source?: string | null) => string | Promise<string>;
  readArtifactInput?: (source?: string | null) => string | Promise<string>;
  readPassphraseFile?: (source: string) => string | Promise<string>;
  readPrivateKeyFile?: (source: string) => string | Promise<string>;
  readPublicKeyFile?: (source: string) => string | Promise<string>;
  readSourceReliabilityInput?: (source?: string | null) => string | Promise<string>;
  readMailReviewInput?: (source?: string | null) => string | Promise<string>;
  readMailTransportInput?: (source?: string | null) => string | Promise<string>;
  readTrustAnchorInput?: (source: string) => string | Promise<string>;
  now?: () => string;
  nowMs?: () => number;
  environment?: TerminalEnvironment;
  signal?: AbortSignal;
  classifyQuery?: typeof classifyQuery;
  runUnifiedLookup?: LookupDependency;
  searchCertificateTransparency?: (keyword: unknown) => unknown | Promise<unknown>;
  loadTyposquatGenerator?: () => Promise<DiscoveryGeneratorDependency>;
  normalizeAuditDomain?: (raw: unknown) => string | null;
  normalizeDkimSelectors?: (raw: unknown) => string[];
  checkDomainPosture?: (
    domain: string,
    options?: { dkimSelectors?: unknown[]; retiredDkimSelectors?: unknown[]; mailProtectionProfile?: unknown },
  ) => unknown | Promise<unknown>;
  fetchHomepage?: (domain: string) => unknown | Promise<unknown>;
  normalizeTlsHostname?: (value: unknown) => string | null;
  collectTlsIntelligence?: (hostname: string) => unknown | Promise<unknown>;
  validateDnssecChain?: typeof validateDnssecChain;
  collectMailTransportReview?: typeof collectMailTransportReview;
  registryCapabilityFor?: (value: unknown) => RegistryCompatibilityRow | null;
  registryCapabilitiesVersion?: number;
  explainRiskScore?: typeof explainRiskScore;
  riskModelVersion?: number;
  riskReviewThreshold?: number;
  loadRegistryComparison?: () => Promise<typeof import('../lib/registry-comparison.mts')>;
  loadEvidenceExport?: () => Promise<typeof import('../lib/evidence-export.mts')>;
  browseLookupDocument?: typeof browseLookupDocument;
  browseLookupOperation?: typeof browseLookupOperation;
  canBrowseLookup?: typeof canBrowseLookup;
  canLaunchInteractiveCli?: typeof canLaunchInteractiveCli;
  launchInteractiveCli?: typeof launchInteractiveCli;
  writePrivateFile?: typeof writePrivateFile;
  cleanupPendingOutputFiles?: typeof cleanupPendingOutputFiles;
  resolvePublicAddresses?: typeof resolvePublicAddresses;
  safeFetch?: typeof safeFetch;
  whoisQuery?: typeof whoisQuery;
  createBulkCheckpointWriter?: typeof createBulkCheckpointWriter;
};

type CliCommandContext = Readonly<{
  packageVersion: string;
  stdout: WritableLike;
  stderr: WritableLike;
  terminal(value: string, color?: boolean): string;
  presentation(color: boolean): TerminalPresentation;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
  readSingleInput(): Promise<string>;
  readInput(source: string | null | undefined, maximumBytes: number, label: string): Promise<string>;
  readPassphraseSource(source: string): Promise<string>;
  now(): string;
  beginProgress(message: string): TerminalProgress;
  endProgress(): void;
  withProgress<T>(message: string, operation: () => T | Promise<T>): Promise<T>;
  setEventProgress(progress: CliProgressEvents): void;
  setFailureLabel(label: string): void;
  executeCli(argv: readonly string[], dependencies?: CliDependencies): Promise<number>;
}>;

export type {
  CliCommandContext,
  CliDependencies,
  DiscoveryGeneratorDependency,
  LookupDependency,
  WritableLike,
};
