#!/usr/bin/env node

// Maintenance-only observations. Source bodies remain in memory; this command
// neither installs upstream content nor changes the retained dataset owners.
import { fileURLToPath } from 'node:url';
import { SSLBL_CERTIFICATE_SNAPSHOT } from '../lib/sslbl-certificates.generated.mts';
import { SSLBL_SNAPSHOT_MAX_AGE_MS } from '../lib/sslbl-intelligence.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { CISA_KEV_CATALOG } from '../lib/generated/cisa-kev-catalog.mts';
import { RETIRE_BROWSER_CATALOG } from '../lib/generated/retire-browser-catalog.mts';
import {
  MAX_CONFUSABLE_SOURCE_BYTES, UNICODE_CONFUSABLE_DATA_VERSION, UNICODE_CONFUSABLE_SOURCE_SHA256,
} from '../lib/idn-confusable-policy.mts';
import retainedInfrastructure from '../packages/relationships/common-infrastructure-snapshot.json' with { type: 'json' };
import { RDAP_EXTENSION_REGISTRY_FIXTURE } from '../fixtures/rdap-extension-registry.mts';
import { safeFetchDetailed, readTextCapped } from '../lib/safe-fetch.mts';
import { sha256Text as sha256 } from './maintainer-tool-helpers.mts';
import {
  SSLBL_SOURCE_URL, MAX_SSLBL_SOURCE_BYTES, parseSslblCertificateCsv, assessSslblSnapshotUpdate,
} from './sslbl-snapshot.mts';
import { SOURCE_URL as KEV_URL, MAX_SOURCE_BYTES as KEV_BYTES, projectCatalogue } from './cisa-kev-catalog.mts';
import { MAX_SOURCE_BYTES as BROWSER_CATALOGUE_BYTES, MAX_CATALOGUE_COMPONENTS } from './retire-browser-catalog.mts';
import { DEFAULT_MAX_AGE_DAYS as KEV_REVIEW_DAYS } from './cisa-kev-catalog-status.mts';
import {
  SOURCE_DEFINITIONS, MAX_SOURCE_BYTES as INFRASTRUCTURE_BYTES, FRESHNESS_DAYS,
  parseSource, verifyCloudflareRanges, commonInfrastructureHealth,
  OfficialRangeMismatchError, type Snapshot,
} from './common-infrastructure-snapshot.mts';
import {
  auditRdapExtensionRegistry, RDAP_EXTENSION_SOURCE_URL, MAX_RDAP_EXTENSION_SOURCE_BYTES,
} from './rdap-extension-drift-audit.mts';

export const UNICODE_LATEST_URL = 'https://www.unicode.org/Public/security/latest/confusables.txt';
export const BROWSER_REVISION_URL = 'https://api.github.com/repos/RetireJS/retire.js/commits?path=repository/jsrepository.json&per_page=1';
export const INFRASTRUCTURE_REVISION_URL = 'https://api.github.com/repos/MISP/misp-warninglists/commits?per_page=1';
export const SOURCE_DRIFT_SCHEMA = 'whoisleuth.source-drift-audit';
export const SOURCE_DRIFT_VERSION = 1;
const REQUEST_MS = 10_000;
const TOTAL_MS = 90_000;
type FetchSource = (url: string, init: RequestInit) => Promise<Response>;
type Writable = { write(value: string): unknown };
type Check = Readonly<{
  id: string; label: string; status: 'current' | 'drift' | 'inconclusive';
  expectedItems: number | null; observedItems: number | null;
  expectedDigest: string | null; observedDigest: string | null; detail: string;
}>;
export type SourceDriftBaseline = Readonly<{
  sslbl: unknown;
  kev: Readonly<{ sourceSha256: string; releasedAt: string; identifiers: readonly string[] }>;
  browser: Readonly<{ sourceSha256: string }>;
  infrastructure: Snapshot;
  unicode: Readonly<{ version: string; sha256: string }>;
  extensionDigest: string;
}>;
const BASELINE: SourceDriftBaseline = {
  sslbl: SSLBL_CERTIFICATE_SNAPSHOT, kev: CISA_KEV_CATALOG, browser: RETIRE_BROWSER_CATALOG,
  infrastructure: retainedInfrastructure as Snapshot,
  unicode: { version: UNICODE_CONFUSABLE_DATA_VERSION, sha256: UNICODE_CONFUSABLE_SOURCE_SHA256 },
  extensionDigest: RDAP_EXTENSION_REGISTRY_FIXTURE.sourceDigestSha256,
};
type Options = Readonly<{
  now?: Date; fetchSource?: FetchSource; baseline?: SourceDriftBaseline;
  requestTimeoutMs?: number; totalTimeoutMs?: number;
  stdout?: Writable; stderr?: Writable;
}>;
class SourceUnavailable extends Error {}

