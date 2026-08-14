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
    mode: 'deep',
    generatedAt: '2026-07-15T00:00:00.000Z',
    query: 'private-target.example',
    registrableDomain: 'private-target.example',
    diagnostics: {
      version: 8,
      rdap: { status: 'success', endpoint: 'https://registry.invalid/private-target.example' },
      whois: { status: 'partial' },
      availability: { status: 'complete' },
      sslbl: { status: 'stale' },
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
  test('requires explicit zones for current report and Lookup timestamps', () => {
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(lookupDocument()), '2026-07-16T00:00:00'),
      /explicit timezone/u,
    );
    const current = buildSourceReliabilityReport(JSON.stringify(lookupDocument({
      version: 2,
      generatedAt: '2026-07-15T00:00:00',
    })));
    assert.deepEqual(current.sampleWindow, { earliestGeneratedAt: null, latestGeneratedAt: null });
    const legacy = buildSourceReliabilityReport(JSON.stringify(lookupDocument({
      version: 1,
      generatedAt: '2026-07-15T00:00:00',
    })));
    assert.deepEqual(legacy.sampleWindow, {
      earliestGeneratedAt: '2026-07-15T00:00:00.000Z',
      latestGeneratedAt: '2026-07-15T00:00:00.000Z',
    });
  });

  test('accepts saved Lookup versions 1 and 2 without widening the Bulk contract', () => {
    const report = buildSourceReliabilityReport(JSON.stringify([
      lookupDocument({ version: 1 }),
      lookupDocument({ version: 2 }),
    ]));
    assert.equal(report.documentsReviewed, 2);
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify({ schema: 'whoisleuth.cli.bulk', version: 2 })),
      /version 1 Bulk or Bulk-item/iu,
    );
  });

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
    assert.equal(report.reportsMerged, 0);
    assert.deepEqual(report.cohorts.lookupModes, { fast: 0, deep: 2, unknown: 0 });
    assert.deepEqual(report.sampleWindow, {
      earliestGeneratedAt: '2026-07-15T00:00:00.000Z',
      latestGeneratedAt: '2026-07-15T00:00:00.000Z',
    });
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
    assert.equal(rdap?.rates.failure, 0.5);
    assert.equal(rdap?.rates.partial, 0);
    assert.equal(report.sources.find((source) => source.source === 'sslbl')?.states.stale, 2);
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

  test('merges target-free reports into exact state counts and report-level duration trends', () => {
    const first = buildSourceReliabilityReport(
      JSON.stringify(lookupDocument()),
      '2026-07-16T00:00:00.000Z',
    );
    const second = buildSourceReliabilityReport(
      JSON.stringify(lookupDocument({
        diagnostics: {
          ...lookupDocument().diagnostics,
          timing: {
            version: 1,
            totalMs: 900,
            sources: [
              { source: 'rdap', outcome: 'fulfilled', durationMs: 800, completedAfterMs: 800 },
            ],
          },
        },
      })),
      '2026-07-17T00:00:00.000Z',
    );
    const merged = buildSourceReliabilityReport(
      JSON.stringify([first, second]),
      '2026-07-18T00:00:00.000Z',
    );
    assert.equal(merged.reportsMerged, 2);
    assert.equal(merged.documentsReviewed, 2);
    assert.equal(merged.privacy.targetsRetained, 0);
    assert.deepEqual(merged.sampleWindow, {
      earliestGeneratedAt: '2026-07-15T00:00:00.000Z',
      latestGeneratedAt: '2026-07-15T00:00:00.000Z',
    });
    const rdap = merged.sources.find((source) => source.source === 'rdap');
    assert.deepEqual(rdap?.states, { success: 2 });
    assert.equal(rdap?.durationMs.lookupTiming, null);
    assert.deepEqual(rdap?.durationTrend.reportTimingMedian, {
      minimum: 100,
      median: 100,
      p95: 800,
      maximum: 800,
    });
    assert.deepEqual(rdap?.durationTimeline.map((point) => point.generatedAt), [
      '2026-07-16T00:00:00.000Z',
      '2026-07-17T00:00:00.000Z',
    ]);
    assert.deepEqual(merged.cohorts.lookupModes, { fast: 0, deep: 2, unknown: 0 });
    assert.match(formatSourceReliabilityReport(merged), /Reports merged: 2/u);
  });

  test('rejects unknown schemas and unbounded document collections', () => {
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify({ schema: 'unknown', version: 1 })),
      /requires CLI Lookup version 1 or 2/iu,
    );
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(
        Array.from({ length: MAX_SOURCE_RELIABILITY_DOCUMENTS + 1 }, () => lookupDocument()),
      )),
      /supports 1 to/iu,
    );
    const report = buildSourceReliabilityReport(JSON.stringify(lookupDocument()));
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify([report, report])),
      /duplicate report/iu,
    );
    type MutableReport = {
      sources: Array<{
        durationTimeline: Array<{
          generatedAt: string;
          observationMedian: number | null;
          observationP95: number | null;
          timingMedian: number | null;
          timingP95: number | null;
        }>;
      }>;
    };
    const malformedTimeline = JSON.parse(JSON.stringify(report)) as MutableReport;
    const malformedSource = malformedTimeline.sources[0];
    assert.ok(malformedSource);
    malformedSource.durationTimeline = [{
      generatedAt: '2026-07-16T00:00:00.000Z',
      observationMedian: null,
      observationP95: 10,
      timingMedian: null,
      timingP95: null,
    }];
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(malformedTimeline)),
      /invalid .* duration pair/iu,
    );
    const oversizedTimeline = JSON.parse(JSON.stringify(report)) as MutableReport;
    const oversizedSource = oversizedTimeline.sources[0];
    assert.ok(oversizedSource);
    oversizedSource.durationTimeline = Array.from(
      { length: MAX_SOURCE_RELIABILITY_DOCUMENTS + 1 },
      () => ({
        generatedAt: '2026-07-16T00:00:00.000Z',
        observationMedian: null,
        observationP95: null,
        timingMedian: null,
        timingP95: null,
      }),
    );
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(oversizedTimeline)),
      /invalid .* duration timeline/iu,
    );
    const reorderedDuplicate = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(reorderedDuplicate).reverse());
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify([report, reordered])),
      /duplicate report/iu,
    );
  });

  test('rejects traversal and source bounds instead of silently dropping evidence', () => {
    const observations = Array.from({ length: 65 }, (_, index) => ({
      version: 1,
      source: `source_${index}`,
      status: 'partial',
      observedAt: '2026-07-15T00:00:00.000Z',
      complete: false,
      truncated: false,
      limitations: [],
    }));
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(lookupDocument({ observations }))),
      /64-source limit/u,
    );

    let nested: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 13; depth += 1) nested = { next: nested };
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(lookupDocument({ nested }))),
      /12-level traversal limit/u,
    );
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(lookupDocument({
        wide: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`field${index}`, {}])),
      }))),
      /more than 200 fields/u,
    );
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(lookupDocument({
        wide: Array.from({ length: 1_001 }, () => ({})),
      }))),
      /more than 1000 items/u,
    );
    assert.throws(
      () => buildSourceReliabilityReport('{"schema":"whoisleuth.cli.lookup","schema":"whoisleuth.cli.lookup"}'),
      /duplicate keys/u,
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
