import { expect } from './fixtures';

// Shared bounded inputs and download capture for Bulk browser specifications.

// Default fixtures use dotless values so classifyQuery rejects them before
// any upstream work. Tests that need completed result data install an explicit
// local /api/lookup route before using domain-shaped values.
const invalidDomains = (count: number) => Array.from({ length: count }, (_, i) => `bad-domain-${i + 1}`);

async function captureDownloads(
  page: import('@playwright/test').Page,
  action: () => Promise<void>,
  expectedCount = 3,
) {
  const downloads: import('@playwright/test').Download[] = [];
  const listener = (download: import('@playwright/test').Download) => downloads.push(download);
  page.on('download', listener);
  try {
    await action();
    await expect.poll(() => downloads.length).toBe(expectedCount);
    return downloads;
  } finally {
    page.off('download', listener);
  }
}

// Specifications using these rejected-domain inputs explicitly enable the
// narrow local Lookup HTTP-400 diagnostic allowance. Other console errors and
// all off-origin requests remain failures in the shared browser guard.

export { captureDownloads, invalidDomains };
