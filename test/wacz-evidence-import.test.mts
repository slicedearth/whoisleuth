import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { gzipSync, zipSync, type Zippable } from 'fflate';

import {
  MAX_WACZ_IMPORT_BYTES,
  MAX_WACZ_MANIFEST_BYTES,
  parseWaczEvidenceArchive,
} from '../frontend/src/lib/analysis/wacz-evidence-import.ts';
import zipFixtures from '../fixtures/zip-fixtures.mts';

const encoder = new TextEncoder();
const { patchZipDeclaredUncompressedSize } = zipFixtures;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function responseBlock(): Uint8Array {
  const body = '<!doctype html><html><head><title>Reviewed package</title></head><body>Discarded body</body></html>';
  return encoder.encode([
    'HTTP/1.1 200 OK',
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ].join('\r\n'));
}

function warcArchive(target = 'https://portal.example.test/review?secret=value'): Uint8Array {
  const block = responseBlock();
  const headers = encoder.encode([
    'WARC/1.1',
    'WARC-Type: response',
    'WARC-Date: 2026-07-31T00:00:00.000Z',
    'WARC-Record-ID: <urn:uuid:wacz-fixture>',
    `WARC-Target-URI: ${target}`,
    `WARC-Block-Digest: sha256:${sha256(block)}`,
    'Content-Type: application/http; msgtype=response',
    `Content-Length: ${block.byteLength}`,
    '',
    '',
  ].join('\r\n'));
  const output = new Uint8Array(headers.byteLength + block.byteLength + 4);
  output.set(headers);
  output.set(block, headers.byteLength);
  output.set(encoder.encode('\r\n\r\n'), headers.byteLength + block.byteLength);
  return output;
}

function wacz(options: Readonly<{
  manifestDigest?: 'valid' | 'invalid' | 'missing';
  resourceDigest?: 'valid' | 'invalid';
  resourceBytes?: number;
  includeManifest?: boolean;
  extraEntries?: Readonly<Record<string, Uint8Array>>;
}> = {}): Uint8Array {
  const compressedWarc = gzipSync(warcArchive());
  const manifest = encoder.encode(JSON.stringify({
    profile: 'data-package',
    wacz_version: '1.1.1',
    resources: [
      {
        name: 'capture.warc.gz',
        path: 'archive/capture.warc.gz',
        hash: `sha256:${options.resourceDigest === 'invalid' ? '0'.repeat(64) : sha256(compressedWarc)}`,
        bytes: options.resourceBytes ?? compressedWarc.byteLength,
      },
    ],
  }));
  const files: Zippable = {
    'archive/capture.warc.gz': [compressedWarc, { level: 0 as const }],
    ...(options.extraEntries ?? {}),
  };
  if (options.includeManifest !== false) {
    files['datapackage.json'] = manifest;
  }
  if ((options.manifestDigest ?? 'valid') !== 'missing') {
    files['datapackage-digest.json'] = encoder.encode(JSON.stringify({
      path: 'datapackage.json',
      hash: `sha256:${options.manifestDigest === 'invalid' ? 'f'.repeat(64) : sha256(manifest)}`,
    }));
  }
  return zipSync(files);
}

describe('portable WACZ evidence import', () => {
  test('verifies the package manifest and compressed WARC before bounded normalization', async () => {
    const input = wacz();
    const report = await parseWaczEvidenceArchive(
      toArrayBuffer(input),
      'capture.wacz',
    );
    assert.equal(report.manifestDigest, 'verified');
    assert.equal(report.resourcesVerified, 1);
    assert.equal(report.warcResources, 1);
    assert.equal(report.records, 1);
    assert.equal(report.accepted, 1);
    assert.equal(report.document.source.name, 'Portable WACZ evidence');
    assert.equal(report.document.findings[0]?.domain, 'portal.example.test');
    assert.match(report.document.findings[0]?.limitations.join(' ') ?? '', /manifest digest.*verified/iu);
    assert.doesNotMatch(JSON.stringify(report), /\/review|secret=value|Discarded body/u);
  });

  test('accepts an optional missing package digest while preserving the limitation', async () => {
    const input = wacz({ manifestDigest: 'missing' });
    const report = await parseWaczEvidenceArchive(
      toArrayBuffer(input),
      'capture.wacz',
    );
    assert.equal(report.manifestDigest, 'missing');
    assert.match(report.document.findings[0]?.limitations.join(' ') ?? '', /optional WACZ manifest digest was not present/iu);
  });

  test('rejects missing manifests and mismatched manifest or resource fixity', async () => {
    for (const input of [
      wacz({ includeManifest: false, manifestDigest: 'missing' }),
      wacz({ manifestDigest: 'invalid' }),
      wacz({ resourceDigest: 'invalid' }),
      wacz({ resourceBytes: 1 }),
    ]) {
      await assert.rejects(
        () => parseWaczEvidenceArchive(
          toArrayBuffer(input),
          'capture.wacz',
        ),
        /manifest|digest|byte length/iu,
      );
    }
  });

  test('rejects unsafe paths and excessive package bytes', async () => {
    const unsafe = wacz({ extraEntries: { '../escape.txt': encoder.encode('ignored') } });
    await assert.rejects(
      () => parseWaczEvidenceArchive(
        toArrayBuffer(unsafe),
        'capture.wacz',
      ),
      /unsafe ZIP path/iu,
    );
    await assert.rejects(
      () => parseWaczEvidenceArchive(new ArrayBuffer(MAX_WACZ_IMPORT_BYTES + 1), 'capture.wacz'),
      /must be between/iu,
    );

    const understated = patchZipDeclaredUncompressedSize(zipSync({
      'datapackage.json': new Uint8Array(MAX_WACZ_MANIFEST_BYTES + 1),
    }), 'datapackage.json', 1);
    await assert.rejects(
      () => parseWaczEvidenceArchive(toArrayBuffer(understated), 'capture.wacz'),
      /manifest entry exceeds its bounded extraction allowance/iu,
    );
  });

  test('rejects undeclared WARC content and bounded gzip expansion', async () => {
    const undeclared = wacz({
      extraEntries: {
        'archive/hidden.warc': warcArchive('https://hidden.invalid/'),
      },
    });
    await assert.rejects(
      () => parseWaczEvidenceArchive(toArrayBuffer(undeclared), 'capture.wacz'),
      /not uniquely declared/iu,
    );

    const excessiveWarc = gzipSync(new Uint8Array(MAX_WACZ_IMPORT_BYTES + 1));
    const manifest = encoder.encode(JSON.stringify({
      profile: 'data-package',
      wacz_version: '1.1.1',
      resources: [{
        name: 'large.warc.gz',
        path: 'archive/large.warc.gz',
        hash: `sha256:${sha256(excessiveWarc)}`,
        bytes: excessiveWarc.byteLength,
      }],
    }));
    const packageBytes = zipSync({
      'archive/large.warc.gz': [excessiveWarc, { level: 0 }],
      'datapackage.json': manifest,
    });
    await assert.rejects(
      () => parseWaczEvidenceArchive(toArrayBuffer(packageBytes), 'capture.wacz'),
      /Expanded WARC data exceeds/iu,
    );
  });
});