function verifiedStage<T>(message: string, operation: () => T): T {
  try { return operation(); }
  catch { throw new SourceUnavailable(`${message} No data was changed.`); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid source object.');
  return value as Record<string, unknown>;
}
function date(value: unknown, now: Date): number {
  const normalized = normalizeExplicitIsoTimestamp(value);
  if (!normalized || Date.parse(normalized) > now.getTime()) throw new TypeError('Invalid source date.');
  return Date.parse(normalized);
}
function timeout(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError('Invalid check timeout.');
  return value;
}

export async function auditSourceDrift(options: Options = {}) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid check clock.');
  const baseline = options.baseline ?? BASELINE;
  const requestMs = timeout(options.requestTimeoutMs, REQUEST_MS);
  const total = AbortSignal.timeout(timeout(options.totalTimeoutMs, TOTAL_MS));
  const fetchSource = options.fetchSource ?? (async (url, init) => (await safeFetchDetailed(url, init, { maxRedirects: 0 })).response);
  let networkRequests = 0;
  const request: FetchSource = async (url, init) => {
    total.throwIfAborted();
    networkRequests += 1;
    return fetchSource(url, { ...init, redirect: 'error', signal: AbortSignal.any([
      total, AbortSignal.timeout(requestMs), ...(init.signal ? [init.signal] : []),
    ]) });
  };
  async function text(url: string, maximum: number): Promise<string> {
    const response = await request(url, { headers: { accept: 'application/json, text/plain', 'user-agent': 'WHOISleuth source maintenance' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceUnavailable(`Source returned HTTP ${response.status}.`);
    }
    const body = await readTextCapped(response, maximum, { fatalUtf8: true });
    if (body.truncated) throw new SourceUnavailable('Source exceeded its byte bound.');
    if (!body.text) throw new SourceUnavailable('Source returned an empty body.');
    return body.text;
  }
  async function revision(url: string): Promise<string> {
    const rows: unknown = JSON.parse(await text(url, 128 * 1024));
    if (!Array.isArray(rows) || rows.length !== 1) throw new TypeError('Invalid revision response.');
    const entry = record(rows[0]);
    if (typeof entry.sha !== 'string' || !/^[a-f0-9]{40}$/u.test(entry.sha)) throw new TypeError('Invalid revision.');
    date(record(record(entry.commit).committer).date, now);
    return entry.sha;
  }
  const checks: Check[] = [];
  async function check(id: string, label: string, observe: () => Promise<Omit<Check, 'id' | 'label'>>) {
    try { checks.push({ id, label, ...await observe() }); }
    catch (error) {
      checks.push({ id, label, status: 'inconclusive', expectedItems: null, observedItems: null,
        expectedDigest: null, observedDigest: null,
        detail: error instanceof SourceUnavailable ? error.message : 'Source could not be verified within its format, provenance or request bounds. No data was changed.' });
    }
  }
  function comparison(expected: string, observed: string, expectedItems: number | null, observedItems: number | null, detail: string) {
    return { status: expected === observed ? 'current' as const : 'drift' as const,
      expectedItems, observedItems, expectedDigest: expected, observedDigest: observed, detail };
  }

  // Independent checks continue after a failure. At most five source operations
  // run concurrently, with the shared deadline limiting the complete command.
  await Promise.all([
    check('sslbl', 'Certificate intelligence', async () => {
      const raw = await text(SSLBL_SOURCE_URL, MAX_SSLBL_SOURCE_BYTES);
      const source = verifiedStage('Certificate feed format could not be parsed.', () => parseSslblCertificateCsv(raw));
      const update = verifiedStage('Certificate feed failed timestamp, rollback or retained-snapshot integrity checks.', () =>
        assessSslblSnapshotUpdate(source, now.toISOString(), { currentSnapshot: baseline.sslbl, allowLargeShrink: true }));
      const previous = record(baseline.sslbl);
      const overdue = now.getTime() - Date.parse(source.sourceUpdatedAt) > SSLBL_SNAPSHOT_MAX_AGE_MS;
      return { ...comparison(String(previous.sourceDigestSha256), source.sourceDigestSha256, update.currentEntries, update.nextEntries,
        `Added ${update.added}; removed ${update.removed}. ${overdue ? 'Upstream feed is older than the runtime freshness window; review source availability.'
          : update.largeShrink ? 'Large shrink requires explicit review.' : 'Refresh through the existing snapshot owner when changed.'}`),
        ...(overdue ? { status: 'drift' as const } : {}) };
    }),
    check('kev', 'Exploited-vulnerability catalogue', async () => {
      const raw = await text(KEV_URL, KEV_BYTES);
      const source = verifiedStage('Vulnerability catalogue is not a valid JSON object.', () => record(JSON.parse(raw)));
      const metadata = verifiedStage('Vulnerability catalogue metadata is invalid, future-dated or older than the retained release.', () => {
        if (typeof source.catalogVersion !== 'string' || !/^\d{4}\.\d{2}\.\d{2}$/u.test(source.catalogVersion)
          || typeof source.dateReleased !== 'string' || date(source.dateReleased, now) < Date.parse(baseline.kev.releasedAt)) {
          throw new TypeError();
        }
        return { version: source.catalogVersion, releasedAt: source.dateReleased };
      });
      const ids = verifiedStage('Vulnerability catalogue entries failed projection validation.', () => projectCatalogue(source, metadata.version, metadata.releasedAt));
      const overdue = Math.floor((now.getTime() - Date.parse(metadata.releasedAt)) / 86_400_000) > KEV_REVIEW_DAYS;
      return { ...comparison(baseline.kev.sourceSha256, sha256(raw), baseline.kev.identifiers.length, ids.length,
        `Observed catalogue ${source.catalogVersion}. ${overdue ? 'Upstream release is beyond its review window.' : 'Review additions/removals before updating its pin.'}`),
        ...(overdue ? { status: 'drift' as const } : {}) };
    }),
    check('browser_advisories', 'Browser-library advisory catalogue', async () => {
      const commit = await revision(BROWSER_REVISION_URL);
      const raw = await text(`https://raw.githubusercontent.com/RetireJS/retire.js/${commit}/repository/jsrepository.json`, BROWSER_CATALOGUE_BYTES);
      const source = record(JSON.parse(raw));
      const count = Object.keys(source).length;
      if (!count || count > MAX_CATALOGUE_COMPONENTS) throw new TypeError('Invalid catalogue size.');
      // Do not execute expressions from a new upstream revision. The generator
      // qualifies them separately after the maintainer approves its exact pin.
      return comparison(baseline.browser.sourceSha256, sha256(raw), null, count,
        `Observed revision ${commit}. Changed bytes require the catalogue generator's expression qualification.`);
    }),
    check('unicode', 'Unicode confusables', async () => {
      const raw = await text(UNICODE_LATEST_URL, MAX_CONFUSABLE_SOURCE_BYTES);
      const version = raw.match(/^# Version:\s*(\d+\.\d+\.\d+)\s*$/mu)?.[1];
      if (!version) throw new TypeError('Missing source version.');
      return { ...comparison(baseline.unicode.sha256, sha256(raw), null, null,
        `Retained ${baseline.unicode.version}; latest ${version}. A changed source requires projection and labelled calibration before adoption.`),
      ...(version !== baseline.unicode.version ? { status: 'drift' as const } : {}) };
    }),
    check('rdap_extensions', 'RDAP extension registry', async () => {
      const report = auditRdapExtensionRegistry({ liveSourceText: await text(RDAP_EXTENSION_SOURCE_URL, MAX_RDAP_EXTENSION_SOURCE_BYTES), now: () => now });
      return { ...comparison(baseline.extensionDigest, report.source.observedDigestSha256,
        RDAP_EXTENSION_REGISTRY_FIXTURE.entries.length, report.source.entries,
        'Registry interpretation and raw-source provenance are compared separately; neither enables new runtime extensions.'),
      ...(report.status === 'drift' ? { status: 'drift' as const } : {}) };
    }),
  ]);
  let infrastructureRevision: string | null = null;
  await check('infrastructure_revision', 'Infrastructure source revision', async () => {
    infrastructureRevision = await revision(INFRASTRUCTURE_REVISION_URL);
    return { status: 'current', expectedItems: null, observedItems: null, expectedDigest: null, observedDigest: null,
      detail: `Observed revision ${infrastructureRevision}; only selected source changes require a refresh.` };
  });
  for (const definition of SOURCE_DEFINITIONS) {
    await check(`infrastructure_${definition.id}`, definition.label, async () => {
      if (!infrastructureRevision) throw new SourceUnavailable('The upstream revision is unavailable; no comparison was possible.');
      const url = `https://raw.githubusercontent.com/MISP/misp-warninglists/${infrastructureRevision}/lists/${definition.list}/list.json`;
      const parsed = parseSource(definition, await text(url, INFRASTRUCTURE_BYTES), now);
      const previous = baseline.infrastructure.sources.find(item => item.id === definition.id);
      let officialMismatch = false;
      if (definition.id === 'cloudflare') {
        try { await verifyCloudflareRanges(parsed.snapshot.values, now, request); }
        catch (error) {
          if (!(error instanceof OfficialRangeMismatchError)) throw error;
          officialMismatch = true;
        }
      }
      const health = commonInfrastructureHealth(now, baseline.infrastructure);
      if (health.state === 'unavailable') throw new TypeError('Invalid retained verification clock.');
      const changed = !previous || previous.sourceDigestSha256 !== parsed.snapshot.sourceDigestSha256;
      const reviewDue = definition.id === 'cloudflare'
        ? (health.sourceAges.find(item => item.id === definition.id)?.ageDays ?? Infinity) > FRESHNESS_DAYS
        : parsed.ageDays > FRESHNESS_DAYS;
      return { status: changed || reviewDue || officialMismatch ? 'drift' : 'current',
        expectedItems: previous?.values.length ?? null, observedItems: parsed.snapshot.values.length,
        expectedDigest: previous?.sourceDigestSha256 ?? null, observedDigest: parsed.snapshot.sourceDigestSha256,
        detail: officialMismatch ? 'Official edge ranges differ from the warning list; review both sources before refreshing.'
          : reviewDue ? 'Source verification is due; refresh only after reviewing current upstream evidence.'
          : definition.id === 'cloudflare' ? 'Warning list compared with both official address-family lists; publisher date remains unchanged.'
            : 'Selected warning-list bytes match when current; unrelated repository revisions do not require repinning.' };
    });
  }
  checks.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return Object.freeze({ schema: SOURCE_DRIFT_SCHEMA, version: SOURCE_DRIFT_VERSION, generatedAt: now.toISOString(),
    mode: 'live_read_only', networkRequests, status: checks.some(item => item.status === 'inconclusive') ? 'inconclusive'
      : checks.some(item => item.status === 'drift') ? 'drift' : 'current', checks: Object.freeze(checks) });
}

export async function main(args = process.argv.slice(2), options: Options = {}): Promise<number> {
  try {
    if (!args.includes('--live') || new Set(args).size !== args.length || args.some(arg => !['--live', '--json'].includes(arg))) {
      throw new TypeError('Usage: npm run sources:drift -- --live [--json]');
    }
    const report = await auditSourceDrift(options);
    (options.stdout ?? process.stdout).write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n`
      : `${report.checks.map(item => `${item.status.toUpperCase()} ${item.label}: ${item.detail}`).join('\n')}\nRequests: ${report.networkRequests}; no files changed.\n`);
    return report.status === 'current' ? 0 : report.status === 'drift' ? 1 : 2;
  } catch (error) {
    (options.stderr ?? process.stderr).write(`${error instanceof TypeError ? error.message : 'Source drift audit could not complete.'}\n`);
    return 2;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
