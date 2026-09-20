import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SOURCE_RELIABILITY_DOCUMENTS,
  buildSourceReliabilityReport,
  formatSourceReliabilityReport,
} from '../cli/source-reliability.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES } from '../cli/saved-lookup.mts';
import { buildCliBulkDocument, bulkJsonItem } from '../cli/formatters/json.mts';
import type { BulkLookupResult } from '../cli/bulk.mts';

function lookupDocument(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    mode: 'deep',
    generatedAt: '2026-07-15T00:00:00.000Z',
    query: 'private-target.example',
    type: 'domain',
    inputHostname: 'private-target.example',
    registrableDomain: 'private-target.example',
    isSubdomain: false,
    rdap: { parsed: { domain: 'PRIVATE-TARGET.EXAMPLE' } },
    whois: { parsed: { domainName: 'PRIVATE-TARGET.EXAMPLE' } },
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
    availability: {
      dns: {
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
        schema: 'whoisleuth.threat-intelligence-result',
        version: 1,
        provider: { id: 'urlscan_search', label: 'Reviewed search provider' },
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
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(lookupDocument({
        version: 2,
        generatedAt: '2026-07-15T00:00:00',
      }))),
      /supported bounded CLI Lookup document/u,
    );
    const current = buildSourceReliabilityReport(JSON.stringify(lookupDocument({ version: 2 })));
    assert.deepEqual(current.sampleWindow, {
      earliestGeneratedAt: '2026-07-15T00:00:00.000Z',
      latestGeneratedAt: '2026-07-15T00:00:00.000Z',
    });
    const legacy = lookupDocument({
      version: 1,
      generatedAt: '2026-07-15T00:00:00',
    });
    const before = structuredClone(legacy);
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(legacy)),
      /supported bounded CLI Lookup document/u,
    );
    assert.deepEqual(legacy, before);
  });

  test('accepts supported Lookup and Bulk health envelopes while rejecting future versions', () => {
    const report = buildSourceReliabilityReport(JSON.stringify([
      lookupDocument({ version: 1 }),
      lookupDocument({ version: 2 }),
    ]));
    assert.equal(report.documentsReviewed, 2);
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify({ schema: 'whoisleuth.cli.bulk', version: 999 })),
      /supported CLI Lookup, Bulk or Bulk-item/iu,
    );
    const result: BulkLookupResult = {
      ok: true, index: 0, query: 'example.test',
      classified: { type: 'domain', value: 'example.test', inputHostname: 'example.test', registrableDomain: 'example.test', isSubdomain: false },
      result: lookupDocument(),
    };
    const metadata = { generatedAt: '2026-07-15T00:00:00.000Z', deep: true };
    const bulk = buildCliBulkDocument([result], metadata);
    const item = bulkJsonItem(result, metadata);
    for (const version of [1, 2, bulk.version]) {
      const retainedItem = { ...item, version };
      const expected = buildSourceReliabilityReport(JSON.stringify(retainedItem), metadata.generatedAt);
      const grouped = buildSourceReliabilityReport(JSON.stringify({ ...bulk, version, results: [retainedItem] }), metadata.generatedAt);
      assert.deepEqual(grouped.sources, expected.sources);
      assert.deepEqual(grouped.sources.find((source) => source.source === 'rdap')?.states, { success: 1 });
      const withUnownedEnrichment = buildSourceReliabilityReport(JSON.stringify({
        ...retainedItem, threatIntelligence: lookupDocument().threatIntelligence,
        dnsSummary: { observation: { ...lookupDocument().availability.dns, source: 'rdap', status: 'error' } },
      }), metadata.generatedAt);
      assert.deepEqual(withUnownedEnrichment.sources, expected.sources);
    }
  });

  test('applies the canonical saved-Lookup shape and byte boundary before source projection', () => {
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify({
        schema: 'whoisleuth.cli.lookup',
        version: 2,
      })),
      /supported bounded CLI Lookup document/u,
    );
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(lookupDocument({
        extensionProbe: 'x'.repeat(MAX_SAVED_LOOKUP_INPUT_BYTES),
      }))),
      /supported bounded CLI Lookup document/u,
    );
    const ordinary = JSON.stringify(lookupDocument());
    const padded = `${' '.repeat(MAX_SAVED_LOOKUP_INPUT_BYTES - Buffer.byteLength(ordinary, 'utf8') + 1)}${ordinary}`;
    assert.throws(
      () => buildSourceReliabilityReport(padded),
      /supported bounded CLI Lookup document/u,
    );
    const malformedDirect = `{${' '.repeat(MAX_SAVED_LOOKUP_INPUT_BYTES)}}`;
    assert.throws(
      () => buildSourceReliabilityReport(malformedDirect),
      /supported bounded CLI Lookup document/u,
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
      /requires supported CLI Lookup/u,
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

  test('does not interpret raw publications or extension fields as collector health', () => {
    const baseline = lookupDocument();
    const report = buildSourceReliabilityReport(JSON.stringify(baseline));
    const fake = { ...baseline.availability.dns, source: 'rdap', status: 'error' };
    const observations = Array.from({ length: 65 }, (_, index) => ({
      ...fake,
      source: `source_${index}`,
    }));
    const contaminated = lookupDocument({
      observations,
      rdap: { parsed: { ...baseline.rdap.parsed, extension: fake }, raw: { diagnostics: baseline.diagnostics, observations } },
      whois: { parsed: { ...baseline.whois.parsed, extension: fake } },
      availability: { ...baseline.availability, dns: { ...baseline.availability.dns, records: { extension: fake } } },
      threatIntelligence: { providers: baseline.threatIntelligence.providers.map((provider) => ({ ...provider, findings: [{ extension: fake, diagnostics: baseline.diagnostics }] })) },
    });
    const actual = buildSourceReliabilityReport(JSON.stringify(contaminated));
    assert.deepEqual(actual.sources, report.sources);
    assert.deepEqual(actual.totals, report.totals);
    assert.equal(actual.sources.find((source) => source.source === 'rdap')?.rates.failure, 0);
    assert.doesNotMatch(JSON.stringify(actual), /source_\d|private-target|secret provider/u);
  });

  test('retains independently attributed health at the documented collector boundaries', () => {
    const observation = (source: string) => ({
      ...lookupDocument().availability.dns, source,
      status: 'success', complete: true, truncated: false, limitations: [],
    });
    const report = buildSourceReliabilityReport(JSON.stringify(lookupDocument({
      diagnostics: { rdap: { status: 'skipped' }, whois: { status: 'skipped' } },
      threatIntelligence: { providers: [] },
      availability: {
        dns: { ...observation('dns'), caaPolicy: observation('dns'), delegation: observation('dns_delegation') },
        http: observation('http'), tls: observation('tls'), pageIdentity: observation('html'),
        credentialSurfaceProfile: observation('html'), structuredDataIdentity: observation('html'),
        technologyProfile: { ...observation('derived'), browserLibraryProfile: observation('derived') },
        pageRoleProfile: observation('derived'), clientBehaviorProfile: observation('derived'),
        securityPosture: observation('derived'),
      },
      reverseDns: observation('reverse_dns'), networkContext: observation('ip_rdap'),
      securityTxt: observation('security_txt'),
    })));
    assert.deepEqual(Object.fromEntries(report.sources.map((source) => [source.source, source.samples.observations])), {
      derived: 5, dns: 2, dns_delegation: 1, html: 3, http: 1,
      ip_rdap: 1, rdap: 0, reverse_dns: 1, security_txt: 1, tls: 1, whois: 0,
    });
    assert.equal(report.totals.observationSamples, 16);
    assert.equal(report.totals.timingSamples, 0);
    assert.equal(report.totals.truncations, 0);
  });

  test('bounds input structure and owned health collections without traversing publications', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 50; depth += 1) nested = { next: nested };
    assert.throws(() => buildSourceReliabilityReport(JSON.stringify(lookupDocument({ nested }))), /bounded JSON/u);
    assert.throws(
      () => buildSourceReliabilityReport(JSON.stringify(lookupDocument({
        wide: Array.from({ length: 10_001 }, () => ({})),
      }))),
      /bounded JSON/u,
    );
    assert.throws(
      () => buildSourceReliabilityReport('{"schema":"whoisleuth.cli.lookup","schema":"whoisleuth.cli.lookup"}'),
      /duplicate keys/u,
    );
    const baseline = lookupDocument();
    const provider = baseline.threatIntelligence.providers[0]!;
    assert.throws(() => buildSourceReliabilityReport(JSON.stringify(lookupDocument({
      threatIntelligence: { providers: [provider, provider] },
    }))), /duplicate provider health/u);
    assert.throws(() => buildSourceReliabilityReport(JSON.stringify(lookupDocument({
      threatIntelligence: { providers: Array.from({ length: 11 }, () => provider) },
    }))), /provider health boundary/u);
    const unknown = buildSourceReliabilityReport(JSON.stringify(lookupDocument({
      threatIntelligence: { providers: [{ ...provider, provider: { id: 'private_source_label' } }] },
      availability: { dns: { ...baseline.availability.dns, source: 'private_source_label' } },
    })));
    assert.equal(unknown.totals.observationSamples, 0);
    assert.doesNotMatch(JSON.stringify(unknown), /private_source_label/u);
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
