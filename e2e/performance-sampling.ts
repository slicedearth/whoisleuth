import type { Page } from '@playwright/test';

import { ALLOWED_ORIGIN } from './fixtures';

// Three samples make the median require two passes against the reviewed
// budget. One scheduler-affected sample remains permitted, but the two-times
// hard ceiling prevents the median from hiding a severe regression.
export const PERFORMANCE_SAMPLE_COUNT = 3;
export const PERFORMANCE_TRANSIENT_OUTLIER_MULTIPLIER = 2;

export async function resetPerformanceSampleState(page: Page): Promise<void> {
  if (page.url() === ALLOWED_ORIGIN || page.url().startsWith(`${ALLOWED_ORIGIN}/`)) {
    await page.evaluate(() => sessionStorage.clear());
  }
  await page.goto('about:blank');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Network.enable');
    await session.send('Network.clearBrowserCache');
    await session.send('Storage.clearDataForOrigin', {
      origin: ALLOWED_ORIGIN,
      storageTypes: 'appcache,cache_storage,indexeddb,local_storage,service_workers,websql',
    });
  } finally {
    await session.detach();
  }
}

export function performanceSampleMedian(values: readonly number[]): number {
  if (values.length !== PERFORMANCE_SAMPLE_COUNT || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError(`Performance authority requires exactly ${PERFORMANCE_SAMPLE_COUNT} finite non-negative samples.`);
  }
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!;
}
