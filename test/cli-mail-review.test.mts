import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { buildCliMailReview, formatCliMailReview, mailState } from '../cli/mail-review.mts';
import { bulkJsonItem } from '../cli/formatters/json.mts';
import { classifyQuery } from '../lib/classify.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const ISO = '2026-08-01T01:02:03.000Z';

function bulkItem(domain: string, availability: Record<string, unknown>) {
  const dnsStatus = typeof availability.dnsStatus === 'string' ? availability.dnsStatus : 'success';
  const mx = Array.isArray(availability.mxHosts) ? availability.mxHosts : [];
  return {
    schema: 'whoisleuth.cli.bulk.item', version: 2, generatedAt: ISO,
    query: domain, ok: true, registrableDomain: domain,
    type: 'domain', inputHostname: domain, isSubdomain: false, mode: 'fast',
    availability: { ...availability, mxHosts: mx, dns: { status: dnsStatus } },
    diagnostics: {},
    dnsSummary: {
      status: dnsStatus,
      a: [], aaaa: [], ns: [], mx,
      hasNullMx: availability.hasNullMx ?? null,
      hasSpf: availability.hasSpf ?? null,
      hasDmarc: availability.hasDmarc ?? null,
    },
  };
}

function bulkDocument(items: unknown[]) {
  return JSON.stringify({ schema: 'whoisleuth.cli.bulk', version: 2, generatedAt: ISO, results: items });
}

function capture() {
  let output = '';
  return { stream: { write(chunk: string) { output += chunk; } }, value: () => output };
}

