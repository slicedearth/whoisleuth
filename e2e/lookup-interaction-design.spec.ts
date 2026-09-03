import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { expandLookupFamilies, expectNoHorizontalOverflow, useTheme } from './helpers';
import { sectionedLookupFixture } from './lookup-design-fixtures';

// Lookup response bounds, disclosure, analyst-task and URL reconciliation coverage.

function analystQuestion(page: import('@playwright/test').Page) {
  return page.getByRole('region', { name: 'Choose evidence depth for the question' })
    .getByLabel('Analyst question');
}

test('Lookup accepts exact HTTP evidence bounds and rejects an over-bound success response', async ({ page }) => {
  await page.route('**/api/lookup?*', async (route) => {
    const domain = new URL(route.request().url()).searchParams.get('q') || 'bounded-http.invalid';
    const fixture = sectionedLookupFixture(domain);
    const redirectCount = domain === 'overbound-http.invalid' ? 6 : 5;
    Object.assign(fixture.availability.http, {
      redirectCount,
      finalUrl: `https://hop-${redirectCount}.${domain}/`,
      redirects: Array.from({ length: redirectCount }, (_, index) => ({
        status: 302,
        from: `https://hop-${index}.${domain}/`,
        to: `https://hop-${index + 1}.${domain}/`,
        queryOmitted: false,
      })),
      attempts: [
        { url: `https://${domain}/`, outcome: 'error', httpStatus: null, error: 'Fixture connection failed.' },
        { url: `https://www.${domain}/`, outcome: 'response', httpStatus: 200, error: null },
      ],
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/lookup');
  await page.locator('#query').fill('bounded-http.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await expandLookupFamilies(page);
  const httpCard = page.locator('.http-card');
  await httpCard.locator(':scope > summary').click();
  await httpCard.getByText('Redirect chain · 5 hops').click();
  const mobileRedirects = httpCard.getByRole('list', { name: 'HTTP redirect steps' });
  await expect(mobileRedirects.getByRole('listitem')).toHaveCount(5);
  await expect(mobileRedirects).toContainText('https://hop-0.bounded-http.invalid/');
  await expect(mobileRedirects).toContainText('https://hop-5.bounded-http.invalid/');
  await expectNoHorizontalOverflow(page);

  await page.locator('#query').fill('overbound-http.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.getByRole('alert')).toHaveText('Lookup returned an invalid response.');
  await expect(page.locator('#result')).toHaveCount(0);
});

test('Lookup analyst question and disclosure controls change presentation without changing evidence', async ({ page }) => {
  test.slow();
  const domain = 'presentation-options.invalid';
  const presentationFixture = sectionedLookupFixture(domain);
  presentationFixture.diagnostics.whois.status = 'unsupported';
  await page.setViewportSize({ width: 1440, height: 900 });
  const lookupRequests: string[] = [];
  let fixtureResponses = 0;
  await page.route('**/api/lookup?*', (route) => {
    lookupRequests.push(route.request().url());
    fixtureResponses += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(presentationFixture),
    });
  });
  await page.goto('/lookup');
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  expect(lookupRequests).toHaveLength(1);
  expect(fixtureResponses).toBe(1);

  const controls = page.getByRole('region', { name: 'Choose what to review' });
  const task = analystQuestion(page);
  const localNav = page.getByRole('navigation', { name: 'Result sections' });
  await expect(task).toHaveValue('general');
  await expect(controls.getByLabel('Detail')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  const atAGlance = page.locator('.at-a-glance');
  const glanceGeometry = await atAGlance.evaluate((section) => {
    const intro = section.querySelector('.glance-intro');
    const note = section.querySelector('.metric-note');
    const sectionBox = section.getBoundingClientRect();
    const introBox = intro?.getBoundingClientRect();
    const noteBox = note?.getBoundingClientRect();
    return {
      sectionClientWidth: section.clientWidth,
      sectionScrollWidth: section.scrollWidth,
      introWidth: introBox?.width ?? 0,
      noteRight: noteBox?.right ?? Number.POSITIVE_INFINITY,
      sectionRight: sectionBox.right,
    };
  });
  expect(glanceGeometry.sectionScrollWidth).toBeLessThanOrEqual(glanceGeometry.sectionClientWidth + 1);
  expect(glanceGeometry.introWidth).toBeGreaterThanOrEqual(230);
  expect(glanceGeometry.noteRight).toBeLessThanOrEqual(glanceGeometry.sectionRight + 1);
  const glanceMetrics = atAGlance.locator('.metrics > details');
  await expect(glanceMetrics).toHaveCount(4);
  expect(await glanceMetrics.evaluateAll((metrics) => metrics.map((metric) => metric.getAttribute('data-metric-id')))).toEqual([
    'complete',
    'limited',
    'disagreements',
    'unresolved',
  ]);
  const metricSummaries = glanceMetrics.locator('summary');
  await expect(glanceMetrics.locator('.metric-label')).toHaveText([
    /complete checks?/u,
    /limited checks?/u,
    /disagreements?/u,
    /unresolved items?/u,
  ]);
  await expect(glanceMetrics.locator('.metric-icon')).toHaveCount(4);
  const metricPresentation = await glanceMetrics.evaluateAll((metrics) => metrics.map((metric) => {
    const summary = metric.querySelector('summary');
    const label = metric.querySelector('.metric-label');
    const icon = metric.querySelector('.metric-icon');
    return {
      tone: metric.getAttribute('data-tone'),
      label: label?.textContent?.trim() ?? '',
      icon: icon?.getAttribute('data-icon') ?? '',
      iconHidden: icon?.getAttribute('aria-hidden'),
      accessibleExplanation: summary?.getAttribute('aria-label') ?? '',
    };
  }));
  expect(metricPresentation.every((metric) => (
    ['neutral', 'caution', 'conflict'].includes(metric.tone ?? '')
      && metric.label.length > 0
      && metric.icon.length > 0
      && metric.iconHidden === 'true'
      && metric.accessibleExplanation.length > metric.label.length
  ))).toBe(true);
  await expect(atAGlance.getByText('Show what this count includes')).toHaveCount(0);
  expect(await metricSummaries.evaluateAll((summaries) => summaries.every((summary) => {
    const box = summary.getBoundingClientRect();
    return summary.scrollWidth <= summary.clientWidth + 1 && box.height <= 48;
  }))).toBe(true);
  const nextActionsBeforeDisclosure = await atAGlance.locator('.next-actions .next-action').evaluateAll((actions) => (
    actions.map((action) => ({
      href: action.getAttribute('href'),
      text: action.textContent?.replace(/\s+/gu, ' ').trim(),
    }))
  ));
  expect(nextActionsBeforeDisclosure.length).toBeGreaterThan(0);
  expect(nextActionsBeforeDisclosure.length).toBeLessThanOrEqual(3);
  for (const metric of await glanceMetrics.all()) {
    const count = Number(await metric.getAttribute('data-count'));
    const displayedCount = Number(await metric.getAttribute('data-displayed-count'));
    const omittedCount = Number(await metric.getAttribute('data-omitted-count'));
    expect(count).toBe(displayedCount + omittedCount);
    expect(await metric.locator('.metric-items > .metric-item').count()).toBe(displayedCount);
    const summary = metric.locator('summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(metric).toHaveAttribute('open', '');
    await expect(metric.locator('.metric-detail > p').first()).toBeVisible();
    if (omittedCount > 0) {
      await expect(metric.locator('.metric-omitted')).toContainText(`${omittedCount} additional contributing`);
    } else {
      await expect(metric.locator('.metric-omitted')).toHaveCount(0);
    }
    await page.keyboard.press('Space');
    await expect(metric).not.toHaveAttribute('open', '');
  }
  expect(await atAGlance.locator('.next-actions .next-action').evaluateAll((actions) => (
    actions.map((action) => ({
      href: action.getAttribute('href'),
      text: action.textContent?.replace(/\s+/gu, ' ').trim(),
    }))
  ))).toEqual(nextActionsBeforeDisclosure);
  expect(lookupRequests).toHaveLength(1);
  expect(fixtureResponses).toBe(1);
  await expect(atAGlance.locator('.metric-note')).toContainText('neither state establishes safety');
  const detailedAssessment = page.locator('details.detailed-assessment');
  await expect(detailedAssessment).not.toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: 'What the current evidence can support' })).toBeHidden();
  await page.getByText('Open assessment', { exact: true }).click();
  await expect(detailedAssessment).toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: 'What the current evidence can support' })).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & { __claimPassportWrites?: number };
    state.__claimPassportWrites = 0;
    const count = () => { state.__claimPassportWrites = (state.__claimPassportWrites ?? 0) + 1; };
    const originalPut = IDBObjectStore.prototype.put;
    const originalAdd = IDBObjectStore.prototype.add;
    const originalDelete = IDBObjectStore.prototype.delete;
    const originalClear = IDBObjectStore.prototype.clear;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalStorageClear = Storage.prototype.clear;
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) { count(); return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key); };
    IDBObjectStore.prototype.add = function add(value: unknown, key?: IDBValidKey) { count(); return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key); };
    IDBObjectStore.prototype.delete = function deleteRecord(query: IDBValidKey | IDBKeyRange) { count(); return originalDelete.call(this, query); };
    IDBObjectStore.prototype.clear = function clear() { count(); return originalClear.call(this); };
    Storage.prototype.setItem = function setItem(key: string, value: string) { count(); return originalSetItem.call(this, key, value); };
    Storage.prototype.removeItem = function removeItem(key: string) { count(); return originalRemoveItem.call(this, key); };
    Storage.prototype.clear = function clear() { count(); return originalStorageClear.call(this); };
  });
  const requestCountBeforeExport = lookupRequests.length;
  const passportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download portable passport for Registration-state statement' }).click();
  const downloadedPassport = await passportDownload;
  expect(downloadedPassport.suggestedFilename()).toMatch(/^whoisleuth-claim-presentation-options\.invalid-registration-state-\d{4}-\d{2}-\d{2}\.json$/u);
  const passportPath = await downloadedPassport.path();
  expect(passportPath).not.toBeNull();
  const passport = JSON.parse(await readFile(passportPath!, 'utf8')) as Record<string, unknown>;
  expect(passport.schema).toBe('whoisleuth.lookup-claim-passport');
  expect(passport.version).toBe(1);
  expect(passport.target).toEqual({ type: 'domain', value: domain });
  expect((passport.claim as Record<string, unknown>).id).toBe('registration-state');
  expect((passport.claim as Record<string, unknown>).requiredEvidenceIds).toEqual([
    'authority-aware-availability',
  ]);
  const keys: string[] = [];
  const inspectKeys = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) inspectKeys(item); return; }
    for (const [key, item] of Object.entries(value)) { keys.push(key); inspectKeys(item); }
  };
  inspectKeys(passport);
  expect(keys).not.toEqual(expect.arrayContaining(['requestUrl', 'finalUrl', 'contacts', 'rawWhois', 'credential']));
  expect(JSON.stringify(passport)).not.toMatch(/\/home|abuse@example\.test|Fixture Registrar/iu);
  await expect(detailedAssessment.getByRole('status')).toContainText('Downloaded a portable passport for Registration-state statement.');
  expect(await page.evaluate(() => (window as typeof window & { __claimPassportWrites?: number }).__claimPassportWrites)).toBe(0);
  expect(lookupRequests).toHaveLength(requestCountBeforeExport);
  await page.getByText('Close assessment', { exact: true }).click();
  await expect(detailedAssessment).not.toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Expand Advanced evidence' })).toBeVisible();
  const familyToggle = page.getByRole('button', { name: 'Expand Registration evidence' }).locator('.toggle-icon');
  await expect(familyToggle).toHaveText('');
  await expect(familyToggle).toHaveCSS('width', '17px');
  await expect(familyToggle).toHaveCSS('height', '17px');
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toHaveCount(0);

  const visibility = controls.getByRole('group', { name: 'Evidence family visibility' });
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toHaveCount(0);
  await expect(visibility.getByRole('button', { name: 'Collapse all' })).toBeDisabled();
  await localNav.getByRole('link', { name: 'Web & DNS' }).click();
  await expect(page.locator('#evidence-dns')).toBeVisible();
  await expect(page).toHaveURL(/#web-evidence$/);
  await visibility.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toBeVisible();
  await expect(page.locator('#raw-data details')).toBeVisible();
  await expect(page.locator('#raw-data details')).toHaveJSProperty('open', false);
  await page.getByRole('button', { name: 'Collapse Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toBeVisible();

  await expect(page.locator('#evidence-dns .dns-card')).toHaveJSProperty('open', false);
  await task.selectOption('acquisition');
  await expect(page.locator('#evidence-dns .dns-card')).toHaveJSProperty('open', false);
  const acquisitionActions = await atAGlance.locator('.next-actions .next-action').allTextContents();
  expect(acquisitionActions.length).toBeLessThanOrEqual(3);
  expect(acquisitionActions.join(' ')).toMatch(/Review transfer dependencies/u);
  await expect(localNav.getByRole('link').evaluateAll((links) => links.map((link) => link.textContent?.trim()))).resolves.toEqual([
    'Overview',
    'Registration',
    'Relationships & history',
    'Web & DNS',
    'Source quality',
    'Case & response',
    'Advanced',
  ]);

  await visibility.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.getByRole('button', { name: 'Expand Registration evidence' })).toBeVisible();
  await expect(page.locator('#evidence-registry')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expand Source quality evidence' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
  const mobileMetricGeometry = await glanceMetrics.evaluateAll((metrics) => metrics.map((metric) => {
    const summary = metric.querySelector('summary')!;
    const box = metric.getBoundingClientRect();
    return {
      top: Math.round(box.top),
      summaryContained: summary.scrollWidth <= summary.clientWidth + 1,
      summaryHeight: summary.getBoundingClientRect().height,
    };
  }));
  expect(new Set(mobileMetricGeometry.map((metric) => metric.top)).size).toBe(4);
  expect(mobileMetricGeometry.every((metric) => metric.summaryContained && metric.summaryHeight <= 48)).toBe(true);

  await page.reload();
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(analystQuestion(page)).toHaveValue('acquisition');
  await expect(page.getByRole('region', { name: 'Choose what to review' }).getByLabel('Detail')).toHaveCount(0);
  expect(lookupRequests).toHaveLength(2);
  expect(fixtureResponses).toBe(2);
});

test('Lookup task query context is bounded, transient, and changes only result presentation', async ({ page }) => {
  const domain = 'task-context.invalid';
  const lookupRequests: string[] = [];
  await useTheme(page, 'light');
  await page.addInitScript(() => {
    localStorage.setItem('whoisleuth:lookup-presentation:v1', JSON.stringify({ version: 1, task: 'brand' }));
  });
  await page.route('**/api/lookup?*', (route) => {
    lookupRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sectionedLookupFixture(domain)),
    });
  });

  await page.goto('/lookup?depth=deep&task=acquisition#query');
  expect(lookupRequests).toEqual([]);
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(analystQuestion(page)).toHaveValue('acquisition');
  expect(lookupRequests).toHaveLength(1);
  expect(new URL(lookupRequests[0]!).searchParams.has('task')).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('whoisleuth:lookup-presentation:v1') || '{}').task)).toBe('brand');

  const acquisitionAssessment = page.locator('.availability');
  const acquisitionRisk = acquisitionAssessment.locator('.risk-band');
  const acquisitionOpportunity = acquisitionAssessment.locator('.opportunity-band');
  await expect(acquisitionRisk).toHaveCount(1);
  await expect(acquisitionRisk).toContainText('Secondary triage');
  await expect(acquisitionRisk).toContainText(/Risk model v8/u);
  await expect(acquisitionRisk).toContainText(/Evidence coverage:/u);
  await expect(acquisitionOpportunity).toHaveCount(1);
  await expect(acquisitionOpportunity).toContainText('Acquisition task only');
  await expect(acquisitionOpportunity).toContainText(/not availability, value, eligibility, price, or likely purchase success/u);
  await expect(acquisitionAssessment.locator('.exact-score')).toHaveCount(2);
  await expect(acquisitionAssessment.locator('.exact-score').first()).toBeHidden();
  await expect(acquisitionAssessment.locator('.exact-score').last()).toBeHidden();
  expect(await page.evaluate(() => {
    const glance = document.querySelector('.at-a-glance');
    const assessment = document.querySelector('.availability');
    return Boolean(glance && assessment
      && (glance.compareDocumentPosition(assessment) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  const acquisitionDetails = acquisitionAssessment.locator('.score-detail');
  await expect(acquisitionDetails).toHaveCount(2);
  await acquisitionRisk.locator('summary').click();
  await acquisitionOpportunity.locator('summary').click();
  await expect(acquisitionDetails.locator('.exact-score')).toHaveCount(2);
  await expect(acquisitionDetails.locator('.factor-list')).toHaveCount(2);
  await expect(acquisitionDetails.locator('.factor-list').first()).toBeVisible();
  const nextActions = page.locator('.at-a-glance .next-action');
  expect(await nextActions.count()).toBeLessThanOrEqual(3);
  await expect(nextActions.filter({ hasText: 'Review transfer dependencies' })).toHaveCount(1);
  await page.locator('details.detailed-assessment > summary').click();
  await expect(page.getByRole('heading', { name: 'Useful next actions' })).toHaveCount(0);
  const question = analystQuestion(page);
  for (const nonAcquisitionTask of ['general', 'brand', 'incident', 'owned']) {
    await question.selectOption(nonAcquisitionTask);
    await expect(page.locator('.availability .opportunity-band')).toHaveCount(0);
    await expect(page.locator('.availability .risk-band')).toHaveCount(1);
    await expect(page.locator('.detailed-assessment details.acquisition')).toHaveCount(0);
  }
  await question.selectOption('acquisition');
  await expect(page.locator('.availability .opportunity-band')).toHaveCount(1);
  await expect(page.locator('.detailed-assessment details.acquisition')).toBeVisible();
  await question.selectOption('brand');
  await page.evaluate(() => { window.location.hash = 'registry'; });
  await expect(page).toHaveURL(/task=acquisition#registry$/u);
  await expect(question).toHaveValue('brand');

  await page.goto('/lookup?task=ACQUISITION');
  await page.locator('#query').fill(domain);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(analystQuestion(page)).toHaveValue('brand');
  const brandAssessment = page.locator('.availability');
  const brandRisk = brandAssessment.locator('.risk-band');
  await expect(brandRisk).toHaveCount(1);
  await expect(brandAssessment.locator('.opportunity-band')).toHaveCount(0);
  await expect(brandRisk).toContainText('Secondary triage');
  await expect(brandRisk).toHaveAttribute('data-risk-band', 'lower');
  await expect(brandRisk).toContainText('A lower Risk band is neutral; review the evidence before deciding.');
  await expect(brandRisk).toContainText(/does not determine maliciousness, safety, ownership, or intent/u);
  expect(await brandRisk.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.borderColor = 'var(--accent2)';
    document.body.append(probe);
    const success = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return getComputedStyle(element).borderLeftColor !== success;
  })).toBe(true);
  await brandRisk.locator('summary').click();
  const brandDetails = brandAssessment.locator('.score-detail');
  await expect(brandDetails).toHaveCount(1);
  await expect(brandDetails.locator('.exact-score')).toContainText(/\/100/u);
  await expect(brandDetails.locator('.factor-list')).toBeVisible();
  const scoreCharts = brandDetails.locator('.factor-chart');
  await expect(scoreCharts).toHaveCount(1);
  expect(await scoreCharts.evaluateAll((charts) => charts.every((chart) => {
    const chartRect = chart.getBoundingClientRect();
    const labels = [...chart.querySelectorAll<HTMLElement>('.factor-label')];
    return chart.scrollWidth <= chart.clientWidth + 1
      && labels.length > 0
      && labels.every((label) => {
        const rect = label.getBoundingClientRect();
        return rect.left >= chartRect.left - 1
          && rect.right <= chartRect.right + 1
          && label.scrollWidth <= label.clientWidth + 1;
      });
  }))).toBe(true);
  for (const theme of ['Dark', 'Light'] as const) {
    await page.getByRole('button', { name: /^Colour theme,/u }).click();
    await page.getByRole('option', { name: `${theme} theme` }).click();
    await expect(brandRisk).toBeVisible();
    await expect(brandDetails.locator('.factor-list')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  expect(lookupRequests).toHaveLength(2);
  expect(lookupRequests.every((url) => !new URL(url).searchParams.has('task'))).toBe(true);

  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('a task-only Lookup navigation preserves the existing in-memory depth choice', async ({ page }) => {
  await page.goto('/lookup');
  await page.getByRole('radio', { name: /Fast/u }).check();
  await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/ }).click();
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/lookup?task=acquisition';
    link.textContent = 'Open task context';
    document.body.append(link);
    link.click();
  });
  await expect(page).toHaveURL(/\/lookup\?task=acquisition$/u);
  await expect(page.getByRole('radio', { name: /Fast/u })).toBeChecked();
});

test('same-route Lookup URL changes reconcile retained evidence, depth, and transient task context', async ({ page }) => {
  test.slow();
  const retainedDomain = 'retained-fast.invalid';
  await page.addInitScript(() => {
    localStorage.setItem('whoisleuth:lookup-presentation:v1', JSON.stringify({ version: 1, task: 'brand' }));
  });
  await page.route('**/api/lookup?*', async (route) => {
    const url = new URL(route.request().url());
    const domain = url.searchParams.get('q') || retainedDomain;
    if (domain === '192.0.2.20' || domain === 'AS64497') {
      const type = domain.startsWith('AS') ? 'asn' : 'ipv4';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          query: domain,
          type,
          availability: { applicable: false, type },
          rdap: { upstreamStatus: 200, parsed: {} },
          whois: { skipped: true, detail: 'WHOIS is omitted in fast RDAP-only mode.' },
          diagnostics: {
            rdap: { status: 'success' },
            whois: { status: 'skipped' },
            availability: { status: 'not_applicable' },
          },
        }),
      });
      return;
    }
    const fixture = sectionedLookupFixture(domain);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...fixture,
        availability: { ...fixture.availability, deepScanComplete: url.searchParams.get('fast') !== '1' },
      }),
    });
  });
  const navigate = async (href: string) => {
    await page.evaluate((destination) => {
      const link = document.createElement('a');
      link.href = destination;
      link.textContent = 'Lookup context link';
      document.body.append(link);
      link.click();
    }, href);
    await expect.poll(() => {
      const current = new URL(page.url());
      return `${current.pathname}${current.search}`;
    }).toBe(href);
  };

  await page.goto('/lookup');
  await page.locator('#query').fill(retainedDomain);
  await page.getByRole('radio', { name: /Fast/u }).check();
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();

  await navigate('/lookup?depth=deep&task=acquisition');
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await expect(page.locator('#query')).toHaveValue(retainedDomain);
  await expect(page.locator('#result')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(analystQuestion(page)).toHaveValue('acquisition');

  await navigate('/lookup?task=incident');
  await expect(page.getByRole('radio', { name: /Deep/u })).toBeChecked();
  await expect(analystQuestion(page)).toHaveValue('incident');
  await navigate('/lookup');
  await expect(analystQuestion(page)).toHaveValue('brand');

  await page.getByRole('radio', { name: /Fast/u }).check();
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await navigate('/lookup?q=next-target.invalid&depth=fast&task=owned');
  await expect(page.locator('#query')).toHaveValue('next-target.invalid');
  await expect(page.getByRole('radio', { name: /Fast/u })).toBeChecked();
  await expect(page.locator('#result')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run lookup' }).click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(analystQuestion(page)).toHaveValue('owned');

  await navigate('/lookup?q=%00ignored&depth=DEEP&task=OWNED');
  await expect(page.locator('#query')).toHaveValue('next-target.invalid');
  await expect(page.getByRole('radio', { name: /Fast/u })).toBeChecked();
  await expect(analystQuestion(page)).toHaveValue('brand');
  await page.goBack();
  await expect(analystQuestion(page)).toHaveValue('owned');
  await page.goBack();
  await expect(page).toHaveURL(/\/lookup$/u);
  await expect(analystQuestion(page)).toHaveValue('brand');
  await page.goForward();
  await expect(analystQuestion(page)).toHaveValue('owned');

  for (const [genericTarget, targetType] of [['192.0.2.20', 'ipv4'], ['AS64497', 'asn']] as const) {
    for (const completedDepth of ['fast', 'deep'] as const) {
      await navigate('/lookup');
      await page.locator('#query').fill(genericTarget);
      await page.getByRole('radio', { name: new RegExp(completedDepth, 'iu') }).check();
      await page.getByRole('button', { name: 'Run lookup' }).click();
      await expect(page.locator('#result')).toBeVisible();
      await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
      await page.getByRole('tab', { name: /^Evidence/u }).click();
      await expect(page.locator('.target-detail-copy')).toContainText(`${targetType} · ${completedDepth} lookup`);

      const otherDepth = completedDepth === 'fast' ? 'deep' : 'fast';
      await page.getByRole('radio', { name: new RegExp(otherDepth, 'iu') }).check();
      await expect(page.locator('.target-detail-copy')).toContainText(`${targetType} · ${completedDepth} lookup`);
      await page.locator('#console-navigation').getByRole('link', { name: /^Dashboard/u }).click();
      await page.locator('#console-navigation').getByRole('link', { name: /^Lookup/u }).click();
      await expect(page.locator('#result')).toBeVisible();
      await expect(page.getByRole('radio', { name: new RegExp(otherDepth, 'iu') })).toBeChecked();
      await page.getByRole('button', { name: 'Expand Relationships and history evidence' }).click();
      await page.getByRole('tab', { name: /^Evidence/u }).click();
      await expect(page.locator('.target-detail-copy')).toContainText(`${targetType} · ${completedDepth} lookup`);

      await navigate(`/lookup?q=${encodeURIComponent(genericTarget)}&depth=${otherDepth}`);
      await expect(page.locator('#result')).toHaveCount(0);
    }
  }
});
