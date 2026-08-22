const MAX_RUN_MULTIPLIER = 20;
const MAX_PROPERTY_RUNS = 20_000;
const MIN_FAST_CHECK_SEED = -0x8000_0000;
const MAX_FAST_CHECK_SEED = 0x7fff_ffff;

type FastCheckEnvironment = Readonly<{
  WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER?: string;
  WHOISLEUTH_FAST_CHECK_SEED?: string;
  WHOISLEUTH_FAST_CHECK_PATH?: string;
}>;

export type FastCheckParameters = Readonly<{
  numRuns: number;
  seed?: number;
  path?: string;
}>;

const FAST_CHECK_PATH_RE = /^\d+(?::\d+){0,63}$/u;

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
  const rawPath = environment.WHOISLEUTH_FAST_CHECK_PATH;
  const path = rawPath === undefined || rawPath === ''
    ? undefined
    : FAST_CHECK_PATH_RE.test(rawPath) && rawPath.length <= 200 ? rawPath : null;
  if (path === null) throw new Error('WHOISLEUTH_FAST_CHECK_PATH must be a bounded colon-separated replay path.');
  const numRuns = Math.min(defaultRuns * multiplier, MAX_PROPERTY_RUNS);
  return {
    numRuns,
    ...(seed === undefined ? {} : { seed }),
    ...(path === undefined ? {} : { path }),
  };
}

export function fastCheckReplayDetails(parameters: FastCheckParameters): string {
  return `Property replay: seed=${parameters.seed ?? 'generated'}, path=${parameters.path ?? 'root'}, runs=${parameters.numRuns}.`;
}
