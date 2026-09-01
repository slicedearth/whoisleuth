export const PLAYWRIGHT_RUN_KIND_ENV = 'WHOISLEUTH_PLAYWRIGHT_RUN_KIND';
export const PLAYWRIGHT_SHARD_ENV = 'WHOISLEUTH_PLAYWRIGHT_SHARD';

type Environment = Readonly<Record<string, string | undefined>>;

export type PlaywrightRunArtifacts = Readonly<{
  identity: string;
  authFile: string;
  jsonResults: string;
  htmlReport: string;
  testResults: string;
}>;

function shardIdentity(value: string): string {
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (!match) throw new TypeError('Playwright shard identity must use N/TOTAL.');
  const selected = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(selected) || !Number.isSafeInteger(total)
    || selected < 1 || total < 1 || total > 16 || selected > total) {
    throw new TypeError('Playwright shard identity is outside the maintained range.');
  }
  return `shard-${selected}-of-${total}`;
}

export function playwrightRunIdentity(environment: Environment = process.env): string {
  const kind = environment[PLAYWRIGHT_RUN_KIND_ENV]?.trim() ?? '';
  const shard = environment[PLAYWRIGHT_SHARD_ENV]?.trim() ?? '';
  if (kind && kind !== 'functional' && kind !== 'performance') {
    throw new TypeError('Playwright run kind must be functional or performance.');
  }
  if (kind === 'performance') {
    if (shard) throw new TypeError('The isolated Playwright performance run cannot also be a functional shard.');
    return 'performance';
  }
  if (shard) return shardIdentity(shard);
  return kind || 'default';
}

export function playwrightRunArtifacts(environment: Environment = process.env): PlaywrightRunArtifacts {
  const identity = playwrightRunIdentity(environment);
  if (identity === 'default') {
    return Object.freeze({
      identity,
      authFile: 'playwright/.auth/user.json',
      jsonResults: 'playwright-results.json',
      htmlReport: 'playwright-report',
      testResults: 'test-results',
    });
  }
  return Object.freeze({
    identity,
    authFile: `playwright/.auth/${identity}.json`,
    jsonResults: `playwright-results/${identity}.json`,
    htmlReport: `playwright-report/${identity}`,
    testResults: `test-results/${identity}`,
  });
}
