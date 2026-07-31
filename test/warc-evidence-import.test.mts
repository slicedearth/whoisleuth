import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  MAX_WARC_IMPORT_BYTES,
  parseWarcEvidenceArchive,
} from '../frontend/src/lib/analysis/warc-evidence-import.ts';

const encoder = new TextEncoder();

function responseBlock(options: Readonly<{
  title?: string;
  extraHeaders?: string[];
  contentType?: string;
}> = {}): Uint8Array {
  const body = `<!doctype html><html><head><title>${options.title ?? 'Fixture page'}</title></head><body>Ignored content</body></html>`;
  return encoder.encode([
    'HTTP/1.1 200 OK',
    `Content-Type: ${options.contentType ?? 'text/html; charset=utf-8'}`,
    ...(options.extraHeaders ?? []),
    '',
    body,
  ].join('\r\n'));
}

function record(type: string, block: Uint8Array, options: Readonly<{
  target?: string;
  date?: string;
  digest?: string | null;
}> = {}): Uint8Array {
  const digest = options.digest === null
    ? null
    : options.digest ?? `sha256:${createHash('sha256').update(block).digest('hex')}`;
  const headers = [
    'WARC/1.1',
    `WARC-Type: ${type}`,
    `WARC-Date: ${options.date ?? '2026-07-31T00:00:00.000Z'}`,
    `WARC-Record-ID: <urn:uuid:${type}-fixture>`,
    ...(options.target ? [`WARC-Target-URI: ${options.target}`] : []),
    ...(digest ? [`WARC-Block-Digest: ${digest}`] : []),
    'Content-Type: application/http; msgtype=response',
    `Content-Length: ${block.byteLength}`,
    '',
    '',
  ].join('\r\n');
  const prefix = encoder.encode(headers);
  const output = new Uint8Array(prefix.byteLength + block.byteLength + 4);
  output.set(prefix, 0);
  output.set(block, prefix.byteLength);
  output.set(encoder.encode('\r\n\r\n'), prefix.byteLength + block.byteLength);
  return output;
}

function archive(...records: Uint8Array[]): ArrayBuffer {
  const output = new Uint8Array(records.reduce((sum, item) => sum + item.byteLength, 0));
  let offset = 0;
  for (const item of records) {
    output.set(item, offset);
    offset += item.byteLength;
  }
  return output.buffer;
}

describe('portable WARC evidence import', () => {
  test('verifies a bounded response and retains normalized page evidence only', async () => {
    const block = responseBlock({ title: 'Reviewed fixture' });
    const report = await parseWarcEvidenceArchive(
      archive(record('response', block, { target: 'https://portal.example.test/private?token=secret' })),
      'capture.warc',
    );
    assert.equal(report.records, 1);
    assert.equal(report.accepted, 1);
    assert.equal(report.document.findings[0]?.domain, 'portal.example.test');
    assert.equal(report.document.findings[0]?.completeness, 'complete');
    assert.match(report.document.findings[0]?.summary ?? '', /Reviewed fixture.*HTTP status 200.*SHA-256/isu);
    assert.doesNotMatch(JSON.stringify(report), /private|token=secret|Ignored content/u);
  });

  test('excludes request records and keeps digest-free responses partial', async () => {
    const request = encoder.encode('GET /secret HTTP/1.1\r\nCookie: private=value\r\n\r\n');
    const response = responseBlock();
    const report = await parseWarcEvidenceArchive(archive(
      record('request', request, { target: 'https://example.test/secret', digest: null }),
      record('response', response, { target: 'https://example.test/', digest: null }),
    ), 'capture.warc');
    assert.equal(report.records, 2);
    assert.equal(report.accepted, 1);
    assert.equal(report.document.findings[0]?.completeness, 'partial');
    assert.match(report.exclusions.join(' '), /Request records/u);
    assert.doesNotMatch(JSON.stringify(report), /private=value|\/secret/u);
  });

  test('rejects sensitive, downloadable, mismatched, and excessive archives', async () => {
    await assert.rejects(
      () => parseWarcEvidenceArchive(archive(record('response', responseBlock({
        extraHeaders: ['Set-Cookie: private=value'],
      }), { target: 'https://example.test/' })), 'capture.warc'),
      /no importable HTML response evidence/u,
    );
    await assert.rejects(
      () => parseWarcEvidenceArchive(archive(record('response', responseBlock({
        extraHeaders: ['Content-Disposition: attachment; filename=page.html'],
      }), { target: 'https://example.test/' })), 'capture.warc'),
      /no importable HTML response evidence/u,
    );
    await assert.rejects(
      () => parseWarcEvidenceArchive(archive(record('response', responseBlock(), {
        target: 'https://example.test/',
        digest: `sha256:${'0'.repeat(64)}`,
      })), 'capture.warc'),
      /no importable HTML response evidence/u,
    );
    await assert.rejects(
      () => parseWarcEvidenceArchive(new ArrayBuffer(MAX_WARC_IMPORT_BYTES + 1), 'capture.warc'),
      /must be between/u,
    );
    await assert.rejects(
      () => parseWarcEvidenceArchive(new ArrayBuffer(10), 'capture.wacz'),
      /uncompressed \.warc/u,
    );
  });
});
