import { expect, test } from './fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildLookupEvidence,
} from '../frontend/src/lib/analysis/evidence-export';

function replayEvidence(target = 'legacy.example.test'): Record<string, unknown> {
  return buildLookupEvidence({
    query: target,
    registrableDomain: target,
    type: 'domain',
    diagnostics: {
      rdap: { status: 'success', complete: true, fetchedAt: '2026-08-06T00:00:00.000Z' },
      whois: { status: 'unsupported' },
      availability: { status: 'complete' },
    },
    rdap: {
      parsed: {
        domain: target,
        registrar: { name: 'Example Registrar' },
        nameservers: [`ns1.${target}`],
      },
    },
    availability: {
      state: 'registered',
      confidence: 'high',
      dns: { status: 'success', records: {} },
      http: {
        status: 'success', complete: true, finalUrl: `https://${target}/`,
        response: {
          deliveryMetadata: {
            version: 1, status: 'success', complete: true, truncated: false,
            limitations: ['Selected-response headers are point-in-time declarations and do not prove intermediary caching, compression effectiveness, or page performance.'],
            contentEncoding: { status: 'observed', codings: ['br', 'gzip'], encoded: true, unknownCodingCount: 0 },
            cachePolicy: {
              status: 'observed', noStore: false, noCache: false, mustRevalidate: false,
              public: true, private: false, immutable: true,
              maxAgeSeconds: 3600, sMaxAgeSeconds: 120, ageSeconds: 45, unknownDirectiveCount: 0,
              maxAgePresent: true, sMaxAgePresent: true, agePresent: true,
              etag: { present: true, valid: true }, lastModified: { present: true, valid: true }, expires: { present: false, valid: null },
            },
          },
        },
      },
      tls: { status: 'unavailable' },
      pageIdentity: {
        status: 'success',
        publicationMetadata: {
          version: 1, status: 'success', complete: true, truncated: false,
          limitations: ['Counts and declarations describe only the captured static homepage HTML; they are not a full accessibility, indexing, or performance audit.'],
          robots: { status: 'observed', complete: true, truncated: false, directives: ['follow', 'index'], recognizedDirectiveCount: 2, unknownDirectiveCount: 0, conflicting: false },
          twitterCard: {
            status: 'observed', complete: true, truncated: false, cardType: 'summary_large_image', declarationCount: 3,
            titlePresent: true, descriptionPresent: false, imagePresent: true, imageAltPresent: false,
            sitePresent: false, creatorPresent: false, playerPresent: false, appPresent: false,
          },
          headings: { complete: true, truncated: false, total: 2, h1: 1, h2: 1, h3: 0, h4: 0, h5: 0, h6: 0 },
          images: { totalComplete: true, classificationComplete: true, truncated: false, total: 2, altMissing: 1, altEmpty: 0, altNonEmpty: 1, altUnclassified: 0 },
          renderBlockingCandidates: { complete: true, truncated: false, script: 1, stylesheet: 1, total: 2, scope: 'explicit-head-static-v1' },
        },
      },
    },
  }, {
    generatedAt: '2026-08-06T00:00:00.000Z',
    applicationVersion: '1.34.1',
  });
}

