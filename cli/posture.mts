import argumentsModule from './arguments.js';

const { CliUsageError } = argumentsModule;

type SelectorNormalizer = (values: string[]) => string[];

const MAX_POSTURE_SELECTORS = 10;

function normalizePostureSelectors(raw: unknown, normalizeSelectors: SelectorNormalizer): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  const tokens = String(raw).split(',').map((value) => value.trim());
  if (tokens.some((value) => !value)) {
    throw new CliUsageError('--selectors cannot contain empty entries.');
  }
  const canonical = [...new Set(tokens.map((value) => value.toLowerCase().replace(/^\.+|\.+$/g, '')))];
  if (canonical.length > MAX_POSTURE_SELECTORS) {
    throw new CliUsageError(`--selectors supports at most ${MAX_POSTURE_SELECTORS} unique selectors.`);
  }
  const normalized = normalizeSelectors(tokens);
  if (normalized.length !== canonical.length || normalized.some((value, index) => value !== canonical[index])) {
    throw new CliUsageError('--selectors contains an invalid DKIM selector.');
  }
  return normalized;
}

export { MAX_POSTURE_SELECTORS, normalizePostureSelectors };
export type { SelectorNormalizer };
