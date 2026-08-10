import AxeBuilder from '@axe-core/playwright';

import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';
import {
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
} from '../cli/risk-calibration.mts';
import { buildRiskCalibrationSummaryReport } from '../lib/risk-calibration-summary.mts';
import { explainRiskScore, explainRiskScoreV6, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';

const NOW = '2026-08-10T00:00:00.000Z';

function reports() {
  const dataset = parseRiskCalibrationDataset(JSON.stringify({
    schema: RISK_CALIBRATION_DATASET_SCHEMA,
    version: RISK_CALIBRATION_DATASET_VERSION,
    records: Array.from({ length: 40 }, (_, index) => ({
      id: `private-calibration-${index}`,
      domain: `private-calibration-${index}.example.test`,
      analystDisposition: index < 20 ? 'confirmed_abuse' : 'expected',
      reviewReasonCode: index < 20 ? 'confirmed_credential_abuse' : 'authorized_or_owned',
      evidence: index < 20
        ? { availability: 'registered', scanDepth: 'deep', mutationTypes: ['dictionary'], hasPasswordField: true }
        : { availability: 'registered', scanDepth: 'fast' },
    })),
  }));
  const detailed = buildRiskCalibrationReport(dataset, explainRiskScore, {
    generatedAt: NOW,
    modelVersion: RISK_MODEL_VERSION,
    reviewThreshold: RISK_REVIEW_THRESHOLD,
    previousModelVersion: 6,
    explainPreviousRiskScore: explainRiskScoreV6,
  });
  return { detailed, summary: buildRiskCalibrationSummaryReport(detailed) };
}

test('target-free calibration review stays tab-local, exact, accessible, and mobile-safe', async ({ page }, testInfo) => {
  const { detailed, summary } = reports();
  await page.goto('/monitor?view=cases');
  const dashboard = page.locator('.calibration-dashboard');
  await expect(dashboard.getByRole('heading', { name: 'Reviewed Risk calibration' })).toBeVisible();

  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.evaluate(() => {
    const state = window as typeof window & { __calibrationWrites?: number };
    state.__calibrationWrites = 0;
    const count = () => { state.__calibrationWrites = (state.__calibrationWrites ?? 0) + 1; };
    const originalPut = IDBObjectStore.prototype.put;
    const originalAdd = IDBObjectStore.prototype.add;
    const originalDelete = IDBObjectStore.prototype.delete;
    const originalClear = IDBObjectStore.prototype.clear;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalStorageClear = Storage.prototype.clear;
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) {
      count(); return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    IDBObjectStore.prototype.add = function add(value: unknown, key?: IDBValidKey) {
      count(); return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    IDBObjectStore.prototype.delete = function deleteRecord(query: IDBValidKey | IDBKeyRange) { count(); return originalDelete.call(this, query); };
    IDBObjectStore.prototype.clear = function clear() { count(); return originalClear.call(this); };
    Storage.prototype.setItem = function setItem(key: string, value: string) { count(); return originalSetItem.call(this, key, value); };
    Storage.prototype.removeItem = function removeItem(key: string) { count(); return originalRemoveItem.call(this, key); };
    Storage.prototype.clear = function clear() { count(); return originalStorageClear.call(this); };
  });

  const input = dashboard.locator('input[type="file"]');
  await input.setInputFiles({
    name: `${'S'.repeat(120)}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(summary)),
  });
  await expect(dashboard.getByText('40', { exact: true }).first()).toBeVisible();
  await expect(dashboard.getByText('20 / 20', { exact: true })).toBeVisible();
  await expect(dashboard.getByText(/current Risk model, version/iu)).toBeVisible();
  await expect(dashboard.locator('tbody tr')).toHaveCount(6);
  await expect(dashboard.getByText(/Both metric classes contain at least 20 reviewed labels/iu)).toBeVisible();
  await expect(dashboard).not.toContainText('private-calibration-0');
  await expect(dashboard).not.toContainText('example.test');

  const strata = dashboard.getByText(/Review 4 bounded strata/iu);
  await strata.focus();
  await page.keyboard.press('Enter');
  await expect(dashboard.locator('.strata-grid article')).toHaveCount(4);
  await expect(dashboard.getByText('Deep Scan')).toBeVisible();
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __calibrationWrites?: number }).__calibrationWrites)).toBe(0);

  const accessibility = await new AxeBuilder({ page }).include('.calibration-dashboard').analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([]);

  await page.setViewportSize({ width: 320, height: 760 });
  await expect(dashboard.locator('.threshold-cards article')).toHaveCount(6);
  await expect(dashboard.locator('.threshold-cards article').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await dashboard.getByRole('button', { name: 'Clear summary' }).click();
  await expect(dashboard.getByText('20 / 20', { exact: true })).toHaveCount(0);
  await input.setInputFiles({
    name: 'detailed-calibration.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(detailed)),
  });
  await expect(dashboard.getByRole('alert')).toContainText(/unsupported or missing fields/iu);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => (window as typeof window & { __calibrationWrites?: number }).__calibrationWrites)).toBe(0);

  await testInfo.attach('risk-calibration-summary.json', {
    body: Buffer.from(JSON.stringify(summary, null, 2)),
    contentType: 'application/json',
  });
});
