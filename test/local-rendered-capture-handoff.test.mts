import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildLocalRenderedCaptureHandoff } from '../frontend/src/lib/analysis/local-rendered-capture-handoff.ts';

describe('local rendered-capture handoff', () => {
  test('builds one explicit source-checkout command for the exact retained URL', () => {
    const handoff = buildLocalRenderedCaptureHandoff(
      'https://login.review.example/session?flow=fixture#step',
      new Date('2026-09-04T05:06:07.000Z'),
    );
    assert.equal(handoff.hostname, 'login.review.example');
    assert.equal(handoff.outputDirectory, '~/whoisleuth-capture-login.review.example-20260904T050607Z');
    assert.equal(handoff.manifestPath, `${handoff.outputDirectory}/manifest.json`);
    assert.equal(
      handoff.command,
      "npm run capture:local -- 'https://login.review.example/session?flow=fixture#step' --output-dir ~/whoisleuth-capture-login.review.example-20260904T050607Z --authorize-rendered-capture",
    );
  });

  test('quotes apostrophes without opening a shell argument boundary', () => {
    const handoff = buildLocalRenderedCaptureHandoff(
      "https://review.example/a'b",
      new Date('2026-09-04T00:00:00.000Z'),
    );
    assert.ok(handoff.command.includes(`a'\"'\"'b`));
  });

  test('rejects invalid URLs and non-default ports', () => {
    assert.throws(() => buildLocalRenderedCaptureHandoff('review.example'), /absolute HTTP\(S\)/u);
    assert.throws(
      () => buildLocalRenderedCaptureHandoff('https://review.example:8443/path'),
      /non-default target port/u,
    );
  });
});
