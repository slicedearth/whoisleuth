import { expect, test } from './fixtures';
import {
  failNextBrowserLocalManifestWrite,
  holdBrowserLocalReads,
  migrateLegacyBrowserData,
  readBrowserLocalCollection,
} from './helpers';
import { caseRecord } from './case-test-fixtures';

const NOW = '2026-08-15T00:00:00.000Z';

function campaign(id: string, name: string) {
  return {
    id,
    name,
    description: '',
    domains: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function relationship(id: string, value: string) {
  return {
    id,
    type: 'ip_address',
    label: 'Shared IP address',
    method: 'Exact normalised address',
    normalizedValue: value,
    displayValue: value,
    domains: [`${id}-a.invalid`, `${id}-b.invalid`],
    description: 'Bounded retained relationship fixture.',
    classification: 'derived',
    source: 'bulk_relationship_analysis',
    sourceVersion: 1,
    observedAt: NOW,
    retainedAt: NOW,
    complete: true,
    truncated: false,
    limitations: ['Shared infrastructure is not proof of common control.'],
  };
}

function bulkSession(id: string, name: string) {
  return {
    id,
    name,
    mode: 'fast',
    state: 'partial',
    inputDigest: `sha256:${(id === 'session-first' ? 'a' : 'b').repeat(64)}`,
    domains: [`${id}.invalid`],
    results: [],
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
    startedAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

function watchlist(domain: string) {
  return {
    updatedAt: NOW,
    results: [{ domain, availability: 'registered', scanDepth: 'fast', mutationTypes: [] }],
    baseline: [],
    history: [],
  };
}

function ctHistoryEntry(query: string, domain: string) {
  return {
    query,
    baselineAt: NOW,
    updatedAt: NOW,
    domains: [domain],
    history: [{
      checkedAt: NOW,
      resultCount: 1,
      certificateCount: 1,
      newCount: 1,
      newDomains: [domain],
      truncated: false,
    }],
    discardedCheckCount: 0,
    discardedCheckCountKnown: true,
    discardedCheckCountCapped: false,
  };
}

test('case deletion restores focus after failure, then advances and falls back', async ({ page }) => {
  await page.goto('/monitor?view=cases');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: 12,
      cases: [
        caseRecord({ id: 'focus-case-first', domain: 'focus-first.invalid' }),
        caseRecord({ id: 'focus-case-second', domain: 'focus-second.invalid' }),
      ],
    },
  }, { clearStorage: true });

  await page.locator('#case-head-focus-case-first').click();
  const firstDelete = page.locator('#case-delete-focus-case-first');
  await expect(firstDelete).toBeVisible();
  await firstDelete.focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await firstDelete.click();
  await expect(firstDelete).toBeFocused();

  await failNextBrowserLocalManifestWrite(page, 'cases');
  page.once('dialog', (dialog) => dialog.accept());
  await firstDelete.click();
  await expect(firstDelete).toBeVisible();
  await expect(firstDelete).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await firstDelete.click();
  const secondHead = page.locator('#case-head-focus-case-second');
  await expect(secondHead).toBeVisible();
  await expect(secondHead).toBeFocused();

  await secondHead.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#case-delete-focus-case-second').click();
  const newCase = page.locator('#new-case');
  await expect(newCase).toBeVisible();
  await expect(newCase).toBeFocused();
});

test('case deletion on a sole trailing page focuses the nearest previous case', async ({ page }) => {
  await page.goto('/monitor?view=cases');
  const cases = Array.from({ length: 26 }, (_, index) => {
    const sequence = index + 1;
    return caseRecord({
      id: `page-case-${String(sequence).padStart(2, '0')}`,
      domain: `page-${String(sequence).padStart(2, '0')}.invalid`,
      updatedAt: new Date(Date.UTC(2026, 5, 27 - sequence)).toISOString(),
    });
  });
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': { version: 12, cases },
  }, { clearStorage: true });

  await page.getByRole('navigation', { name: 'Case pages' }).getByRole('button', { name: 'Next' }).click();
  await page.locator('#case-head-page-case-26').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#case-delete-page-case-26').click();
  await expect(page.locator('#case-head-page-case-25')).toBeVisible();
  await expect(page.locator('#case-head-page-case-25')).toBeFocused();
});

