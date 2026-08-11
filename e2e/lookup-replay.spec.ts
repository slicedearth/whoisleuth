import { expect, test } from './fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/evidence-export';

function replayEvidence(): Record<string, unknown> {
  const target = 'legacy.example.test';
  return {
    schema: LOOKUP_EVIDENCE_SCHEMA,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    generatedAt: '2026-08-06T00:00:00.000Z',
    application: { name: 'WHOISleuth', version: '1.34.1' },
    query: {
      submitted: target,
      registrableDomain: target,
      type: 'domain',
    },
    diagnostics: {
      rdap: { status: 'success', complete: true, fetchedAt: '2026-08-06T00:00:00.000Z' },
      whois: { status: 'unsupported' },
    },
    sources: {
      rdap: {
        status: 'success', complete: true,
        parsed: {
          domain: target,
          registrar: { name: 'Example Registrar' },
          nameservers: [`ns1.${target}`],
        },
      },
      whois: { status: 'unsupported' },
      reverseDns: null,
      network: null,
      securityTxt: null,
      sslbl: null,
    },
    analysis: {
      availability: {
        state: 'registered',
        confidence: 'high',
        dns: { status: 'success', records: {} },
        http: { status: 'success', complete: true, finalUrl: `https://${target}/` },
        tls: { status: 'unavailable' },
      },
      registryComparison: { fields: [{ label: 'Registrar', status: 'conflict' }] },
      registrarPublicationComparison: null,
    },
  };
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
  await expect(replay.locator('.source-grid article', { hasText: 'Registry RDAP' }).locator('.chip')).toHaveClass(/factual/u);
  await expect(replay.locator('.source-grid article', { hasText: 'Submitted query' }).locator('.chip')).toHaveClass(/factual/u);
  const unsupported = replay.locator('.source-grid article', { hasText: 'WHOIS' }).locator('.chip');
  await expect(unsupported).toHaveClass(/unavailable/u);
  await expect(unsupported).toHaveCSS('border-style', 'dotted');
  await expect(replay.locator('.contradictions[data-tone="danger"]')).toBeVisible();
  await expect(replay.locator('#replay-asset-graph-title')).toBeVisible();
  await expect(replay.locator('#asset-graph-title')).toHaveCount(0);
  await expect(replay.locator('a[href^="#evidence-"]')).toHaveCount(0);
  expect(lookupRequests).toBe(requestBaseline);

  const compatibility = JSON.parse(readFileSync(
    resolve(process.cwd(), 'test/fixtures/lookup-evidence-v25-compatibility.json'),
    'utf8',
  )) as { cases: Array<{ name: string; document: Record<string, unknown> }> };
  const legacy = compatibility.cases.find((item) => item.name === 'fast-whois-skipped');
  if (!legacy) throw new Error('The frozen schema-25 mismatch fixture is missing.');
  await replay.locator('input[type="file"]').first().setInputFiles({
    name: 'lookup-evidence-v25.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy.document)),
  });

  await expect(replay.getByText(/Loaded lookup-evidence-v25\.json locally/u)).toBeVisible();
  await replay.locator('details.limits > summary').click();
  await expect(replay).toContainText('retained diagnostics are authoritative');
  expect(lookupRequests).toBe(requestBaseline);

  const comparisonEvidence = replayEvidence();
  (comparisonEvidence.application as Record<string, unknown>).version = '1.35.0';
  await replay.locator('input[type="file"]').last().setInputFiles({
    name: 'lookup-evidence-comparison.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(comparisonEvidence)),
  });
  await expect(replay.getByText(/Compared lookup-evidence-comparison\.json locally/u)).toBeVisible();
  await expect(replay.locator('[data-comparison-kind="interpretation_difference"]')).toBeVisible();
  await expect(replay.locator('[data-comparison-kind="interpretation_difference"]')).toHaveCSS('border-style', 'solid');
  await expect(replay.locator('.comparison-status.status-success')).toHaveAttribute('role', 'status');
  expect(lookupRequests).toBe(requestBaseline);
  await expect(page).toHaveURL(/\/lookup$/u);
});

test('offline replay announces malformed files as errors and incomplete success as partial', async ({ page }) => {
  await page.goto('/lookup');
  const replay = page.locator('details.replay');
  await replay.locator(':scope > summary').click();

  const incomplete = replayEvidence();
  (incomplete.diagnostics as Record<string, Record<string, unknown>>).rdap!.complete = false;
  (incomplete.sources as Record<string, Record<string, unknown>>).rdap!.complete = false;
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
