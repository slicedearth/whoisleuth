import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { gzipSync, zipSync } from 'fflate';

import {
  buildMailReportReview,
  expandMailReportFile,
  parseMailReportFiles,
} from '../frontend/src/lib/analysis/mail-report-workbench.ts';

const encoder = new TextEncoder();
const ISO = '2026-08-04T00:00:00.000Z';

const DMARC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feedback>
  <report_metadata><org_name>Example Reporter</org_name><report_id>report-1</report_id><date_range><begin>1785801600</begin><end>1785888000</end></date_range></report_metadata>
  <policy_published><domain>example.test</domain></policy_published>
  <record><row><source_ip>192.0.2.10</source_ip><count>12</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf></policy_evaluated></row><identifiers><header_from>example.test</header_from></identifiers></record>
  <record><row><source_ip>198.51.100.7</source_ip><count>3</count><policy_evaluated><disposition>reject</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row><identifiers><header_from>outside.example</header_from></identifiers></record>
</feedback>`;

const TLS_REPORT = {
  'organization-name': 'Example Reporter',
  'report-id': 'tls-1',
  'date-range': {
    'start-datetime': '2026-08-03T00:00:00Z',
    'end-datetime': '2026-08-04T00:00:00Z',
  },
  policies: [{
    policy: {
      'policy-type': 'sts',
      'policy-domain': 'example.test',
      'mx-host': ['mx1.example.test'],
    },
    summary: {
      'total-successful-session-count': 20,
      'total-failure-session-count': 4,
    },
    'failure-details': [
      { 'result-type': 'certificate-expired', 'failed-session-count': 3 },
      { 'result-type': 'certificate-expired', 'failed-session-count': 1 },
    ],
  }],
};

describe('local aggregate mail report parsing', () => {
  test('withholds an old review while retained reports are reconciled to changed profile scope', () => {
    const source = readFileSync(new URL('../frontend/src/lib/components/MailReportWorkbench.svelte', import.meta.url), 'utf8');
    const reconciliation = source.slice(
      source.indexOf('} else if (reports.length) {'),
      source.indexOf('</script>'),
    );
    assert.ok(reconciliation.indexOf('review = null;') >= 0);
    assert.ok(reconciliation.indexOf('busy = true;') > reconciliation.indexOf('review = null;'));
    assert.ok(reconciliation.indexOf('buildMailReportReview') > reconciliation.indexOf('busy = true;'));
    assert.match(source, /disabled=\{!review \|\| busy\}/u);
  });

  test('parses bounded DMARC XML without expanding document entities', async () => {
    const [report] = await parseMailReportFiles('aggregate.xml', encoder.encode(DMARC_XML));
    assert.equal(report?.kind, 'dmarc');
    if (!report || report.kind !== 'dmarc') throw new Error('Expected one DMARC report.');
    assert.equal(report.domain, 'example.test');
    assert.equal(report.totalMessages, 15);
    assert.deepEqual(report.records[0], {
      sourceIp: '192.0.2.10',
      count: 12,
      disposition: 'none',
      dkim: 'pass',
      spf: 'fail',
      headerFrom: 'example.test',
    });
    assert.match(report.source.digestSha256, /^sha256:[a-f0-9]{64}$/u);

    await assert.rejects(
      () => parseMailReportFiles('entity.xml', encoder.encode(`<!DOCTYPE feedback [<!ENTITY xxe SYSTEM "file:///secret">]><feedback>&xxe;</feedback>`)),
      /document types or entities/u,
    );
  });

  test('reduces nested markup and encoded angle brackets to plain report text', async () => {
    const markedUp = DMARC_XML.replace(
      '<org_name>Example Reporter</org_name>',
      '<org_name>Example <b>Reporter</b> &lt;script&gt;</org_name>',
    );
    const [report] = await parseMailReportFiles('aggregate.xml', encoder.encode(markedUp));
    assert.equal(report?.kind, 'dmarc');
    if (!report || report.kind !== 'dmarc') throw new Error('Expected one DMARC report.');
    assert.equal(report.organization, 'Example Reporter script');
    assert.doesNotMatch(report.organization ?? '', /[<>]/u);
  });

  test('scans adversarial unmatched XML tags within a bounded main-thread cost', { timeout: 1_000 }, async () => {
    const malformed = `<feedback>${'<record>'.repeat(50_000)}</feedback>`;
    const [report] = await parseMailReportFiles('aggregate.xml', encoder.encode(malformed));
    assert.equal(report?.kind, 'dmarc');
    if (!report || report.kind !== 'dmarc') throw new Error('Expected one DMARC report.');
    assert.equal(report.records.length, 0);
  });

  test('parses TLS-RPT policy outcomes and aggregates repeated failure types', async () => {
    const [report] = await parseMailReportFiles('tls.json', encoder.encode(JSON.stringify(TLS_REPORT)));
    assert.equal(report?.kind, 'tls-rpt');
    if (!report || report.kind !== 'tls-rpt') throw new Error('Expected one TLS-RPT report.');
    assert.equal(report.successfulSessions, 20);
    assert.equal(report.failedSessions, 4);
    assert.equal(report.periodStart, '2026-08-03T00:00:00.000Z');
    assert.deepEqual(report.policies[0]?.failureTypes, [{ type: 'certificate-expired', count: 4 }]);
  });

  test('supports bounded gzip and ZIP containers while rejecting unsafe archive paths', async () => {
    const compressed = gzipSync(encoder.encode(DMARC_XML));
    const gzipReports = await parseMailReportFiles('aggregate.xml.gz', compressed);
    assert.equal(gzipReports[0]?.kind, 'dmarc');

    const archive = zipSync({
      'aggregate.xml': encoder.encode(DMARC_XML),
      'tls.json': encoder.encode(JSON.stringify(TLS_REPORT)),
      'ignored.txt': encoder.encode('not a report'),
    });
    const archiveReports = await parseMailReportFiles('reports.zip', archive);
    assert.deepEqual(archiveReports.map((report) => report.kind).sort(), ['dmarc', 'tls-rpt']);

    const unsafe = zipSync({ '../outside.xml': encoder.encode(DMARC_XML) });
    assert.throws(() => expandMailReportFile('unsafe.zip', unsafe), /unsafe path/u);
  });

  test('builds a deterministic profile-scoped review without changing evidence meaning', async () => {
    const reports = [
      ...await parseMailReportFiles('aggregate.xml', encoder.encode(DMARC_XML)),
      ...await parseMailReportFiles('tls.json', encoder.encode(JSON.stringify(TLS_REPORT))),
    ];
    const review = await buildMailReportReview(reports, ['official.example'], ISO);
    assert.deepEqual(review.summary, {
      dmarcReports: 1,
      tlsReports: 1,
      dmarcMessages: 15,
      dmarcDkimPass: 12,
      dmarcSpfPass: 0,
      dmarcBothFailed: 3,
      tlsSuccessfulSessions: 20,
      tlsFailedSessions: 4,
      truncatedReports: 0,
    });
    assert.deepEqual(review.profileScope, {
      officialDomains: ['official.example'],
      outsideScopeDomains: ['example.test'],
    });
    assert.match(review.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    const repeated = await buildMailReportReview(reports, ['official.example'], ISO);
    assert.equal(repeated.integrity.digestSha256, review.integrity.digestSha256);
  });
});
