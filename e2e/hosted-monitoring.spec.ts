import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';
import type { Page, Route } from '@playwright/test';

const NOW = '2026-07-16T12:00:00.000Z';
const WATCHLIST_KEY = 'whois-rdap-watchlist-v1';

function localEntry(domain = 'alpha.invalid') {
  return {
    updatedAt: NOW,
    results: [{
      domain,
      scanDepth: 'fast',
      availability: 'registered',
      mutationTypes: [],
    }],
    baseline: [],
    history: [],
  };
}

function capability(status: 'supported' | 'disabled' | 'unavailable', reason: string | null = null) {
  return {
    version: 1,
    runtime: 'netlify',
    authoritative: true,
    features: [{
      id: 'scheduled_monitoring',
      status,
      execution: 'worker',
      scanModes: ['fast'],
      ...(reason ? { reason } : {}),
    }],
    controls: null,
    limitations: [],
  };
}

type HostedItem = {
  id: string;
  name: string;
  enabled: boolean;
  intervalHours: number;
  revision: number;
  domainCount: number;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  status: string;
  lastError: string | null;
  prunedHistoryEvents: number;
  entry: ReturnType<typeof localEntry>;
  progress: { completed: number; total: number } | null;
};

function hostedWatchlist(entry = localEntry(), overrides: Partial<HostedItem> = {}): HostedItem {
  return {
    id: 'hosted-watchlist01',
    name: 'Priority domains',
    enabled: true,
    intervalHours: 24,
    revision: 1,
    domainCount: entry.results.length,
    updatedAt: NOW,
    nextRunAt: NOW,
    lastRunAt: null,
    status: 'idle',
    lastError: null,
    prunedHistoryEvents: 0,
    entry,
    progress: null,
    ...overrides,
  };
}

function managementResponse(watchlists: HostedItem[], action: string | null = null, id: string | null = null) {
  const projected = watchlists.reduce((total, item) => (
    total + (item.enabled ? item.domainCount * (7 * 24 / item.intervalHours) : 0)
  ), 0);
  return {
    state: { schema: 'whoisleuth.scheduled-monitor', version: 1, watchlists },
    capacity: {
      version: 1,
      triggerIntervalMinutes: 5,
      lookupLimitPerInvocation: 2,
      theoreticalLookupsPerWeek: 4032,
      admittedLookupsPerWeek: 3024,
      projectedLookupsPerWeek: projected,
      remainingLookupsPerWeek: Math.max(0, 3024 - projected),
      utilizationPercent: Number((projected / 3024 * 100).toFixed(2)),
      reservePercent: 25,
    },
    ...(action ? { action, id } : {}),
  };
}

async function seedLocalWatchlist(page: Page) {
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: WATCHLIST_KEY,
    value: {
      schema: 'whoisleuth.watchlists',
      version: 2,
      watchlists: { 'Priority domains': localEntry() },
    },
  });
}

async function mockCapability(page: Page, status: 'supported' | 'disabled' | 'unavailable', reason: string | null = null) {
  await page.route('**/api/capabilities', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(capability(status, reason)),
  }));
}

async function installManagementMock(page: Page, initial: HostedItem[] = []) {
  let watchlists = structuredClone(initial);
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/api/scheduled-monitor', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managementResponse(watchlists)) });
      return;
    }
    const command = route.request().postDataJSON() as Record<string, unknown>;
    commands.push(structuredClone(command));
    let action = 'updated';
    let id = String(command.id || 'hosted-watchlist01');
    if (command.action === 'create') {
      action = 'created';
      const entry = structuredClone(command.entry) as ReturnType<typeof localEntry>;
      watchlists = [hostedWatchlist(entry, {
        name: String(command.name),
        intervalHours: Number(command.intervalHours),
      })];
      id = watchlists[0].id;
    } else if (command.action === 'update') {
      watchlists = watchlists.map((item) => item.id === command.id ? {
        ...item,
        ...(typeof command.enabled === 'boolean' ? {
          enabled: command.enabled,
          status: command.enabled ? 'idle' : 'paused',
          nextRunAt: command.enabled ? NOW : null,
        } : {}),
        ...(typeof command.intervalHours === 'number' ? { intervalHours: command.intervalHours } : {}),
        ...(command.entry ? {
          entry: structuredClone(command.entry) as ReturnType<typeof localEntry>,
          domainCount: (command.entry as ReturnType<typeof localEntry>).results.length,
        } : {}),
        revision: item.revision + 1,
        updatedAt: NOW,
      } : item);
    } else if (command.action === 'delete') {
      action = 'deleted';
      watchlists = watchlists.filter((item) => item.id !== command.id);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(managementResponse(watchlists, action, id)),
    });
  });
  return { commands, watchlists: () => structuredClone(watchlists) };
}

