#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import {
  MAX_PROFILE_STORE_BYTES,
} from '../frontend/src/lib/analysis/brand-profile-model.js';
import {
  MAX_CAMPAIGN_STORE_BYTES,
} from '../frontend/src/lib/analysis/campaign-model.js';
import {
  MAX_CASE_STORE_BYTES,
} from '../frontend/src/lib/analysis/case-model.js';
import {
  MAX_CT_HISTORY_STORE_BYTES,
} from '../frontend/src/lib/analysis/ct-history.js';
import {
  MAX_RULE_STORE_BYTES,
} from '../frontend/src/lib/analysis/detection-rule-model.js';
import {
  MAX_SHORTLIST_STORE_BYTES,
} from '../frontend/src/lib/analysis/shortlist-model.js';
import {
  MAX_WATCHLIST_STORE_BYTES,
} from '../frontend/src/lib/analysis/watchlist-store.js';

type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{
  now?: () => Date;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

type StoreAssessment = Readonly<{
  id: string;
  label: string;
  maximumBytes: number;
  access: 'whole_document';
  backend: 'localStorage';
}>;

type CandidateAssessment = Readonly<{
  id: 'native_indexeddb' | 'indexeddb_wrapper' | 'sqlite_wasm' | 'localstorage';
  disposition: 'recommended' | 'optional_later' | 'defer' | 'transitional';
  productionDependency: boolean;
  sameOriginLocal: boolean;
  supportsTransactions: boolean;
  supportsIndexedQueries: boolean;
  detail: string;
}>;

export const LOCAL_DATA_PLATFORM_EVALUATION_SCHEMA = 'whoisleuth.local-data-platform-evaluation';
export const LOCAL_DATA_PLATFORM_EVALUATION_VERSION = 1;
export const LOCAL_STORAGE_REFERENCE_BYTES = 5 * 1024 * 1024;
export const MAX_LOCAL_DATA_EVALUATION_STORES = 16;
export const MAX_LOCAL_DATA_EVALUATION_CANDIDATES = 8;
export const MAX_LOCAL_DATA_EVALUATION_DETAIL_LENGTH = 320;

const CURRENT_STORES = Object.freeze<StoreAssessment[]>([
  Object.freeze({ id: 'cases', label: 'Cases', maximumBytes: MAX_CASE_STORE_BYTES, access: 'whole_document', backend: 'localStorage' }),
  Object.freeze({ id: 'watchlists', label: 'Watchlists', maximumBytes: MAX_WATCHLIST_STORE_BYTES, access: 'whole_document', backend: 'localStorage' }),
  Object.freeze({ id: 'brand_profiles', label: 'Brand Profiles', maximumBytes: MAX_PROFILE_STORE_BYTES, access: 'whole_document', backend: 'localStorage' }),
  Object.freeze({ id: 'campaigns', label: 'Campaigns', maximumBytes: MAX_CAMPAIGN_STORE_BYTES, access: 'whole_document', backend: 'localStorage' }),
  Object.freeze({ id: 'shortlist', label: 'Shortlist', maximumBytes: MAX_SHORTLIST_STORE_BYTES, access: 'whole_document', backend: 'localStorage' }),
  Object.freeze({ id: 'ct_history', label: 'Certificate Transparency history', maximumBytes: MAX_CT_HISTORY_STORE_BYTES, access: 'whole_document', backend: 'localStorage' }),
  Object.freeze({ id: 'detection_rules', label: 'Detection rules', maximumBytes: MAX_RULE_STORE_BYTES, access: 'whole_document', backend: 'localStorage' }),
]);

const CANDIDATES = Object.freeze<CandidateAssessment[]>([
  Object.freeze({
    id: 'native_indexeddb',
    disposition: 'recommended',
    productionDependency: false,
    sameOriginLocal: true,
    supportsTransactions: true,
    supportsIndexedQueries: true,
    detail: 'Prototype the browser-native asynchronous database first, behind an application-owned interface.',
  }),
  Object.freeze({
    id: 'indexeddb_wrapper',
    disposition: 'optional_later',
    productionDependency: true,
    sameOriginLocal: true,
    supportsTransactions: true,
    supportsIndexedQueries: true,
    detail: 'Consider a wrapper only if the native adapter or migration code becomes difficult to maintain.',
  }),
  Object.freeze({
    id: 'sqlite_wasm',
    disposition: 'defer',
    productionDependency: true,
    sameOriginLocal: true,
    supportsTransactions: true,
    supportsIndexedQueries: true,
    detail: 'The bundle, worker, filesystem, and compatibility costs are not justified by the current query model.',
  }),
  Object.freeze({
    id: 'localstorage',
    disposition: 'transitional',
    productionDependency: false,
    sameOriginLocal: true,
    supportsTransactions: false,
    supportsIndexedQueries: false,
    detail: 'Keep existing stores authoritative until a non-destructive migration is separately approved and verified.',
  }),
]);

function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new TypeError('Evaluation generation time must be valid.');
  return new Date(parsed).toISOString();
}

function mebibytes(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function boundedDetail(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, MAX_LOCAL_DATA_EVALUATION_DETAIL_LENGTH);
}

