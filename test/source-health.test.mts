import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sslblSnapshotHealth } from '../lib/sslbl-intelligence.mts';
import { buildCatalogStatus } from '../tools/cisa-kev-catalog-status.mts';
import {
  buildSourceHealthReport,
  formatSourceHealthReport,
  main,
  SOURCE_HEALTH_SCHEMA,
  SOURCE_HEALTH_VERSION,
  type SourceHealthBuilders,
} from '../tools/source-health.mts';

function writer() {
  let value = '';
  return {
    stream: { write(chunk: string) { value += chunk; } },
    read: () => value,
  };
}

describe('offline source-health composition', () => {
  test('composes retained datasets and reviewed evaluations without network work', async () => {
    const report = await buildSourceHealthReport({
      now: new Date('2026-08-13T12:00:00.000Z'),
    });

    assert.equal(report.schema, SOURCE_HEALTH_SCHEMA);
    assert.equal(report.version, SOURCE_HEALTH_VERSION);
    assert.equal(report.mode, 'offline_checked_in_assets');
    assert.equal(report.networkRequests, 0);
    assert.equal(report.summary.entries, 9);
    assert.deepEqual(report.summary.states, {
      current: 4,
      limited: 1,
      measured: 0,
      unproven: 4,
      stale: 0,
      unavailable: 0,
      malformed: 0,
    });
    assert.equal(report.summary.strictFailures, 0);
    const technology = report.entries.find((item) => item.id === 'accuracy_technology_detection');
    assert.equal(technology?.state, 'limited');
    assert.equal(technology?.itemCount, 78);
    assert.ok(report.entries
      .filter((item) => item.kind === 'evaluation' && item.id !== 'accuracy_technology_detection')
      .every((item) => item.state === 'unproven' && item.itemCount === 0));
  });

  test('keeps stale, malformed and unavailable states distinct and never replaces unavailable counts with zero', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const builders: Partial<SourceHealthBuilders> = {
      sslbl: () => sslblSnapshotHealth({ snapshot: {}, now }),
      kev: () => buildCatalogStatus(now, 30),
      registryFixtures: async () => { throw new Error('/private/fixture/path is unavailable'); },
    };
    const report = await buildSourceHealthReport({ now, builders });

    assert.equal(report.entries.find((item) => item.id === 'sslbl_certificate_snapshot')?.state, 'malformed');
    assert.equal(report.entries.find((item) => item.id === 'cisa_kev_catalogue')?.state, 'stale');
    const unavailable = report.entries.find((item) => item.id === 'registry_fixtures');
    assert.equal(unavailable?.state, 'unavailable');
    assert.equal(unavailable?.itemCount, null);
    assert.equal(unavailable?.ageDays, null);
    assert.doesNotMatch(unavailable?.detail ?? '', /private|fixture\/path/u);
    assert.equal(report.summary.strictFailures, 3);

    const formatted = formatSourceHealthReport(report);
    assert.match(formatted, /UNAVAILABLE\s+Registry compatibility fixtures/u);
    assert.match(formatted, /Items: unavailable; age: unavailable/u);
    assert.match(formatted, /Strict drill-down: npm run registry:fixtures/u);
    assert.match(formatted, /network requests: 0/u);
  });

  test('reports predictably aged optional sources by default and reserves failure for strict mode', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const builders: Partial<SourceHealthBuilders> = {
      kev: () => buildCatalogStatus(now, 30),
    };
    const human = writer();
    const strict = writer();
    const json = writer();

    assert.equal(await main([], { now, builders, stdout: human.stream }), 0);
    assert.match(human.read(), /STALE\s+CISA KEV/u);
    assert.equal(await main(['--strict'], { now, builders, stdout: strict.stream }), 1);
    assert.equal(await main(['--json'], { now, builders, stdout: json.stream }), 0);
    assert.ok(JSON.parse(json.read()).summary.strictFailures >= 1);

    const malformed = writer();
    assert.equal(await main([], {
      now,
      builders: { sslbl: () => sslblSnapshotHealth({ snapshot: {}, now }) },
      stdout: malformed.stream,
    }), 2);
    assert.match(malformed.read(), /MALFORMED\s+SSL certificate/u);

    const errors = writer();
    assert.equal(await main(['--strict', '--strict'], { stderr: errors.stream }), 2);
    assert.match(errors.read(), /Usage:/u);
  });
});