test('disabled hosted monitoring stays read-only and makes no management request', async ({ page }) => {
  let managementRequests = 0;
  await seedLocalWatchlist(page);
  await mockCapability(page, 'disabled', 'Scheduled monitoring is not enabled in this deployment.');
  await page.route('**/api/scheduled-monitor', (route) => {
    managementRequests += 1;
    return route.abort();
  });

  await page.goto('/monitor');
  const hosted = page.getByRole('region', { name: 'Scheduled watchlists' });
  await expect(hosted).toContainText('Disabled');
  await expect(hosted).toContainText('Ordinary watchlists stay in this browser');
  await expect(page.locator('.watchlists', { hasText: 'Priority domains' })).toBeVisible();
  expect(managementRequests).toBe(0);
});

test('a signed-in user explicitly schedules, pauses, resumes, replaces, restores, and deletes a hosted copy', async ({ page }) => {
  await seedLocalWatchlist(page);
  await mockCapability(page, 'supported');
  const mock = await installManagementMock(page);
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/monitor');
  const hosted = page.getByRole('region', { name: 'Scheduled watchlists' });
  await expect(hosted).toContainText('No watchlists are scheduled');
  await hosted.getByLabel('Browser-local watchlist').selectOption('Priority domains');
  await hosted.getByLabel('Interval').selectOption('12');
  await hosted.getByRole('button', { name: 'Schedule watchlist' }).click();

  const item = hosted.getByRole('article').filter({ hasText: 'Priority domains' });
  await expect(item).toContainText('Every 12 hours');
  await expect(item).toContainText('Idle');
  expect(mock.commands[0].action).toBe('create');
  expect(mock.commands[0].intervalHours).toBe(12);

  await item.getByRole('button', { name: 'Pause' }).click();
  await expect(item).toContainText('Paused');
  await item.getByRole('button', { name: 'Resume' }).click();
  await expect(item).toContainText('Idle');
  await item.getByRole('button', { name: 'Replace from browser' }).click();
  expect(mock.commands.at(-1)?.action).toBe('update');
  expect(mock.commands.at(-1)?.entry).toBeTruthy();

  await item.getByRole('button', { name: 'Restore to browser' }).click();
  const restored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), WATCHLIST_KEY);
  expect(restored.watchlists['Priority domains'].results[0].domain).toBe('alpha.invalid');

  await item.getByRole('button', { name: 'Delete hosted copy' }).click();
  await expect(hosted).toContainText('No watchlists are scheduled');
  expect(mock.watchlists()).toEqual([]);
  const retained = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), WATCHLIST_KEY);
  expect(retained.watchlists['Priority domains'].results[0].domain).toBe('alpha.invalid');
});

test('hosted controls stay usable without horizontal overflow on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLocalWatchlist(page);
  await mockCapability(page, 'supported');
  await installManagementMock(page, [hostedWatchlist()]);
  await page.goto('/monitor');

  const hosted = page.getByRole('region', { name: 'Scheduled watchlists' });
  await expect(hosted.getByRole('button', { name: 'Restore to browser' })).toBeVisible();
  await expect(hosted.getByRole('button', { name: 'Delete hosted copy' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
