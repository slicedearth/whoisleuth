import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import { reviewBimiCertificate } from '../packages/evidence/bimi-certificate-review.mts';
import { MAX_BIMI_LOGO_BYTES } from '../packages/contracts/bimi-certificate.mts';
import { bimiCertificateFixture, BIMI_EXAMPLE_SVG, BIMI_REVIEW_TIME } from './bimi-certificate-fixture.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

test('offline mark checks validate a real signed chain, exact domain and embedded logo without networking or raw output', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(BIMI_REVIEW_TIME) });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Offline certificate review attempted fetch'));
  t.mock.method(net.Socket.prototype, 'connect', () => assert.fail('Offline certificate review attempted a connection'));
  const input = await bimiCertificateFixture();
  const review = await reviewBimiCertificate(input, BIMI_REVIEW_TIME);
  assert.equal(review.state, 'checks_passed', JSON.stringify(review.checks));
  assert.equal(review.domain, 'example.test');
  assert.equal(review.reviewedAt, BIMI_REVIEW_TIME);
  assert.equal(review.networkRequestsMade, false);
  assert.ok(review.checks.every(check => check.state === 'matched'));
  assert.equal(review.logo.selectedFileSha256, review.logo.embeddedSha256);
  assert.doesNotMatch(JSON.stringify(review), /BEGIN CERTIFICATE|<svg|data:image/u);
  const lineEndings = await reviewBimiCertificate({ ...input, logoSvg: input.logoSvg.replace(/\n/gu, '\r\n') }, BIMI_REVIEW_TIME);
  assert.equal(lineEndings.checks.find(check => check.id === 'selected_logo')!.state, 'matched');
  assert.notEqual(lineEndings.logo.selectedFileSha256, lineEndings.logo.embeddedSha256);
});

test('a logo mismatch, wrong purpose, wrong hostname and untrusted path remain independent negative controls', async () => {
  const input = await bimiCertificateFixture();
  const changed = await reviewBimiCertificate({ ...input, logoSvg: input.logoSvg.replace('#369', '#936'), domain: 'child.example.test' }, BIMI_REVIEW_TIME);
  assert.equal(changed.checks.find(check => check.id === 'embedded_logo')!.state, 'matched');
  assert.equal(changed.checks.find(check => check.id === 'selected_logo')!.state, 'mismatch');
  assert.equal(changed.checks.find(check => check.id === 'domain')!.state, 'mismatch');
  const otherPurpose = await reviewBimiCertificate(await bimiCertificateFixture({ purpose: '1.3.6.1.5.5.7.3.1' }), BIMI_REVIEW_TIME);
  assert.equal(otherPurpose.checks.find(check => check.id === 'purpose')!.state, 'mismatch');
  const untrusted = await reviewBimiCertificate({ ...input, trustAnchorsPem: input.certificatePem }, BIMI_REVIEW_TIME);
  assert.equal(untrusted.checks.find(check => check.id === 'certification_path')!.state, 'mismatch');
  const badHash = await reviewBimiCertificate(await bimiCertificateFixture({ wrongDigest: true }), BIMI_REVIEW_TIME);
  assert.equal(badHash.checks.find(check => check.id === 'embedded_logo')!.state, 'mismatch');
  const expired = await reviewBimiCertificate(input, '2028-11-01T00:00:00.000Z');
  assert.equal(expired.checks.find(check => check.id === 'validity')!.state, 'mismatch');
  const absent = await reviewBimiCertificate({ ...input, logoSvg: null }, BIMI_REVIEW_TIME);
  assert.equal(absent.checks.find(check => check.id === 'selected_logo')!.state, 'not_supplied');
});

test('active SVG, excessive decompression and malformed input cannot become a passed review', async () => {
  for (const svg of [BIMI_EXAMPLE_SVG.replace('</svg>', '<script>alert(1)</script></svg>'),
    `<!DOCTYPE svg [<!ENTITY x "example">]>${BIMI_EXAMPLE_SVG}`]) {
    const review = await reviewBimiCertificate(await bimiCertificateFixture({ svg }), BIMI_REVIEW_TIME);
    assert.notEqual(review.state, 'checks_passed');
    assert.notEqual(review.checks.find(check => check.id === 'svg_profile')!.state, 'matched');
  }
  const large = await bimiCertificateFixture({ svg: 'x'.repeat(MAX_BIMI_LOGO_BYTES + 1) });
  const review = await reviewBimiCertificate({ ...large, logoSvg: null }, BIMI_REVIEW_TIME);
  assert.equal(review.checks.find(check => check.id === 'embedded_logo')!.state, 'mismatch');
  assert.equal(review.logo.embeddedSha256, null);
  await assert.rejects(reviewBimiCertificate({ ...large, logoSvg: BIMI_EXAMPLE_SVG, certificatePem: 'not a certificate' }, BIMI_REVIEW_TIME));
});

test('the production evidence command reports independent checks and strict exits with machine-readable stdout', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(BIMI_REVIEW_TIME) });
  const input = await bimiCertificateFixture();
  for (const [logoSvg, expected] of [[input.logoSvg, EXIT_CODES.SUCCESS], [input.logoSvg.replace('#369', '#936'), EXIT_CODES.PARTIAL_FAILURE]] as const) {
    let stdout = '', stderr = '';
    assert.equal(await runCli(['review-evidence', 'bimi.json', '--json', '--strict-exit'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
      readArtifactInput: () => JSON.stringify({ ...input, logoSvg }), now: () => BIMI_REVIEW_TIME,
      runUnifiedLookup: () => assert.fail('Offline review cannot collect'),
    }), expected, stderr);
    const result = JSON.parse(stdout);
    assert.equal(result.kind, 'bimi_certificate');
    assert.equal(result.result.checks.find((check: { id: string }) => check.id === 'selected_logo').state, expected === 0 ? 'matched' : 'mismatch');
    assert.doesNotMatch(stdout, /BEGIN CERTIFICATE|\u001b/u);
  }
});
