import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildSharingReview } from '../cli/sharing-review.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  buildDomainControlManifest,
} from '../lib/domain-control-manifest.mts';

const NOW = '2026-08-04T00:00:00.000Z';

function savedLookup(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: NOW,
    mode: 'fast',
    query: 'share.example',
    type: 'domain',
    registrableDomain: 'share.example',
    diagnostics: {
      rdap: { status: 'success' },
      whois: { status: 'skipped' },
    },
    rdap: { parsed: { domain: 'SHARE.EXAMPLE' } },
    ...overrides,
  });
}

describe('CLI sharing review', () => {
  test('keeps structure-only evidence explicit while allowing a fully reviewed matching scope', async () => {
    const report = await buildSharingReview(savedLookup(), {
      marking: 'amber',
      recipientScope: 'organization',
      purpose: 'Reviewed incident handoff',
      humanReviewed: true,
      personalDataReviewed: true,
      redactionsConfirmed: true,
    }, NOW);
    assert.equal(report.artifact.integrity, 'structure_only');
    assert.equal(report.summary.status, 'review_cautions');
    assert.equal(report.privacy.artifactMetadataFieldsEmitted, 2);
    assert.equal(report.privacy.contentValuesEmitted, 0);
    assert.equal(JSON.stringify(report).includes('Reviewed incident handoff'), false);
  });

  test('blocks a requested downgrade from imported TLP and unreviewed sensitive fields', async () => {
    const report = await buildSharingReview(savedLookup({
      markings: ['TLP:RED'],
      rawWhois: 'not emitted',
      email: 'not emitted',
    }), {
      marking: 'clear',
      recipientScope: 'public',
      purpose: 'External report',
      humanReviewed: false,
      personalDataReviewed: false,
      redactionsConfirmed: false,
    }, NOW);
    assert.equal(report.sharing.strictestImportedMarking, 'TLP:RED');
    assert.equal(report.sharing.effectiveMarking, 'TLP:RED');
    assert.equal(report.summary.status, 'blocked');
    assert.ok(report.summary.block >= 4);
    assert.equal(JSON.stringify(report).includes('not emitted'), false);
  });

  test('does not claim a bounded key scan proves sensitive data is absent', async () => {
    const report = await buildSharingReview(savedLookup(), {
      marking: 'green',
      recipientScope: 'community',
      purpose: 'Community review',
      humanReviewed: true,
      personalDataReviewed: false,
      redactionsConfirmed: false,
    }, NOW);
    assert.equal(report.findings.find((finding) => finding.id === 'personal-data')?.state, 'caution');
    assert.match(report.limitations.join(' '), /can miss sensitive meaning/u);
  });

  test('blocks a supported artifact whose integrity digest no longer matches', async () => {
    const manifest = buildDomainControlManifest({
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: 1,
      expiresAt: '2026-09-04T00:00:00.000Z',
      entries: [{ domain: 'control.example', nameservers: ['ns1.control.example'] }],
    }, NOW);
    const tampered = JSON.stringify({ ...manifest, expiresAt: '2026-10-04T00:00:00.000Z' });
    const report = await buildSharingReview(tampered, {
      marking: 'amber',
      recipientScope: 'organization',
      purpose: 'Reviewed handoff',
      humanReviewed: true,
      personalDataReviewed: true,
      redactionsConfirmed: true,
    }, NOW);
    assert.equal(report.artifact.integrity, 'failed');
    assert.equal(report.findings.find((finding) => finding.id === 'integrity')?.state, 'block');
    assert.equal(report.summary.status, 'blocked');
  });

  test('recognizes explicit extended marking keys and rejects unsafe metadata display', async () => {
    const report = await buildSharingReview(JSON.stringify({
      schema: 'unsafe\u001b[2J-schema',
      version: 1,
      trafficLightProtocol: 'TLP:GREEN',
      remark: 'TLP:RED',
    }), {
      marking: 'green',
      recipientScope: 'named-recipients',
      purpose: 'Named review',
      humanReviewed: true,
      personalDataReviewed: true,
      redactionsConfirmed: true,
    }, NOW);
    assert.equal(report.artifact.schema, null);
    assert.equal(report.privacy.artifactMetadataFieldsEmitted, 1);
    assert.equal(report.sharing.strictestImportedMarking, 'TLP:GREEN');
  });
});
