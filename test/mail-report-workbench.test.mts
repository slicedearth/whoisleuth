import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { gzipSync, Zip, ZipDeflate, zipSync } from 'fflate';
import zipFixtures from '../fixtures/zip-fixtures.mts';

import {
  buildMailReportReview,
  expandMailReportFile,
  importMailReportReview,
  MAX_DMARC_RECORDS,
  MAX_MAIL_REPORT_REVIEW_REPORTS,
  MAX_MAIL_REPORT_REVIEW_SOURCE_BYTES,
  MAX_MAIL_REPORT_EXPANDED_BYTES,
  parseMailReportFiles,
} from '../frontend/src/lib/analysis/mail-report-workbench.ts';

const { patchZipDataDescriptorUncompressedSize, patchZipDeclaredUncompressedSize } = zipFixtures;

const encoder = new TextEncoder();
const ISO = '2026-08-04T00:00:00.000Z';

async function streamingZip(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const archive = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(chunk.slice());
      total += chunk.byteLength;
      if (!final) return;
      const output = new Uint8Array(total);
      let offset = 0;
      for (const retained of chunks) {
        output.set(retained, offset);
        offset += retained.byteLength;
      }
      resolve(output);
    });
    const entry = new ZipDeflate(name);
    archive.add(entry);
    entry.push(bytes, true);
    archive.end();
  });
}

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
    await assert.rejects(
      () => parseMailReportFiles('aggregate.xml', encoder.encode(malformed)),
      /record elements must be balanced and non-nested/u,
    );
  });

  test('requires decision evidence to remain inside one feedback root and record row', async () => {
    await assert.rejects(
      () => parseMailReportFiles('detached-feedback.xml', encoder.encode(
        DMARC_XML.replace('<feedback>', '<feedback/>').replace('</feedback>', ''),
      )),
      /DMARC feedback root must appear once with content/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('missing-row.xml', encoder.encode(
        DMARC_XML.replace('<row>', '').replace('</row>', ''),
      )),
      /DMARC record row must appear once with content/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('empty-feedback.xml', encoder.encode('<feedback><report_metadata/></feedback>')),
      /must contain at least one record/u,
    );
  });

  test('rejects comment, CDATA, and processing-instruction constructs instead of normalizing them into evidence', async () => {
    const firstRecord = DMARC_XML.match(/<record>.*?<\/record>/u)?.[0];
    assert.ok(firstRecord);
    await assert.rejects(
      () => parseMailReportFiles(
        'commented-record.xml',
        encoder.encode(DMARC_XML.replace(firstRecord, `<!--${firstRecord}-->`)),
      ),
      /comments, CDATA, and processing instructions are not accepted/u,
    );
    await assert.rejects(
      () => parseMailReportFiles(
        'cdata-record.xml',
        encoder.encode(DMARC_XML.replace(firstRecord, `<![CDATA[${firstRecord}]]>`)),
      ),
      /comments, CDATA, and processing instructions are not accepted/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('unterminated-comment.xml', encoder.encode(`${DMARC_XML}<!--`)),
      /comments, CDATA, and processing instructions are not accepted/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('unterminated-cdata.xml', encoder.encode(`${DMARC_XML}<![CDATA[`)),
      /comments, CDATA, and processing instructions are not accepted/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('empty-pi.xml', encoder.encode(DMARC_XML.replace(/^<\?xml.*?\?>/u, '<??>'))),
      /comments, CDATA, and processing instructions are not accepted/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('malformed-declaration.xml', encoder.encode(DMARC_XML.replace(/^<\?xml.*?\?>/u, '<?xml?>'))),
      /XML declaration is malformed/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('encoding-mismatch.xml', encoder.encode(DMARC_XML.replace('encoding="UTF-8"', 'encoding="UTF-16"'))),
      /XML declaration is malformed/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('comment-in-tag.xml', encoder.encode(DMARC_XML.replace('<feedback>', '<feedback<!--x-->>'))),
      /comments, CDATA, and processing instructions are not accepted/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('trailing-hyphen-comment.xml', encoder.encode(DMARC_XML.replace('<feedback>', '<feedback><!--x--->'))),
      /comments, CDATA, and processing instructions are not accepted/u,
    );
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

  test('requires explicit ordered TLS-RPT timestamps and current review time', async () => {
    await assert.rejects(() => parseMailReportFiles('tls.json', encoder.encode(JSON.stringify({
      ...TLS_REPORT,
      'date-range': {
        'start-datetime': '2026-08-03T12:00:00.000',
        'end-datetime': '2026-08-04T12:00:00.000',
      },
    }))), /explicit timezones/u);
    const [offset] = await parseMailReportFiles('tls.json', encoder.encode(JSON.stringify({
      ...TLS_REPORT,
      'date-range': {
        'start-datetime': '2026-08-03T12:00:00.000+01:00',
        'end-datetime': '2026-08-04T12:00:00.000+01:00',
      },
    })));
    assert.equal(offset?.periodStart, '2026-08-03T11:00:00.000Z');
    await assert.rejects(() => buildMailReportReview(offset ? [offset] : [], [], '2026-08-04T12:00:00.000'), /explicit timezone/u);
  });

  test('rejects unavailable or malformed outcome counts instead of inventing exact totals', async () => {
    await assert.rejects(
      () => parseMailReportFiles('malformed-count.xml', encoder.encode(DMARC_XML.replace('<count>12</count>', '<count>many</count>'))),
      /DMARC message count must be an integer/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('missing-auth.xml', encoder.encode(DMARC_XML.replace('<dkim>pass</dkim>', ''))),
      /DMARC DKIM result must be pass or fail/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('negative-count.json', encoder.encode(JSON.stringify({
        ...TLS_REPORT,
        policies: [{
          ...TLS_REPORT.policies[0],
          summary: {
            ...TLS_REPORT.policies[0]!.summary,
            'total-failure-session-count': -1,
          },
        }],
      }))),
      /TLS-RPT failure session count must be an integer/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('duplicate-count.json', encoder.encode('{"policies":[],"policies":[]}')),
      /duplicate object key/u,
    );
  });

  test('rejects duplicate DMARC singleton evidence and attribution fields', async () => {
    await assert.rejects(
      () => parseMailReportFiles('duplicate-count.xml', encoder.encode(
        DMARC_XML.replace('<count>12</count>', '<count>12</count><count>999</count>'),
      )),
      /DMARC message count must appear at most once/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('duplicate-auth.xml', encoder.encode(
        DMARC_XML.replace('<dkim>pass</dkim>', '<dkim>pass</dkim><dkim>fail</dkim>'),
      )),
      /DMARC DKIM result must appear at most once/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('self-closing-count.xml', encoder.encode(
        DMARC_XML.replace('<count>12</count>', '<count>12</count><count/>'),
      )),
      /DMARC message count must appear at most once/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('self-closing-auth.xml', encoder.encode(
        DMARC_XML.replace('<dkim>pass</dkim>', '<dkim>pass</dkim><dkim/>'),
      )),
      /DMARC DKIM result must appear at most once/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('unmatched-count.xml', encoder.encode(
        DMARC_XML.replace('</count>', '</count></count>'),
      )),
      /count elements must be balanced and non-nested/u,
    );
    await assert.rejects(
      () => parseMailReportFiles('duplicate-id.xml', encoder.encode(
        DMARC_XML.replace('<report_id>report-1</report_id>', '<report_id>report-1</report_id><report_id>report-2</report_id>'),
      )),
      /DMARC report identifier must appear at most once/u,
    );
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
    assert.deepEqual(archiveReports[0]?.source.container, { format: 'zip', entries: { supplied: 3, inspected: 3, retained: 2, rejected: 0 } });

    const streamingArchive = await streamingZip('aggregate.xml', encoder.encode(DMARC_XML));
    const streamingReports = await parseMailReportFiles('streaming.zip', streamingArchive);
    assert.equal(streamingReports[0]?.kind, 'dmarc');
    const inconsistentDescriptor = patchZipDataDescriptorUncompressedSize(
      streamingArchive,
      'aggregate.xml',
      encoder.encode(DMARC_XML).byteLength + 7,
    );
    assert.throws(
      () => expandMailReportFile('inconsistent-descriptor.zip', inconsistentDescriptor),
      /inconsistent ZIP metadata/u,
    );

    const unsafe = zipSync({ '../outside.xml': encoder.encode(DMARC_XML) });
    assert.throws(() => expandMailReportFile('unsafe.zip', unsafe), /unsafe path/u);

    const understated = patchZipDeclaredUncompressedSize(zipSync({
      'large.xml': new Uint8Array(MAX_MAIL_REPORT_EXPANDED_BYTES + 1),
    }), 'large.xml', 1);
    assert.throws(
      () => expandMailReportFile('understated.zip', understated),
      /decompression limit/u,
    );
  });

  test('neutralises Unicode formatting controls in retained mail labels', async () => {
    const unsafeXml = DMARC_XML
      .replace('Example Reporter', 'Example\u202eReporter')
      .replace('report-1', 'report\u2060-1');
    const reports = await parseMailReportFiles('aggregate\u202e.xml', encoder.encode(unsafeXml));
    assert.equal(reports[0]?.source.name, 'aggregate .xml');
    assert.equal(reports[0]?.organization, 'Example Reporter');
    assert.equal(reports[0]?.reportId, 'report -1');
    assert.doesNotMatch(JSON.stringify(reports), /[\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u);
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
      state: 'complete',
      officialDomains: ['official.example'],
      outsideScopeDomains: ['example.test'],
      unresolvedScopeDomains: [],
      coverage: { supplied: 1, inspected: 1, retained: 1, rejected: 0 },
    });
    assert.match(review.integrity.digestSha256, /^sha256:[a-f0-9]{64}$/u);
    const repeated = await buildMailReportReview(reports, ['official.example'], ISO);
    assert.equal(repeated.integrity.digestSha256, review.integrity.digestSha256);
  });

  test('admits fifty thousand DMARC rows and counts every later uninspected row', async () => {
    const row = '<record><row><count>1</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf></policy_evaluated></row></record>';
    assert.equal(MAX_DMARC_RECORDS, 50_000);
    for (const supplied of [50_000, 50_003]) {
      const [report] = await parseMailReportFiles('capacity.xml.gz', gzipSync(encoder.encode(`<feedback>${row.repeat(supplied)}</feedback>`)));
      assert.ok(report?.kind === 'dmarc');
      assert.equal(report.records.length, 50_000);
      assert.equal(report.totalMessages, 50_000);
      assert.deepEqual(report.recordCoverage, { supplied, inspected: 50_000, retained: 50_000, rejected: 0 });
      assert.equal(report.truncated, supplied > 50_000);
      const review = await buildMailReportReview([report], [], ISO);
      assert.equal(review.summary.dmarcMessages, 50_000);
      if (report.truncated) assert.match(review.limitations[0] ?? '', /Uninspected input/u);
    }
  });

  test('accepts rich advertised TLS detail capacity and keeps every failure type and MX host', async () => {
    const original = TLS_REPORT.policies[0]!;
    const failures = Array.from({ length: 10_003 }, (_, i) => ({
      'result-type': `failure-${i % 150}`, 'failed-session-count': 1,
      'sending-mta-ip': '192.0.2.1', 'receiving-mx-hostname': 'mx.example',
      'receiving-mx-helo': 'mx.example', 'receiving-ip': '192.0.2.2', 'failure-reason-code': 'fixture',
    }));
    const document = { ...TLS_REPORT, policies: [{ ...original,
      policy: { ...original.policy, 'mx-host': Array.from({ length: 60 }, (_, i) => `mx-${i}.example`) },
      summary: { 'total-successful-session-count': 0, 'total-failure-session-count': 10_003 },
      'failure-details': failures,
    }] };
    const [report] = await parseMailReportFiles('capacity.json', encoder.encode(JSON.stringify(document)));
    assert.ok(report?.kind === 'tls-rpt');
    assert.equal(report.failedSessions, 10_003, 'reported summary is not replaced by the inspected detail total');
    const policy = report.policies[0]!;
    assert.equal(policy.failureTypes.length, 150);
    assert.equal(policy.failureTypes.reduce((n, item) => n + item.count, 0), 10_000);
    assert.ok(policy.failureTypes.some((item) => item.type === 'failure-149'));
    assert.equal(policy.mxHosts.length, 60);
    assert.ok(policy.mxHosts.includes('mx-59.example'));
    assert.deepEqual(policy.failureDetailCoverage, { supplied: 10_003, inspected: 10_000, retained: 10_000, rejected: 0 });
    assert.equal(report.truncated, true);
  });

  test('reports TLS policy and MX admission separately without inspecting discarded failure details', async () => {
    const policy = { ...TLS_REPORT.policies[0]!, 'failure-details': [] };
    const policies = Array.from({ length: 10_002 }, () => policy);
    policies[0] = { ...policy, policy: { ...policy.policy, 'mx-host': Array.from({ length: 10_002 }, (_, i) => `mx-${i}.example`) } };
    const [report] = await parseMailReportFiles('policies.json.gz', gzipSync(encoder.encode(JSON.stringify({ ...TLS_REPORT, policies }))));
    assert.ok(report?.kind === 'tls-rpt');
    assert.deepEqual(report.policyCoverage, { supplied: 10_002, inspected: 10_000, retained: 10_000, rejected: 0 });
    assert.deepEqual(report.policies[0]?.mxHostCoverage, { supplied: 10_002, inspected: 10_000, retained: 10_000, rejected: 0 });
    assert.equal(report.truncated, true);
  });

  test('uses full canonical profile capacity and does not label missing partial-scope domains outside', async () => {
    const reports = await parseMailReportFiles('scope.xml', encoder.encode(DMARC_XML));
    const official = [...Array.from({ length: 199 }, (_, i) => `official-${i}.example`), 'example.test'];
    const complete = await buildMailReportReview(reports, official, ISO);
    assert.equal(complete.profileScope.state, 'complete');
    assert.equal(complete.profileScope.officialDomains.length, 200);
    assert.deepEqual(complete.profileScope.outsideScopeDomains, []);
    const partial = await buildMailReportReview(reports, ['first.example', ...official], ISO);
    assert.equal(partial.profileScope.state, 'partial');
    assert.deepEqual(partial.profileScope.outsideScopeDomains, []);
    assert.deepEqual(partial.profileScope.unresolvedScopeDomains, ['example.test']);
    const invalid = await buildMailReportReview(reports, ['x'.repeat(254)], ISO);
    assert.equal(invalid.profileScope.state, 'partial');
    assert.equal(invalid.profileScope.coverage.rejected, 1);
  });

  test('retains complete report batches, deduplicates before capacity and rejects atomic overflows', async () => {
    const bytes = encoder.encode(DMARC_XML);
    const [first] = await parseMailReportFiles('one.xml', bytes);
    assert.ok(first);
    const reports = Array.from({ length: MAX_MAIL_REPORT_REVIEW_REPORTS }, (_, i) => ({ ...first, source: { ...first.source, digestSha256: i ? `sha256:${i.toString(16).padStart(64, '0')}` : first.source.digestSha256 } }));
    assert.equal((await buildMailReportReview(reports, [], ISO)).reports.length, 512);
    const repeated = await importMailReportReview([{ name: 'one.xml', bytes }], reports, [], ISO);
    assert.equal(repeated.review.reports.length, 512);
    assert.equal(repeated.duplicateReports, 1);
    const before = structuredClone(reports);
    await assert.rejects(() => importMailReportReview([{ name: 'new.xml', bytes: encoder.encode(DMARC_XML.replace('report-1', 'new-report')) }], reports, [], ISO), /512 unique aggregate reports/u);
    assert.deepEqual(reports, before);
    const exact = { ...first, source: { ...first.source, bytes: MAX_MAIL_REPORT_REVIEW_SOURCE_BYTES } };
    assert.equal((await buildMailReportReview([exact], [], ISO)).reports.length, 1);
    await assert.rejects(() => buildMailReportReview([{ ...exact, source: { ...exact.source, bytes: MAX_MAIL_REPORT_REVIEW_SOURCE_BYTES + 1 } }], [], ISO), /20 MiB/u);
    await assert.rejects(() => buildMailReportReview([...reports, first], [], ISO), /512 unique aggregate reports/u);
  });

  test('imports actual maximum report batches and does not retain unselected source content', async () => {
    const files = Array.from({ length: 16 }, (_, file) => ({ name: `batch-${file}.zip`, bytes: zipSync(Object.fromEntries(
      Array.from({ length: 32 }, (_, entry) => [`report-${entry}.xml`, encoder.encode(DMARC_XML
        .replace('report-1', `report-${file}-${entry}`).replace('</feedback>', '<message_body>private-content-sentinel</message_body></feedback>'))]),
    )) }));
    const imported = await importMailReportReview(files, [], ['example.test'], ISO);
    assert.equal(imported.loadedReports, 512);
    assert.equal(imported.review.reports.length, 512);
    assert.equal(imported.review.reports[511]?.reportId, 'report-15-31');
    assert.equal(imported.duplicateReports, 0);
    assert.doesNotMatch(JSON.stringify(imported.review), /private-content-sentinel|message_body|<feedback>/u);
    const repeated = await importMailReportReview(files, imported.review.reports, ['example.test'], ISO);
    assert.equal(repeated.review.reports.length, 512);
    assert.equal(repeated.duplicateReports, 512);
  });

  test('admits an actual exact-byte expanded source and rejects one byte beyond it', async () => {
    const source = `${DMARC_XML}${' '.repeat(MAX_MAIL_REPORT_EXPANDED_BYTES - encoder.encode(DMARC_XML).byteLength)}`;
    assert.equal(encoder.encode(source).byteLength, 20 * 1024 * 1024);
    const result = await importMailReportReview([{ name: 'exact.xml.gz', bytes: gzipSync(encoder.encode(source)) }], [], [], ISO);
    assert.equal(result.review.reports[0]?.source.bytes, 20 * 1024 * 1024);
    assert.equal(result.review.reports[0]?.kind, 'dmarc');
    assert.equal(result.review.summary.dmarcMessages, 15);
    await assert.rejects(() => importMailReportReview([{ name: 'over.xml.gz', bytes: gzipSync(encoder.encode(`${source} `)) }], [], [], ISO), /decompression limit/u);
    await assert.rejects(() => parseMailReportFiles('too-many-values.json.gz', gzipSync(encoder.encode(JSON.stringify({ ...TLS_REPORT, policies: Array.from({ length: 100_001 }, () => null) })))), /container.*100000/u);
  });
});