test('delayed case deletion does not steal focus after leaving the Cases view', async ({ page }) => {
  await page.goto('/monitor?view=cases');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-cases-v1': {
      version: 12,
      cases: [caseRecord({ id: 'delayed-case-focus', domain: 'delayed-case.invalid' })],
    },
  }, { clearStorage: true });
  await page.locator('#case-head-delayed-case-focus').click();
  const beforeDeletion = await readBrowserLocalCollection(page, 'cases', { minimumRecords: 1 });
  page.once('dialog', (dialog) => dialog.accept());
  await holdBrowserLocalReads(page, 1_200, '#case-delete-delayed-case-focus');
  const timelineTab = page.getByRole('tab', { name: /Timeline/u });
  await timelineTab.click();
  await expect(timelineTab).toBeFocused();
  const committed = await readBrowserLocalCollection(page, 'cases', {
    minimumRevision: beforeDeletion.manifest.revision + 1,
  });
  expect(committed.records.map((record) => record.value.id)).not.toContain('delayed-case-focus');
  await expect(timelineTab).toBeFocused();
});

test('saved Bulk session deletion advances to the next delete action and then the editor', async ({ page }) => {
  await page.goto('/bulk');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-bulk-sessions-v1': {
      schema: 'whoisleuth.bulk-sessions',
      version: 3,
      sessions: [
        bulkSession('session-first', 'First saved review'),
        bulkSession('session-second', 'Second saved review'),
      ],
    },
  }, { clearStorage: true });

  const firstDelete = page.locator('#bulk-session-delete-session-first');
  await expect(firstDelete).toBeVisible();
  await firstDelete.focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await firstDelete.click();
  await expect(firstDelete).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await firstDelete.click();
  const secondDelete = page.locator('#bulk-session-delete-session-second');
  await expect(secondDelete).toBeVisible();
  await expect(secondDelete).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await secondDelete.click();
  const editor = page.locator('#bulk-session-name');
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
});

test('retained relationship deletion advances and then focuses the stable heading', async ({ page }) => {
  await page.goto('/monitor?view=relationships');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-relationship-observations-v1': {
      schema: 'whoisleuth.relationship-observations',
      version: 1,
      observations: [
        relationship('relationship-focus-first', '192.0.2.10'),
        relationship('relationship-focus-second', '192.0.2.11'),
      ],
    },
  }, { clearStorage: true });

  const firstDelete = page.locator('.retained-observations li', { hasText: '192.0.2.10' }).getByRole('button', { name: 'Delete retained observation' });
  await expect(firstDelete).toBeVisible();
  await firstDelete.focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await firstDelete.click();
  await expect(firstDelete).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await firstDelete.click();
  const secondDelete = page.locator('.retained-observations li', { hasText: '192.0.2.11' }).getByRole('button', { name: 'Delete retained observation' });
  await expect(secondDelete).toBeVisible();
  await expect(secondDelete).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await secondDelete.click();
  const heading = page.locator('#retained-observation-title');
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
});

test('certificate-history deletion advances and clear-all falls back to the query', async ({ page }) => {
  await page.goto('/discover');
  await migrateLegacyBrowserData(page, {
    'whoisleuth:ct-search-history:v1': {
      version: 2,
      entries: [
        ctHistoryEntry('first focus search', 'first-focus.invalid'),
        ctHistoryEntry('second focus search', 'second-focus.invalid'),
      ],
    },
  }, { clearStorage: true });
  await page.getByRole('tab', { name: 'Certificates' }).click();
  const history = page.locator('details.ct-history');
  await history.locator(':scope > summary').click();

  const firstDelete = history.getByRole('button', { name: 'Delete first focus search certificate history' });
  await expect(firstDelete).toBeVisible();
  await firstDelete.focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await firstDelete.click();
  await expect(firstDelete).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await firstDelete.click();
  const secondDelete = history.getByRole('button', { name: 'Delete second focus search certificate history' });
  await expect(secondDelete).toBeVisible();
  await expect(secondDelete).toBeFocused();

  const clear = history.getByRole('button', { name: 'Clear all certificate history' });
  await clear.focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await clear.click();
  await expect(clear).toBeFocused();
  page.once('dialog', (dialog) => dialog.accept());
  await clear.click();
  const query = page.locator('#discovery-seed');
  await expect(query).toBeVisible();
  await expect(query).toBeFocused();
});

