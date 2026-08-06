import { expect, test } from './fixtures';
import {
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/evidence-export';

function replayEvidence(): Record<string, unknown> {
  return {
    schema: LOOKUP_EVIDENCE_SCHEMA,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    generatedAt: '2026-08-06T00:00:00.000Z',
    application: { name: 'WHOISleuth', version: '1.34.1' },
    query: {
      submitted: 'replay.example',
      registrableDomain: 'replay.example',
      type: 'domain',
    },
    diagnostics: {
      rdap: { status: 'success', fetchedAt: '2026-08-06T00:00:00.000Z' },
      whois: { status: 'unsupported' },
    },
    sources: {
      rdap: {
        status: 'success',
        parsed: {
          domain: 'replay.example',
          registrar: { name: 'Example Registrar' },
          nameservers: ['ns1.replay.example'],
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
        http: { status: 'success', finalUrl: 'https://replay.example/' },
        tls: { status: 'unavailable' },
      },
      registryComparison: null,
      registrarPublicationComparison: null,
    },
  };
}

test('offline replay uses isolated graph identifiers and has no live evidence links', async ({ page }) => {
  await page.goto('/lookup');
  const replay = page.locator('details.replay');
  await replay.locator(':scope > summary').click();
  await replay.locator('input[type="file"]').first().setInputFiles({
    name: 'lookup-evidence.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(replayEvidence())),
  });

  await expect(replay.getByText(/Loaded lookup-evidence\.json locally/u)).toBeVisible();
  await expect(replay.locator('#replay-asset-graph-title')).toBeVisible();
  await expect(replay.locator('#asset-graph-title')).toHaveCount(0);
  await expect(replay.locator('a[href^="#evidence-"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/lookup$/u);
});
