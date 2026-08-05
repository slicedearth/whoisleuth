import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildSourceReliabilityReport } from '../cli/source-reliability.mts';
import {
  parseSourceReliabilityDashboard,
  reliabilityDurationLabel,
  reliabilityRateLabel,
} from '../frontend/src/lib/analysis/source-reliability-dashboard.ts';

const NOW = '2026-08-05T10:00:00.000Z';

function lookup(state: 'success' | 'error', durationMs: number) {
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt: NOW, mode: 'deep',
    diagnostics: {
      rdap: { status: state },
      timing: { version: 1, sources: [{ source: 'rdap', durationMs }] },
    },
    availability: {
      version: 1, status: state, source: 'rdap', observedAt: NOW,
      complete: state === 'success', truncated: false, limitations: [], durationMs,
    },
  };
}

describe('browser-local source reliability dashboard', () => {
  test('accepts the CLI target-free report and derives bounded review rows', () => {
    const report = buildSourceReliabilityReport(JSON.stringify([
      lookup('error', 900), lookup('success', 200), lookup('success', 220),
      lookup('success', 240), lookup('success', 260), lookup('success', 280),
    ]), NOW);
    const dashboard = parseSourceReliabilityDashboard(JSON.stringify(report));
    const rdap = dashboard.rows.find((row) => row.source === 'rdap');
    assert.equal(dashboard.documentsReviewed, 6);
    assert.equal(rdap?.stateSamples, 12);
    assert.equal(rdap?.failureRate, 0.1667);
    assert.equal(rdap?.p95DurationMs, 900);
    assert.equal(rdap?.tone, 'attention');
    assert.equal(reliabilityRateLabel(rdap?.failureRate ?? null), '17%');
    assert.equal(reliabilityDurationLabel(rdap?.p95DurationMs ?? null), '900 ms');
  });

  test('rejects retained targets, inconsistent state counts, and oversized input', () => {
    const report = buildSourceReliabilityReport(JSON.stringify([lookup('success', 200)]), NOW);
    const unsafe = { ...report, privacy: { ...report.privacy, targetsRetained: 1 } };
    assert.throws(() => parseSourceReliabilityDashboard(JSON.stringify(unsafe)), /retain zero targets/iu);

    const inconsistent = {
      ...report,
      sources: report.sources.map((source, index) => index === 0
        ? { ...source, samples: { ...source.samples, states: source.samples.states + 1 } }
        : source),
    };
    assert.throws(() => parseSourceReliabilityDashboard(JSON.stringify(inconsistent)), /inconsistent state samples/iu);
    assert.throws(() => parseSourceReliabilityDashboard('x'.repeat(512 * 1024 + 1)), /between 1 byte/iu);
  });
});