test('offline replay uses isolated graph identifiers and has no live evidence links', async ({ page }) => {
  let lookupRequests = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(page.url() || 'http://127.0.0.1').origin && url.pathname === '/api/lookup') {
      lookupRequests += 1;
    }
  });
  await page.goto('/lookup');
  const requestBaseline = lookupRequests;
  const replay = page.locator('details.replay');
  await replay.locator(':scope > summary').click();
  await replay.locator('input[type="file"]').first().setInputFiles({
    name: 'lookup-evidence-current.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replayEvidence())),
  });

  await expect(replay.getByText(/Loaded lookup-evidence-current\.json locally/u)).toBeVisible();
  await expect(replay.getByText('Retained normalised facts', { exact: true })).toBeVisible();
  await expect(replay.locator('.replay-result > header .chip')).toHaveClass(/factual/u);
  await expect(replay.locator('.replay-result > header .chip')).toHaveText('Registered');
  await expect(replay.locator('.source-grid article', { hasText: 'Registry RDAP' }).locator('.chip')).toHaveClass(/good/u);
  await expect(replay.locator('.source-grid article', { hasText: 'Submitted query' }).locator('.chip')).toHaveClass(/factual/u);
  const unsupported = replay.locator('.source-grid article', { hasText: 'WHOIS' }).locator('.chip');
  await expect(unsupported).toHaveClass(/unavailable/u);
  await expect(unsupported).toHaveCSS('border-style', 'dotted');
  await expect(replay.locator('.contradictions[data-tone="danger"]')).toHaveCount(0);
  await expect(replay.getByRole('region', { name: 'Historical review brief' })
    .getByText('Unknown or incomplete', { exact: true })).toBeVisible();
  await expect(replay.locator('#replay-asset-graph-title')).toBeVisible();
  await expect(replay.locator('#asset-graph-title')).toHaveCount(0);
  await expect(replay.locator('a[href^="#evidence-"]')).toHaveCount(0);
  const retainedMetadata = replay.getByRole('region', { name: 'Retained homepage metadata' });
  await expect(retainedMetadata).toBeVisible();
  const publication = retainedMetadata.locator('details').filter({ hasText: 'Publication metadata' });
  await publication.locator('summary').click();
  await expect(publication.getByText('follow, index', { exact: true })).toBeVisible();
  const delivery = retainedMetadata.locator('details').filter({ hasText: 'Delivery and cache metadata' });
  await delivery.locator('summary').click();
  await expect(delivery.getByText('3600 seconds', { exact: true })).toBeVisible();
  await expect(retainedMetadata).not.toContainText('private-header-value');
  expect(lookupRequests).toBe(requestBaseline);

  await replay.locator('input[type="file"]').first().setInputFiles({
    name: 'lookup-evidence-v26.json',
    mimeType: 'application/json',
    buffer: readFileSync(resolve(process.cwd(), 'test/fixtures/lookup-evidence-v26.json')),
  });
  await expect(replay.getByText(/Loaded lookup-evidence-v26\.json locally/u)).toBeVisible();
  await expect(replay.getByRole('region', { name: 'Retained homepage metadata' })).toHaveCount(0);
  expect(lookupRequests).toBe(requestBaseline);

  const comparisonEvidence = structuredClone(replayEvidence('example.test'));
  (comparisonEvidence.application as Record<string, unknown>).version = '1.35.0';
  await replay.locator('input[type="file"]').last().setInputFiles({
    name: 'lookup-evidence-comparison.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(comparisonEvidence)),
  });
  await expect(replay.getByText(/Compared lookup-evidence-comparison\.json locally/u)).toBeVisible();
  const interpretationDifferences = replay.locator('[data-comparison-kind="interpretation_difference"]');
  await expect(interpretationDifferences).toHaveCount(3);
  await expect(interpretationDifferences.filter({ hasText: 'Homepage publication metadata' })).toBeVisible();
  await expect(interpretationDifferences.filter({ hasText: 'HTTP delivery metadata' })).toBeVisible();
  await expect(interpretationDifferences.first()).toHaveCSS('border-style', 'solid');
  await expect(replay.locator('.comparison-status.status-success')).toHaveAttribute('role', 'status');
  expect(lookupRequests).toBe(requestBaseline);
  await expect(page).toHaveURL(/\/lookup$/u);
});

test('offline replay announces malformed files as errors and incomplete success as partial', async ({ page }) => {
  await page.goto('/lookup');
  const replay = page.locator('details.replay');
  await replay.locator(':scope > summary').click();

  const incomplete = replayEvidence();
  (incomplete.diagnostics as Record<string, Record<string, unknown>>).rdap!.status = 'partial';
  (incomplete.sources as Record<string, Record<string, unknown>>).rdap!.status = 'partial';
  await replay.locator('input[type="file"]').first().setInputFiles({
    name: 'lookup-evidence-incomplete.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(incomplete)),
  });
  await expect(replay.locator('.source-grid article', { hasText: 'Registry RDAP' }).locator('.chip')).toHaveClass(/warn/u);

  await replay.locator('input[type="file"]').first().setInputFiles({
    name: 'not-json.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{not json'),
  });
  const alert = replay.locator('.replay-status.status-error');
  await expect(alert).toHaveAttribute('role', 'alert');
  await expect(alert).toContainText('not valid JSON');
});
