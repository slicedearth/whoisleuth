import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { buildCliMailReview, formatCliMailReview, mailState } from '../cli/mail-review.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const ISO = '2026-08-01T01:02:03.000Z';

function bulkItem(domain: string, availability: Record<string, unknown>) {
  return {
    schema: 'whoisleuth.cli.bulk.item', version: 2, generatedAt: ISO,
    query: domain, ok: true, registrableDomain: domain,
    availability,
    dnsSummary: { status: 'success', mx: availability.mxHosts ?? [] },
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
      method: 'Shared registrable domain of an observed MX hostname',
      limitation: 'Shared mail providers are common and do not establish common ownership, control, intent, safety, or maliciousness.',
    }]);
    assert.match(formatCliMailReview(document), /Passive mail exposure review/u);
    assert.doesNotMatch(JSON.stringify(document), /SMTP banner|message acceptance was tested/u);
  });

  test('documents conservative state semantics', () => {
    assert.equal(mailState({ dnsStatus: 'error', hasMx: false, hasNullMx: false, hasSpf: false, hasDmarc: false }), 'evidence_incomplete');
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

  test('reviews explicitly supplied TLSA material without opening an SMTP connection', () => {
    const certificate = Buffer.from('fixture mail certificate');
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
          associationData: createHash('sha256').update(certificate).digest('hex'),
        }],
        certificateDerBase64: certificate.toString('base64'),
      },
    }]));

    assert.equal(document.version, 2);
    assert.equal(document.daneCounts.matched, 1);
    assert.equal(document.rows[0]?.dane?.state, 'matched');
    assert.match(formatCliMailReview(document), /DANE matched\s+1/u);
  });

  test('does not apply TLSA evidence from an unrelated endpoint to the reviewed MX host', () => {
    const certificate = Buffer.from('fixture mail certificate');
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
        serviceName: '_25._tcp.unrelated.example',
        dnssecState: 'validated',
        records: [{
          usage: 3,
          selector: 0,
          matchingType: 1,
          associationData: createHash('sha256').update(certificate).digest('hex'),
        }],
        certificateDerBase64: certificate.toString('base64'),
      },
    }]));

    assert.equal(document.rows[0]?.dane?.state, 'invalid');
    assert.equal(document.daneCounts.invalid, 1);
    assert.match(document.rows[0]?.dane?.limitations.join(' ') ?? '', /did not identify port 25 on an MX hostname/u);
  });
});
