import { expect, test, isLookupEndpointUrl } from './fixtures';
import { currentBrowserLocalDocument, expectNoHorizontalOverflow, migrateLegacyBrowserData, readBrowserLocalCollection, useTheme } from './helpers';
import { createCase, updateCase } from '../packages/cases/case-model.mts';
import { appendCaseObservedEffectReview } from '../packages/cases/case-response-outcomes.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';

const AT = '2026-09-22T00:00:00.000Z';
function records() {
  const first = { ...createCase({ domain: 'scope.example', title: 'First separate incident', incidentTarget: 'https://scope.example/page-one' }, AT), id: 'scope-first' };
  const partial = updateCase([first], first.id, { incidentTarget: 'https://distribution.example/ad-two', incidentTargetResolution: first.workflowMetadata!.incidentTargets[0]!.id }, AT).record;
  const second = { ...createCase({ domain: 'scope.example', title: 'Second separate incident', incidentTarget: 'https://scope.example/page-three' }, AT), id: 'scope-second' };
  second.observedEffects = appendCaseObservedEffectReview(second.observedEffects, { state: 'unavailable', observedAt: AT, sourceClass: 'analyst', source: 'Fixture recheck', completeness: 'unknown', limitations: ['Capture unavailable'] }, AT);
  const unrelated = { ...createCase({ domain: 'unrelated.example', title: 'Outside campaign' }, AT), id: 'scope-unrelated' };
  return [partial, second, unrelated];
}

test('campaign domain scope keeps incident IDs and unresolved objects separate without requests or writes', async ({ page }) => {
  let requests = 0;
  await page.route(url => isLookupEndpointUrl(url.href), route => { requests++; return route.abort(); });
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: records() },
    'whoisleuth-campaigns-v1': currentBrowserLocalDocument('campaigns', { campaigns: [{ id: 'scope-campaign', name: 'Retained domain scope', description: '', domains: ['scope.example', 'missing.example'], createdAt: AT, updatedAt: AT }] }),
  }, { destination: '/monitor?view=campaigns&campaign=scope-campaign', clearStorage: true });
  const before = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 3 });
  const scope = page.locator('.campaign-body details.case-scope');
  await scope.locator(':scope > summary').click();
  await expect(scope).toContainText('2 separate Cases · 2 open incident links · 1 analyst-resolved links · 3 exact objects with unknown action or observation coverage');
  await expect(scope).toContainText('same-domain incidents remain separate');
  await expect(scope.getByRole('link', { name: 'First separate incident · Case scope-first', exact: true })).toHaveAttribute('href', '/cases?case=scope-first&section=response');
  await expect(scope.getByRole('link', { name: 'Second separate incident · Case scope-second', exact: true })).toHaveAttribute('href', '/cases?case=scope-second&section=response');
  await expect(scope.getByRole('link', { name: 'Outside campaign · Case scope-unrelated', exact: true })).toHaveCount(0);
  await expect(scope.getByRole('cell', { name: /unavailable.*analyst.*unknown/u })).toHaveCount(1);
  await expect(scope.getByRole('cell', { name: 'No typed provider outcome retained', exact: true })).toHaveCount(2);
  await scope.getByText('1 campaign domain without an inspected Case', { exact: true }).click();
  await expect(scope).toContainText('missing.example · object coverage unavailable');
  await scope.locator('details.coverage').first().locator(':scope > summary').click();
  await expect(scope.locator('details.coverage').first().getByRole('cell', { name: /Unknown action binding/u })).toHaveCount(2);
  await expect(scope).toContainText('https://distribution.example/ad-two');
  await scope.getByText('Dispute, restoration and recurrence coverage', { exact: true }).click();
  await expect(scope).toContainText('Historical missing bindings remain unknown');
  await expect(scope).toContainText('does not establish malicious recurrence');
  await expect(scope).toContainText('Recurrence assessment remains unavailable without a comparable baseline for the same condition and object');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      const region = scope.getByRole('region', { name: 'Remaining Case object and outcome scope', exact: true });
      await expect(region).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled()) {
        await scope.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 140, behavior: 'instant' }));
        await page.screenshot({ path: test.info().outputPath(`operations-scope-${theme}-${width}.png`) });
      }
    }
  }
  const region = scope.getByRole('region', { name: 'Remaining Case object and outcome scope', exact: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await region.focus(); await region.press('ArrowRight');
  await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(await readBrowserLocalCollection(page, 'cases', { minimumRecords: 3 })).toEqual(before);
  expect(requests).toBe(0);
});

test('operations object scope is independent of report time window and excluded from aggregate export', async ({ page }) => {
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases: records() } }, { destination: '/monitor', clearStorage: true });
  await page.getByText('Case reports and follow-up tools', { exact: true }).click();
  const report = page.locator('.operations-report'), scope = report.locator('details.case-scope');
  await scope.locator(':scope > summary').click();
  await expect(scope).toContainText('3 separate Cases · 2 open incident links · 1 analyst-resolved links');
  await expect(scope).toContainText('independent of the action-report time window');
  await report.getByLabel('Time window').selectOption('7d');
  await expect(scope.getByRole('link', { name: 'Outside campaign · Case scope-unrelated', exact: true })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), report.getByRole('button', { name: 'Export aggregate JSON', exact: true }).click()]);
  const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  for (const value of ['scope-first', 'scope-second', 'scope.example', 'distribution.example', 'First separate incident', 'case-scope']) expect(body).not.toContain(value);
  expect(Object.keys(JSON.parse(body)).sort()).toEqual(['actionTypes', 'counts', 'durations', 'generatedAt', 'limitations', 'omissions', 'schema', 'sourceState', 'states', 'version', 'window']);
});

test('local scope pages keep the full denominator but render at most ten separate Cases', async ({ page }) => {
  const cases = Array.from({ length: 12 }, (_, index) => ({ ...createCase({ domain: 'paged.example', title: `Separate incident ${index}` }, AT), id: `paged-${index}` }));
  await migrateLegacyBrowserData(page, { 'whois-rdap-cases-v1': { version: CASE_SCHEMA_VERSION, cases } }, { destination: '/monitor', clearStorage: true });
  await page.getByText('Case reports and follow-up tools', { exact: true }).click();
  const scope = page.locator('.operations-report details.case-scope');
  await scope.locator(':scope > summary').click();
  await expect(scope).toContainText('12 separate Cases');
  await expect(scope.getByRole('link')).toHaveCount(10);
  const caseLinks = () => scope.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')));
  const expected = cases.map(record => `/cases?case=${record.id}&section=response`);
  const firstPage = await caseLinks();
  expect(new Set(firstPage).size).toBe(10);
  expect(firstPage.every(href => expected.includes(href!))).toBe(true);
  await scope.getByRole('button', { name: 'Next Case scope', exact: true }).click();
  await expect(scope.getByRole('link')).toHaveCount(2);
  const secondPage = await caseLinks();
  expect([...firstPage, ...secondPage].sort()).toEqual([...expected].sort());
  expect(new Set([...firstPage, ...secondPage]).size).toBe(expected.length);
  await expect(scope).toContainText('Page 2 of 2');
  await scope.getByRole('button', { name: 'Previous Case scope', exact: true }).click();
  await expect(scope.getByRole('link')).toHaveCount(10);
  expect(await caseLinks()).toEqual(firstPage);
  await expect(scope).toContainText('Page 1 of 2');
});