export function buildLocalDataPlatformEvaluation(options: Readonly<{ now?: () => Date }> = {}) {
  const stores = CURRENT_STORES.slice(0, MAX_LOCAL_DATA_EVALUATION_STORES);
  const declaredMaximumBytes = stores.reduce((total, store) => total + store.maximumBytes, 0);
  const exceedsReferenceByBytes = Math.max(0, declaredMaximumBytes - LOCAL_STORAGE_REFERENCE_BYTES);
  const candidates = CANDIDATES.slice(0, MAX_LOCAL_DATA_EVALUATION_CANDIDATES);
  return Object.freeze({
    schema: LOCAL_DATA_PLATFORM_EVALUATION_SCHEMA,
    version: LOCAL_DATA_PLATFORM_EVALUATION_VERSION,
    generatedAt: timestamp((options.now || (() => new Date()))()),
    mode: 'offline_contract_evaluation',
    boundaries: Object.freeze({
      networkRequests: 0,
      browserRecordsRead: 0,
      userDataRead: false,
      productionStorageChanged: false,
    }),
    current: Object.freeze({
      stores: Object.freeze(stores),
      storeCount: stores.length,
      declaredMaximumBytes,
      declaredMaximumMiB: mebibytes(declaredMaximumBytes),
      localStorageReferenceBytes: LOCAL_STORAGE_REFERENCE_BYTES,
      localStorageReferenceMiB: mebibytes(LOCAL_STORAGE_REFERENCE_BYTES),
      exceedsReferenceByBytes,
      exceedsReferenceByMiB: mebibytes(exceedsReferenceByBytes),
      crossStoreTransactions: false,
      investigationSearchBuild: 'disposable_full_store_projection',
    }),
    findings: Object.freeze([
      Object.freeze({
        id: 'aggregate_capacity',
        status: exceedsReferenceByBytes > 0 ? 'threshold_met' : 'not_demonstrated',
        detail: boundedDetail(`The ${stores.length} declared browser-store budgets total ${mebibytes(declaredMaximumBytes)} MiB, compared with the existing 5 MiB localStorage planning reference.`),
      }),
      Object.freeze({
        id: 'queryability',
        status: 'threshold_met',
        detail: boundedDetail('Investigation search currently parses complete bounded source documents and rebuilds a disposable projection and index.'),
      }),
      Object.freeze({
        id: 'privacy',
        status: 'preserve',
        detail: boundedDetail('Any replacement must remain same-origin and browser-local by default and must not create hosted custody or synchronization.'),
      }),
      Object.freeze({
        id: 'offline',
        status: 'neutral',
        detail: boundedDetail('Both localStorage and IndexedDB work without a network connection; PWA behavior is a separate decision.'),
      }),
    ]),
    candidates: Object.freeze(candidates),
    decision: Object.freeze({
      state: 'proceed_with_native_indexeddb_prototype',
      recommendedCandidate: 'native_indexeddb',
      rationale: boundedDetail('The aggregate capacity and whole-document query thresholds justify a dependency-free IndexedDB prototype, but not an automatic production migration.'),
      migrationApproved: false,
      independentFutureWork: Object.freeze(['production_migration', 'encryption', 'pwa']),
    }),
    limitations: Object.freeze([
      boundedDetail('Declared store budgets are safety ceilings, not a measurement of one user workspace or a browser quota guarantee.'),
      boundedDetail('Browser quota and eviction behavior vary by browser, device, storage pressure, and browsing mode.'),
      boundedDetail('The evaluation does not read existing browser records, benchmark a user device, or prove that a migration is safe.'),
    ]),
  });
}

export function formatLocalDataPlatformEvaluation(report: ReturnType<typeof buildLocalDataPlatformEvaluation>): string {
  const recommended = report.candidates.find((candidate) => candidate.id === report.decision.recommendedCandidate);
  return [
    'WHOISleuth local data platform evaluation',
    `Declared browser-store budgets: ${report.current.declaredMaximumMiB} MiB across ${report.current.storeCount} stores`,
    `Existing localStorage planning reference: ${report.current.localStorageReferenceMiB} MiB`,
    `Capacity above reference: ${report.current.exceedsReferenceByMiB} MiB`,
    `Decision: ${report.decision.state}`,
    `Candidate: ${recommended?.id || 'none'} (${recommended?.productionDependency ? 'dependency required' : 'no production dependency'})`,
    'Migration, encryption, and PWA support remain separately gated.',
    'Use --json for the complete versioned report.',
  ].join('\n');
}

export function parseArguments(args: readonly string[]): { json: boolean } {
  if (args.length === 0) return { json: false };
  if (args.length === 1 && args[0] === '--json') return { json: true };
  throw new Error(args.some((value) => value === '--json') ? 'The --json flag may be supplied only once.' : `Unknown option: ${args[0] || ''}`);
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    const parsed = parseArguments(args);
    const report = buildLocalDataPlatformEvaluation({ now: options.now });
    stdout.write(`${parsed.json ? JSON.stringify(report, null, 2) : formatLocalDataPlatformEvaluation(report)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Local data platform evaluation failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();
