import type { Page } from '@playwright/test';
import { expect } from './fixtures';

type ConsoleView = 'cases' | 'inbox' | 'campaigns' | 'relationships' | 'timeline' | 'certificates' | 'watchlists' | 'rules';
const monitoringViews = new Set<ConsoleView>(['timeline', 'certificates', 'watchlists', 'rules']);
const viewLabels = { inbox: 'Inbox', campaigns: 'Campaigns', relationships: 'Relationships', timeline: 'Timeline', certificates: 'Certificates', watchlists: 'Watchlists', rules: 'Custom rules' } as const;

/** Exercise the visible navigation without making each domain test own its layout. */
export async function openConsoleView(page: Page, view: ConsoleView) {
  const url = new URL(page.url());
  if (view === 'cases' && url.pathname === '/cases') {
    await expect(page.getByRole('region', { name: 'Cases', exact: true })).toBeVisible();
    return;
  }
  const current = (url.searchParams.get('view') ?? 'inbox') as ConsoleView;
  const needsDestination = view === 'cases' || url.pathname !== '/monitor'
    || monitoringViews.has(current) !== monitoringViews.has(view);
  if (needsDestination) {
    const toggle = page.getByRole('button', { name: 'Toggle navigation', exact: true, includeHidden: true });
    await expect(toggle).toBeAttached();
    if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await page.getByRole('navigation', { name: 'Console', exact: true }).getByRole('link', {
      name: view === 'cases' ? 'Cases' : monitoringViews.has(view) ? 'Monitoring' : 'Review inbox', exact: true,
    }).click();
  }
  if (view === 'cases') {
    await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toBeVisible();
    return;
  }
  const tab = page.getByRole('tablist', { name: 'Monitor views', exact: true }).getByRole('tab', { name: new RegExp(`^${viewLabels[view]}\\b`) });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export async function openCaseSection(page: Page, section: 'Summary' | 'Evidence' | 'Assessment' | 'Response' | 'History') {
  const link = page.getByRole('navigation', { name: 'Case sections', exact: true }).getByRole('link', { name: section, exact: true });
  await expect(link).toBeVisible();
  if (await link.getAttribute('aria-current') !== 'page') await link.click();
  await expect(link).toHaveAttribute('aria-current', 'page');
}

export async function openCaseMetadata(page: Page) {
  await openCaseSection(page, 'Summary');
  const details = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Edit status, tags and Brand associations' }) });
  const summary = page.getByText('Edit status, tags and Brand associations', { exact: true });
  await expect(summary).toBeVisible();
  if (await details.getAttribute('open') === null) await summary.click();
}

export async function openCaseClassification(page: Page) {
  await openCaseSection(page, 'Summary');
  const details = page.locator('.summary-editor');
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  await expect(details.locator('.workflow-details')).toBeVisible();
}

export async function openCasePacket(page: Page) {
  await openCaseSection(page, 'Response');
  const details = page.locator('details[id^="case-response-preflight-"]');
  await expect(details).toBeVisible();
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  return details;
}