describe('passive mail exposure review', () => {
  test('keeps null MX, authentication gaps, and incomplete evidence distinct', () => {
    const document = buildCliMailReview(bulkDocument([
      bulkItem('alpha.example', { hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true, mxHosts: ['10 mx.shared.example.'] }),
      bulkItem('beta.example', { hasMx: true, hasNullMx: false, hasSpf: false, hasDmarc: true, mxHosts: ['mx.shared.example'] }),
      bulkItem('null.example', { hasMx: false, hasNullMx: true, hasSpf: false, hasDmarc: false, mxHosts: ['.'] }),
    ]), ISO);
    assert.equal(document.counts.authenticated_mail, 1);
    assert.equal(document.counts.mail_auth_gap, 1);
    assert.equal(document.counts.null_mx, 1);
    assert.deepEqual(document.providerRelationships, [{
      providerDomain: 'shared.example',
      domains: ['alpha.example', 'beta.example'],
      domainCount: 2,
      domainsTruncated: false,
      omittedDomains: 0,
      method: 'Shared registrable domain of an observed MX hostname',
      limitation: 'Shared mail providers are common and do not establish common ownership, control, intent, safety, or maliciousness.',
    }]);
    assert.equal(document.providerCoverage.complete, true);
    assert.match(formatCliMailReview(document), /Passive mail exposure review/u);
    assert.doesNotMatch(JSON.stringify(document), /SMTP banner|message acceptance was tested/u);
  });

  test('documents conservative state semantics', () => {
    assert.equal(mailState({ dnsStatus: 'error', hasMx: false, hasNullMx: false, hasSpf: false, hasDmarc: false }), 'evidence_incomplete');
    assert.equal(mailState({ dnsStatus: 'partial', hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true }), 'evidence_incomplete');
    assert.equal(mailState({ dnsStatus: 'success', hasMx: false, hasNullMx: false, hasSpf: false, hasDmarc: false }), 'no_explicit_mx');
    assert.equal(mailState({ dnsStatus: 'success', hasMx: true, hasNullMx: false, hasSpf: null, hasDmarc: null }), 'mail_auth_incomplete');
  });

  test('accepts Bulk JSONL and rejects unversioned or oversized input', async () => {
    const rows = [bulkItem('alpha.example', { hasMx: false, hasNullMx: false, hasSpf: null, hasDmarc: null })];
    assert.equal(buildCliMailReview(rows.map((row) => JSON.stringify(row)).join('\n')).rows.length, 1);
    assert.throws(() => buildCliMailReview(JSON.stringify({ results: rows })), /schema version 2/u);
    assert.deepEqual(parseCliArguments(['mail-review', 'bulk.json', '--json']), {
      action: 'mail-review', source: 'bulk.json', output: 'json', quiet: false, color: true,
    });

    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['mail-review', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => ISO,
      readMailReviewInput: async () => bulkDocument(rows),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.cli.mail-review');
    assert.equal(stderr.value(), '');
  });

  test('accepts the exact current Bulk-item writer contract', () => {
    const item = bulkJsonItem({
      index: 0,
      query: 'current.example',
      ok: true,
      classified: classifyQuery('current.example'),
      observedAt: null,
      collectionOrigin: 'current_run',
      result: {
        availability: {
          dns: { status: 'success', records: { a: [], aaaa: [], ns: [], mx: [{ priority: 10, exchange: 'mx.current.example' }] } },
          hasMx: true,
          hasNullMx: false,
          mxHosts: ['mx.current.example'],
          hasSpf: true,
          hasDmarc: true,
        },
        diagnostics: {},
      },
    }, { generatedAt: ISO, deep: false });
    const document = JSON.stringify({ schema: 'whoisleuth.cli.bulk', version: 3, generatedAt: ISO, results: [item] });
    const review = buildCliMailReview(document);
    assert.equal(review.rows[0]?.state, 'authenticated_mail');
    assert.equal(review.rows[0]?.domain, 'current.example');
  });

  test('rejects weak, contradictory, and duplicate-key Bulk rows', () => {
    const partial = bulkItem('partial.example', {
      dnsStatus: 'partial',
      hasMx: true,
      hasNullMx: false,
      hasSpf: true,
      hasDmarc: true,
      mxHosts: ['10 mx.partial.example'],
    });
    const partialReview = buildCliMailReview(bulkDocument([partial]));
    assert.equal(partialReview.counts.evidence_incomplete, 1);
    assert.equal(partialReview.counts.authenticated_mail, 0);

    const contradictory = {
      ...partial,
      availability: { ...partial.availability, dns: { status: 'success' } },
    };
    assert.throws(() => buildCliMailReview(bulkDocument([contradictory])), /inconsistent DNS source status/u);

    const weak = {
      schema: 'whoisleuth.cli.bulk.item', version: 2, generatedAt: ISO,
      query: 'weak.example', ok: true, registrableDomain: 'weak.example',
      availability: { hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true },
      dnsSummary: { status: 'success', mx: ['mx.weak.example'] },
    };
    assert.throws(() => buildCliMailReview(bulkDocument([weak])), /completed domain Bulk result/u);
    assert.throws(
      () => buildCliMailReview('{"schema":"whoisleuth.cli.bulk.item","schema":"whoisleuth.cli.bulk.item"}'),
      /valid WHOISleuth Bulk JSON or JSONL/u,
    );

    const mismatchedMx = structuredClone(partial);
    mismatchedMx.availability.mxHosts = ['mx.unrelated.example'];
    assert.throws(
      () => buildCliMailReview(bulkDocument([mismatchedMx])),
      /inconsistent availability and DNS summary MX hosts/u,
    );

    for (const invalidMx of ['10 bad_host.example', '10 mx.safe.example\u202e.invalid']) {
      const invalid = bulkItem('invalid.example', {
        hasMx: true,
        hasNullMx: false,
        hasSpf: true,
        hasDmarc: true,
        mxHosts: [invalidMx],
      });
      assert.throws(
        () => buildCliMailReview(bulkDocument([invalid])),
        /safe canonical MX value|valid ASCII MX hostname/u,
      );
    }
  });

  test('does not expose undeclared Bulk fields as a DANE review contract', () => {
    const row = bulkItem('mail.example', {
      hasMx: true,
      hasNullMx: false,
      hasSpf: true,
      hasDmarc: true,
      mxHosts: ['10 mx.mail.example'],
    });
    const document = buildCliMailReview(bulkDocument([{
      ...row,
      tlsaEvidence: {
        serviceName: '_25._tcp.mx.mail.example',
        dnssecState: 'validated',
        records: [{
          usage: 3,
          selector: 0,
          matchingType: 1,
          associationData: '00'.repeat(32),
        }],
        certificateDerBase64: 'Zml4dHVyZQ==',
      },
    }]));

    assert.equal(document.version, 3);
    assert.equal(Object.hasOwn(document, 'daneCounts'), false);
    assert.equal(Object.hasOwn(document.rows[0] ?? {}, 'dane'), false);
    assert.doesNotMatch(JSON.stringify(document), /TLSA|DANE/iu);
    assert.doesNotMatch(formatCliMailReview(document), /TLSA|DANE/iu);
  });

  test('discloses every provider relationship bound in JSON and terminal output', () => {
    const providerHosts = Array.from({ length: 21 }, (_, index) => `mx.provider${index}.example`);
    const rowBound = buildCliMailReview(bulkDocument([
      bulkItem('row-bound.example', {
        hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true, mxHosts: providerHosts,
      }),
    ]), ISO);
    assert.equal(rowBound.rows[0]?.providerDomains.length, 20);
    assert.equal(rowBound.rows[0]?.providerDomainsOmitted, 1);
    assert.equal(rowBound.rows[0]?.providerDomainsTruncated, true);
    assert.equal(rowBound.providerCoverage.complete, false);
    assert.match(formatCliMailReview(rowBound), /\+1 omitted/iu);

    const domainBound = buildCliMailReview(bulkDocument(Array.from({ length: 101 }, (_, index) => (
      bulkItem(`domain${index}.example`, {
        hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true, mxHosts: ['mx.shared.example'],
      })
    ))), ISO);
    assert.equal(domainBound.providerRelationships[0]?.domainCount, 101);
    assert.equal(domainBound.providerRelationships[0]?.domains.length, 100);
    assert.equal(domainBound.providerRelationships[0]?.omittedDomains, 1);
    assert.equal(domainBound.providerCoverage.omittedRelationshipDomains, 1);

    const relationshipRows = Array.from({ length: 12 }, (_, rowIndex) => {
      const group = Math.floor(rowIndex / 2);
      return bulkItem(`pair${rowIndex}.example`, {
        hasMx: true,
        hasNullMx: false,
        hasSpf: true,
        hasDmarc: true,
        mxHosts: Array.from({ length: 20 }, (_, index) => `mx.provider${group * 20 + index}.example`),
      });
    });
    const relationshipBound = buildCliMailReview(bulkDocument(relationshipRows), ISO);
    assert.equal(relationshipBound.providerCoverage.relationshipCount, 120);
    assert.equal(relationshipBound.providerCoverage.retainedRelationshipCount, 100);
    assert.equal(relationshipBound.providerCoverage.omittedRelationships, 20);
    assert.equal(relationshipBound.providerCoverage.complete, false);
    assert.match(formatCliMailReview(relationshipBound), /20 relationships/iu);
  });

  test('correlates providers before applying the per-row presentation bound', () => {
    const earlier = Array.from({ length: 20 }, (_, index) => `mx.provider-${String(index).padStart(2, '0')}.example`);
    const otherEarlier = Array.from({ length: 20 }, (_, index) => `mx.other-provider-${String(index).padStart(2, '0')}.example`);
    const shared = 'mx.zz-shared.example';
    const review = buildCliMailReview(bulkDocument([
      bulkItem('one.example', {
        hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true, mxHosts: [...earlier, shared],
      }),
      bulkItem('two.example', {
        hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true, mxHosts: [...otherEarlier, shared],
      }),
    ]), ISO);

    assert.equal(review.rows[0]?.providerDomains.length, 20);
    assert.equal(review.rows[0]?.providerDomainsOmitted, 1);
    assert.deepEqual(review.providerRelationships.find((item) => item.providerDomain === 'zz-shared.example')?.domains, [
      'one.example', 'two.example',
    ]);
    assert.equal(review.providerCoverage.omittedRelationships, 0);

    const distinct = buildCliMailReview(bulkDocument([
      bulkItem('one.example', {
        hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true, mxHosts: [...earlier, 'mx.zz-one.example'],
      }),
      bulkItem('two.example', {
        hasMx: true, hasNullMx: false, hasSpf: true, hasDmarc: true, mxHosts: [...otherEarlier, 'mx.zz-two.example'],
      }),
    ]), ISO);
    assert.equal(distinct.providerRelationships.some((item) => item.providerDomain.startsWith('zz-')), false);
  });
});
