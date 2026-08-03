const MAX_RUN_MULTIPLIER = 20;
const MAX_PROPERTY_RUNS = 20_000;
const MIN_FAST_CHECK_SEED = -0x8000_0000;
const MAX_FAST_CHECK_SEED = 0x7fff_ffff;

type FastCheckEnvironment = Readonly<{
  WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER?: string;
  WHOISLEUTH_FAST_CHECK_SEED?: string;
}>;

export type FastCheckParameters = Readonly<{
  numRuns: number;
  seed?: number;
}>;

function optionalInteger(
  value: string | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^-?\d+$/u.test(value)) throw new Error(`${label} must be a base-10 integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

/**
 * Keeps normal property checks quick while allowing scheduled runs to explore
 * more cases and to replay an exact failure seed. Fixed regression seeds remain
 * the default unless an explicit stress-run seed is supplied.
 */
export function fastCheckParameters(
  defaultRuns: number,
  regressionSeed?: number,
  environment: FastCheckEnvironment = process.env,
): FastCheckParameters {
  if (!Number.isSafeInteger(defaultRuns) || defaultRuns < 1 || defaultRuns > MAX_PROPERTY_RUNS) {
    throw new Error(`defaultRuns must be between 1 and ${MAX_PROPERTY_RUNS}.`);
  }
  const multiplier = optionalInteger(
    environment.WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER,
    'WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER',
    1,
    MAX_RUN_MULTIPLIER,
  ) ?? 1;
  const requestedSeed = optionalInteger(
    environment.WHOISLEUTH_FAST_CHECK_SEED,
    'WHOISLEUTH_FAST_CHECK_SEED',
    MIN_FAST_CHECK_SEED,
    MAX_FAST_CHECK_SEED,
  );
  const seed = requestedSeed ?? regressionSeed;
  const numRuns = Math.min(defaultRuns * multiplier, MAX_PROPERTY_RUNS);
  return seed === undefined ? { numRuns } : { numRuns, seed };
}
