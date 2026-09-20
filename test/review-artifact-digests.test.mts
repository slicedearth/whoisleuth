import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  resolveArtifactCanonicalization, sha256ArtifactDigestFor,
  type ArtifactCanonicalizationRoute,
} from '../packages/evidence/artifact-integrity.mts';
import { MAIL_REPORT_CANONICALIZATION_ROUTES } from '../packages/contracts/analyst-interchange.mts';
import { CAMPAIGN_TEMPORAL_CANONICALIZATION_ROUTES } from '../packages/contracts/investigation-projections.mts';
import { buildMailReportReview } from '../packages/interchange/mail-report-workbench.mts';
import { buildCampaignTemporalExport } from '../packages/investigation/campaign-temporal-review.mts';

function fixture(name: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

const families = [
  { routes: MAIL_REPORT_CANONICALIZATION_ROUTES, historicalVersion: 2, currentVersion: 3,
    historical: 'extracted-domain-lifecycle/mail-report-review-v2', current: 'extracted-domain-lifecycle/mail-report-review-v3' },
  { routes: CAMPAIGN_TEMPORAL_CANONICALIZATION_ROUTES, historicalVersion: 1, currentVersion: 2,
    historical: 'campaign-temporal-integrity-v1', current: 'extracted-domain-lifecycle/campaign-temporal-review-v2' },
] as const;

test('historical and current review digests use exact independent version routes', async () => {
  for (const family of families) {
    for (const [name, version, expected] of [
      [family.historical, family.historicalVersion, 'sorted-json-v1'],
      [family.current, family.currentVersion, 'sorted-json-v2'],
    ] as const) {
      const { integrity, ...unsigned } = fixture(name);
      assert.equal(unsigned.version, version);
      assert.equal(integrity.canonicalization, expected === 'sorted-json-v1' ? undefined : expected);
      const form = resolveArtifactCanonicalization(version, integrity.canonicalization, family.routes);
      assert.equal(form, expected);
      assert.equal(await sha256ArtifactDigestFor(unsigned, form), integrity.digestSha256);
      assert.notEqual(await sha256ArtifactDigestFor({ ...unsigned, generatedAt: '2026-01-02T00:00:00.000Z' }, form), integrity.digestSha256);
    }
  }
  assert.equal(fixture('campaign-temporal-integrity-v1').integrity.digestSha256,
    'sha256:62c282d316cff7cb6fe02de1079d47581fadd31420dad8a2613d3235a2cdccb7');
});

test('review digest routes reject swapped, missing and future declarations', () => {
  for (const family of families) {
    const routes: readonly ArtifactCanonicalizationRoute[] = family.routes;
    for (const declaration of [undefined, 'sorted-json-v1', 'sorted-json-v3']) {
      assert.throws(() => resolveArtifactCanonicalization(family.currentVersion, declaration, routes), /unsupported/u);
    }
    for (const declaration of ['sorted-json-v1', 'sorted-json-v2']) {
      assert.throws(() => resolveArtifactCanonicalization(family.historicalVersion, declaration, routes), /unsupported/u);
    }
    assert.throws(() => resolveArtifactCanonicalization(999, 'sorted-json-v2', routes), /unsupported/u);
  }
});

test('current mail and campaign writers never consult locale collation', async (context) => {
  const mail = fixture(families[0].current);
  const campaign = fixture(families[1].current);
  const collator = context.mock.method(String.prototype, 'localeCompare', () => {
    throw new Error('Persisted current digest must not use locale collation.');
  });
  const actualMail = await buildMailReportReview(mail.reports, mail.profileScope.officialDomains, mail.generatedAt);
  const actualCampaign = await buildCampaignTemporalExport(campaign.campaign, campaign.review, campaign.generatedAt);
  collator.mock.restore();
  assert.deepEqual(actualMail, mail);
  assert.deepEqual(actualCampaign, campaign);
});