test('delayed certificate-history deletion does not steal focus after changing discovery mode', async ({ page }) => {
  await page.goto('/discover');
  await migrateLegacyBrowserData(page, {
    'whoisleuth:ct-search-history:v1': {
      version: 2,
      entries: [ctHistoryEntry('delayed certificate focus', 'delayed-certificate.invalid')],
    },
  }, { clearStorage: true });
  await page.getByRole('tab', { name: 'Certificates' }).click();
  const history = page.locator('details.ct-history');
  await history.locator(':scope > summary').click();
  const beforeDeletion = await readBrowserLocalCollection(page, 'ct_history', { minimumRecords: 1 });
  page.once('dialog', (dialog) => dialog.accept());
  await holdBrowserLocalReads(page, 1_200, '[data-ct-history-delete="0"]');
  const nameserverTab = page.getByRole('tab', { name: 'Nameservers' });
  await nameserverTab.click();
  await expect(nameserverTab).toBeFocused();
  const committed = await readBrowserLocalCollection(page, 'ct_history', {
    minimumRevision: beforeDeletion.manifest.revision + 1,
  });
  expect(committed.records.map((record) => record.value.query)).not.toContain('delayed certificate focus');
  await expect(nameserverTab).toBeFocused();
});

test('campaign deletion advances to the next campaign and then the creation field', async ({ page }) => {
  await page.goto('/monitor?view=campaigns');
  await migrateLegacyBrowserData(page, {
    'whoisleuth-campaigns-v1': {
      version: 1,
      campaigns: [
        campaign('campaign-focus-first', 'First focus campaign'),
        campaign('campaign-focus-second', 'Second focus campaign'),
      ],
    },
  }, { clearStorage: true });

  await page.locator('#campaign-head-campaign-focus-first').click();
  const firstDelete = page.locator('#campaign-delete-campaign-focus-first');
  await expect(firstDelete).toBeVisible();
  await firstDelete.focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await firstDelete.click();
  await expect(firstDelete).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await firstDelete.click();
  const secondHead = page.locator('#campaign-head-campaign-focus-second');
  await expect(secondHead).toBeVisible();
  await expect(secondHead).toBeFocused();

  await secondHead.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#campaign-delete-campaign-focus-second').click();
  const creator = page.locator('#new-campaign');
  await expect(creator).toBeVisible();
  await expect(creator).toBeFocused();
});

test('watchlist deletion advances and clear-all falls back to the primary empty action', async ({ page }) => {
  await page.goto('/monitor?view=watchlists');
  await migrateLegacyBrowserData(page, {
    'whois-rdap-watchlist-v1': {
      schema: 'whoisleuth.watchlists',
      version: 2,
      watchlists: {
        'First focus watchlist': watchlist('first-watchlist.invalid'),
        'Second focus watchlist': watchlist('second-watchlist.invalid'),
      },
    },
  }, { clearStorage: true });

  const firstDelete = page.getByRole('row', { name: /First focus watchlist/u }).getByRole('button', { name: 'Delete' });
  await expect(firstDelete).toBeVisible();
  await firstDelete.focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await firstDelete.click();
  await expect(firstDelete).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await firstDelete.click();
  const secondDelete = page.getByRole('row', { name: /Second focus watchlist/u }).getByRole('button', { name: 'Delete' });
  await expect(secondDelete).toBeVisible();
  await expect(secondDelete).toBeFocused();

  const clear = page.getByRole('button', { name: 'Clear all' });
  await clear.focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await clear.click();
  await expect(clear).toBeFocused();
  page.once('dialog', (dialog) => dialog.accept());
  await clear.click();
  const fallback = page.locator('#empty-watchlist-open-bulk');
  await expect(fallback).toBeVisible();
  await expect(fallback).toBeFocused();
});
