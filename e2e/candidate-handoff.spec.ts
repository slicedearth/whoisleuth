import { expect, test } from './fixtures';
import { HANDOFF_KEY } from '../frontend/src/lib/candidate-handoff-core';

const FIRST_TOKEN = '0123456789abcdef0123456789abcdef';
const SECOND_TOKEN = 'fedcba9876543210fedcba9876543210';

function serialisedHandoff(token: string): string {
  return JSON.stringify({
    version: 2,
    token,
    createdAt: '2026-08-06T00:00:00.000Z',
    source: 'typosquat',
    candidates: [{
      domain: 'candidate.example',
      source: 'official.example',
      mutationTypes: ['dictionary'],
    }],
  });
}

test('candidate handoffs reject mismatched navigation context and consume the payload', async ({ page }) => {
  await page.addInitScript(({ key, value }) => {
    sessionStorage.setItem(key, value);
  }, { key: HANDOFF_KEY, value: serialisedHandoff(FIRST_TOKEN) });

  await page.goto(`/bulk?source=keyword&handoff=${FIRST_TOKEN}`);
  await expect(page.locator('#domains')).toHaveValue('');
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), HANDOFF_KEY)).toBeNull();
});

test('matching candidate handoffs prefill Bulk exactly once', async ({ page }) => {
  await page.addInitScript(({ key, marker, value }) => {
    if (sessionStorage.getItem(marker)) return;
    sessionStorage.setItem(marker, '1');
    sessionStorage.setItem(key, value);
  }, {
    key: HANDOFF_KEY,
    marker: 'whoisleuth:e2e-handoff-installed',
    value: serialisedHandoff(SECOND_TOKEN),
  });

  await page.goto(`/bulk?source=typosquat&handoff=${SECOND_TOKEN}`);
  await expect(page.locator('#domains')).toHaveValue('candidate.example');
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), HANDOFF_KEY)).toBeNull();

  await page.reload();
  await expect(page.locator('#domains')).toHaveValue('');
});
