import { fileURLToPath } from 'node:url';

import { CISA_KEV_CATALOG } from '../lib/generated/cisa-kev-catalog.mts';

const CISA_KEV_STATUS_SCHEMA = 'whoisleuth.cisa-kev-catalog-status';
const CISA_KEV_STATUS_VERSION = 1;
const DEFAULT_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type WritableLike = { write(value: string): unknown };
type CatalogStatus = Readonly<{
  schema: typeof CISA_KEV_STATUS_SCHEMA;
  version: typeof CISA_KEV_STATUS_VERSION;
  generatedAt: string;
  state: 'current' | 'invalid' | 'stale';
  catalogVersion: string;
  releasedAt: string;
  ageDays: number | null;
  maxAgeDays: number;
  identifierCount: number;
  limitation: string;
}>;

function buildCatalogStatus(
  now = new Date(),
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
): CatalogStatus {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 365) {
    throw new RangeError('CISA KEV catalogue maximum age must be an integer from 1 to 365 days.');
  }
  const releasedAtMs = Date.parse(CISA_KEV_CATALOG.releasedAt);
  const nowMs = now.getTime();
  const validNow = Number.isFinite(nowMs);
  const validDates = Number.isFinite(releasedAtMs) && validNow && releasedAtMs <= nowMs;
  const ageDays = validDates ? Math.floor((nowMs - releasedAtMs) / DAY_MS) : null;
  const state = ageDays === null ? 'invalid' : ageDays > maxAgeDays ? 'stale' : 'current';
  return Object.freeze({
    schema: CISA_KEV_STATUS_SCHEMA,
    version: CISA_KEV_STATUS_VERSION,
    generatedAt: validNow ? now.toISOString() : new Date(0).toISOString(),
    state,
    catalogVersion: CISA_KEV_CATALOG.catalogVersion,
    releasedAt: CISA_KEV_CATALOG.releasedAt,
    ageDays,
    maxAgeDays,
    identifierCount: CISA_KEV_CATALOG.identifiers.length,
    limitation: 'This local age check does not fetch the source catalogue or prove that the pinned projection is the newest available release.',
  });
}

function parseArguments(args: readonly string[]): Readonly<{ json: boolean; maxAgeDays: number }> {
  let json = false;
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      if (json) throw new TypeError('The --json option may be supplied only once.');
      json = true;
      continue;
    }
    if (argument === '--max-age-days') {
      const value = args[index + 1];
      if (!value || !/^\d{1,3}$/u.test(value)) throw new TypeError('--max-age-days requires an integer from 1 to 365.');
      maxAgeDays = Number(value);
      index += 1;
      continue;
    }
    throw new TypeError('Usage: npm run catalog:kev:status -- [--max-age-days <1-365>] [--json]');
  }
  if (maxAgeDays < 1 || maxAgeDays > 365) throw new TypeError('--max-age-days requires an integer from 1 to 365.');
  return { json, maxAgeDays };
}

async function main(
  args = process.argv.slice(2),
  options: Readonly<{ now?: Date; stdout?: WritableLike; stderr?: WritableLike }> = {},
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const parsed = parseArguments(args);
    const report = buildCatalogStatus(options.now ?? new Date(), parsed.maxAgeDays);
    stdout.write(parsed.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `CISA KEV catalogue: ${report.state} (${report.ageDays ?? 'unknown'} days old; ${report.identifierCount} identifiers)\n`);
    return report.state === 'current' ? 0 : 2;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'CISA KEV catalogue status failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();

export {
  CISA_KEV_STATUS_SCHEMA,
  CISA_KEV_STATUS_VERSION,
  DEFAULT_MAX_AGE_DAYS,
  buildCatalogStatus,
  main,
  parseArguments,
};
