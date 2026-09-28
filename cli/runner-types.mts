import type { ClassifiedQuery } from '../lib/classify.mts';
import type { LookupOptions } from '../lib/lookup.mts';
import type { BoundedTextStream } from './bulk.mts';
import type { CliProgressEvents } from './progress-events.mts';
import type { TerminalProgress } from './progress.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import type { TerminalPresentation, WritableTerminal } from './terminal-presentation.mts';
import type { canLaunchInteractiveCli, launchInteractiveCli } from './interactive-launcher.mts';
import type { cleanupPendingOutputFiles } from './output-file.mts';
import type { LookupCommandDependencies } from './lookup-command-runner.mts';
import type { BulkCommandDependencies } from './bulk-command-runner.mts';
import type { DiscoveryScanCommandDependencies } from './discovery-scan-command-runner.mts';
import type { NetworkCommandDependencies } from './network-command-runner.mts';
import type { ReviewCommandDependencies } from './review-command-runner.mts';
import type { AssuranceCommandDependencies } from './assurance-command-runner.mts';
import type { SupportCommandDependencies } from './support-command-runner.mts';
import type { WorkflowCommandDependencies } from './workflow-command-runner.mts';
import type { HistoryCommandDependencies } from './history-command-runner.mts';
import type { EvidenceCommandDependencies } from './evidence-command-runner.mts';

type WritableLike = WritableTerminal;

type LookupDependency = (
  classified: ClassifiedQuery,
  options?: LookupOptions,
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

/** Composition root: each command family declares its own injectable effects. */
type CliDependencies = LookupCommandDependencies &
  BulkCommandDependencies &
  DiscoveryScanCommandDependencies &
  NetworkCommandDependencies &
  ReviewCommandDependencies &
  AssuranceCommandDependencies &
  SupportCommandDependencies &
  WorkflowCommandDependencies &
  HistoryCommandDependencies &
  Partial<EvidenceCommandDependencies> & {
    stdout?: WritableLike;
    stderr?: WritableLike;
    stdin?: BoundedTextStream;
    readStdin?: () => string | Promise<string>;
    nowMs?: () => number;
    canLaunchInteractiveCli?: typeof canLaunchInteractiveCli;
    launchInteractiveCli?: typeof launchInteractiveCli;
    cleanupPendingOutputFiles?: typeof cleanupPendingOutputFiles;
  };

type CliCommandContext = Readonly<{
  packageVersion: string;
  stdout: WritableLike;
  stderr: WritableLike;
  terminal(value: string, color?: boolean): string;
  presentation(color: boolean): TerminalPresentation;
  writeStdout(value: string): void;
  writeBinaryOutput?(value: Uint8Array): void;
  writeStderr(value: string): void;
  readSingleInput(): Promise<string>;
  readInput(
    source: string | null | undefined,
    maximumBytes: number,
    label: string,
  ): Promise<string>;
  readHeaderInput(
    source: string | null | undefined,
    maximumBytes: number,
    label: string,
  ): Promise<string>;
  readPassphraseSource(source: string): Promise<string>;
  now(): string;
  beginProgress(message: string): TerminalProgress;
  endProgress(): void;
  withProgress<T>(message: string, operation: () => T | Promise<T>): Promise<T>;
  setEventProgress(progress: CliProgressEvents): void;
  setFailureLabel(label: string): void;
}>;

type CliWorkflowContext = CliCommandContext &
  Readonly<{
    executeCli(argv: readonly string[], dependencies?: CliDependencies): Promise<number>;
  }>;

export type {
  CliCommandContext,
  CliWorkflowContext,
  CliDependencies,
  DiscoveryGeneratorDependency,
  LookupDependency,
  WritableLike,
};
