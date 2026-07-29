import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SOURCE_RELIABILITY_DOCUMENTS,
  buildSourceReliabilityReport,
  formatSourceReliabilityReport,
} from '../cli/source-reliability.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';

function lookupDocument(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    query: 'private-target.example',
    registrableDomain: 'private-target.example',
    diagnostics: {
      version: 8,
      rdap: { status: 'success', endpoint: 'https://registry.invalid/private-target.example' },
      whois: { status: 'partial' },
      availability: { status: 'complete' },
      timing: {
        version: 1,
        totalMs: 400,
        sources: [
          { source: 'rdap', outcome: 'fulfilled', durationMs: 100, completedAfterMs: 100 },
          { source: 'whois', outcome: 'fulfilled', durationMs: 350, completedAfterMs: 350 },
        ],
      },
    },
    dns: {
      observation: {
        version: 1,
        status: 'partial',
        observedAt: '2026-07-15T00:00:00.000Z',
        scanMode: 'deep',
        source: 'dns',
        durationMs: 80,
        complete: false,
        truncated: true,
        limitations: ['private-target.example was truncated'],
        diagnostics: {},
      },
    },
    threatIntelligence: {
      providers: [{
        state: 'rate_limited',
        target: { value: 'private-target.example' },
        observation: {
          version: 1,
          status: 'partial',
          observedAt: '2026-07-15T00:00:00.000Z',
          scanMode: 'deep',
          source: 'urlscan_search',
          durationMs: null,
          complete: false,
          truncated: false,
          limitations: ['secret provider note'],
          diagnostics: {},
        },
      }],
    },
    ...overrides,
  };
}

describe('privacy-safe source reliability report', () => {
  test('aggregates states, independent timing distributions, truncation, and rate limits', () => {
    const first = lookupDocument();
    const second = lookupDocument({
      diagnostics: {
        ...lookupDocument().diagnostics,
        rdap: { status: 'error' },
        timing: {
          version: 1,
          totalMs: 700,
          sources: [
            { source: 'rdap', outcome: 'rejected', durationMs: 600, completedAfterMs: 600 },
          ],
        },
      },
    });
    const report = buildSourceReliabilityReport(
      JSON.stringify([first, second]),
      '2026-07-16T00:00:00.000Z',
    );
    assert.equal(report.documentsReviewed, 2);
    assert.equal(report.privacy.targetsRetained, 0);
    const rdap = report.sources.find((source) => source.source === 'rdap');
    assert.deepEqual(rdap?.states, { error: 1, success: 1 });
    assert.deepEqual(rdap?.durationMs.lookupTiming, {
      minimum: 100,
      median: 100,
      p95: 600,
      maximum: 600,
    });
    const dns = report.sources.find((source) => source.source === 'dns');
    assert.equal(dns?.truncationCount, 2);
    assert.equal(report.totals.rateLimits, 2);
    assert.match(report.limitations.join(' '), /overlap/iu);
  });

  test('never retains targets, query strings, endpoints, or observation limitations', () => {
    const report = buildSourceReliabilityReport(JSON.stringify(lookupDocument()));
    const serialized = JSON.stringify(report);
    const terminal = formatSourceReliabilityReport(report);
    for (const marker of [
      'private-target.example',
      'registry.invalid',
      'secret provider note',
      'was truncated',
    ]) {
      assert.equal(serialized.includes(marker), false);
      assert.equal(terminal.includes(marker), false);
    }
  });

  test('rejects unknown schemas and unbounded document collections', () => {
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify({ schema: 'unknown', version: 1 })),
      /requires version 1 CLI lookup/iu,
    );
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(
        Array.from({ length: MAX_SOURCE_RELIABILITY_DOCUMENTS + 1 }, () => lookupDocument()),
      )),
      /supports 1 to/iu,
    );
  });

  test('runs through the CLI without retaining target-bearing input fields', async () => {
    let stdout = '';
    let stderr = '';
    const code = await runCli(['source-report', '--json'], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
      readSourceReliabilityInput: async () => JSON.stringify(lookupDocument()),
      now: () => '2026-07-16T00:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr, '');
    assert.equal(JSON.parse(stdout).schema, 'whoisleuth.source-reliability-report');
    assert.doesNotMatch(stdout, /private-target\.example|registry\.invalid|secret provider note/u);
  });
});
