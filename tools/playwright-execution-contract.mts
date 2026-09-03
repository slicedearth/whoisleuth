export const PLAYWRIGHT_FUNCTIONAL_PROJECT = 'chromium';
export const PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT = 'performance-authority';

export const PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS = Object.freeze([
  'e2e/console-loading.spec.ts',
  'e2e/deferred-interactions.spec.ts',
] as const);

const PERFORMANCE_AUTHORITY_BASENAMES = PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS
  .map((file) => file.slice('e2e/'.length).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));

export const PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN = new RegExp(
  `(?:^|[/\\\\])(?:${PERFORMANCE_AUTHORITY_BASENAMES.join('|')})$`,
  'u',
);

export function isPlaywrightPerformanceAuthoritySpec(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  return PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS.some((candidate) => (
    normalized === candidate || normalized.endsWith(`/${candidate}`)
  ));
}

export function isPlaywrightFunctionalSpec(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  return /^e2e\/[a-zA-Z0-9._-]+\.spec\.ts$/u.test(normalized)
    && !isPlaywrightPerformanceAuthoritySpec(normalized);
}

export function playwrightPerformanceAuthorityArguments(playwrightCli: string): readonly string[] {
  return Object.freeze([
    playwrightCli,
    'test',
    ...PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS,
    `--project=${PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT}`,
    '--workers=1',
    '--retries=0',
  ]);
}
