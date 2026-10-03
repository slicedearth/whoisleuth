import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildDomainControlManifest, reviewDomainControlManifest, validateDomainControlReviewDocument, formatDomainControlResult } from '../lib/domain-control-manifest.mts';
import { buildCliDomainControlReview, formatCliDomainControlReview } from '../cli/domain-control-observations.mts';
import { runDomainControlMonitor, formatDomainControlMonitor } from '../cli/domain-control-monitor.mts';
import { formatCliJunit } from '../cli/ci-report.mts';

const NOW = '2026-08-20T00:00:00.000Z';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
function manifest(renewalReviewAt: string, nameservers: string[] = []) {
  return buildDomainControlManifest({
    schema: 'whoisleuth.domain-control-manifest-input', version: 2, expiresAt: '2026-09-20T00:00:00.000Z',
    entries: [{ domain: 'example.test', renewalReviewAt, nameservers }],
  }, '2026-08-19T00:00:00.000Z');
}

test('reminders never establish configuration drift or alignment', () => {
  for (const [date, state] of [[NOW, 'due'], ['2026-08-21T00:00:00.000Z', 'not_due']] as const) {
    const review = reviewDomainControlManifest({
      schema: 'whoisleuth.domain-control-review-input', version: 3, manifest: manifest(date), observations: [],
    }, NOW);
    assert.equal(review.state, state);
    assert.equal(review.counts[state], 1);
    assert.equal(review.counts.drift, 0);
    assert.equal(review.counts.aligned, 0);
    assert.deepEqual(validateDomainControlReviewDocument(review), review);
    const renewal = review.domains[0]!.comparisons.find((item) => item.field === 'renewalReviewAt')!;
    assert.deepEqual(renewal.observed, []);
    assert.equal(renewal.observedAt, null);
    assert.equal(renewal.source, null);
  }
});

test('incomplete evidence stays visible when a reminder is due; actual drift stays separate', () => {
  const input = {
    schema: 'whoisleuth.domain-control-review-input', version: 3,
    manifest: manifest(NOW, ['ns1.example.test']), observations: [],
  };
  const unavailable = reviewDomainControlManifest(input, NOW);
  assert.equal(unavailable.state, 'partial');
  assert.equal(unavailable.counts.due, 1);
  assert.equal(unavailable.counts.unavailable, 1);
  assert.equal(unavailable.counts.drift, 0);
  assert.deepEqual(validateDomainControlReviewDocument(unavailable), unavailable);
  for (const [address, state, drift] of [['ns1.example.test', 'due', 0], ['ns2.example.test', 'drift', 1]] as const) {
    const review = reviewDomainControlManifest({ ...input, observations: [{ domain: 'example.test', fields: {
      nameservers: { state: 'observed', source: 'fixture DNS', observedAt: NOW, values: [address] },
    } }] }, NOW);
    assert.equal(review.state, state);
    assert.equal(review.counts.drift, drift);
    assert.equal(review.counts.due, 1);
    assert.deepEqual(validateDomainControlReviewDocument(review), review);
  }
  const forged = structuredClone(unavailable);
  Reflect.set(forged, 'state', 'drift');
  assert.throws(() => validateDomainControlReviewDocument(forged), /state is inconsistent/u);
});

test('saved-Lookup, monitor and CI summaries distinguish reminders from observed changes', async () => {
  const input = fixture('cli-domain-control-review-input-v2');
  input.manifest = manifest(NOW);
  const review = buildCliDomainControlReview(JSON.stringify(input), NOW);
  assert.equal(review.review.state, 'due');
  assert.match(formatDomainControlResult(review.review), /Drift\s+0\n.*Partial\s+0\nDue\s+1/u);
  assert.match(formatCliDomainControlReview(review), /Due\s+1/u);
  const monitor = await runDomainControlMonitor(JSON.stringify(input.manifest), null, {
    executeLookup: async () => input.lookups[0], now: () => NOW, limit: 1, concurrency: 1,
  });
  assert.equal(monitor.review.state, 'due');
  assert.match(formatDomainControlMonitor(monitor), /Due\s+1/u);
  const junit = formatCliJunit(monitor);
  assert.match(junit, /failures="0"/u);
  assert.match(junit, /Renewal reviews due: 1/u);
  assert.doesNotMatch(junit, /<failure |example\.test/u);
});

test('historical review and monitor versions retain their original interpretation', async () => {
  for (const version of [1, 2]) {
    const review = fixture(`domain-control-review-v${version}`);
    assert.equal(review.state, 'drift');
    assert.deepEqual(validateDomainControlReviewDocument(review), review);
    const input = fixture('cli-domain-control-review-input-v2');
    const previous = readFileSync(new URL(`./fixtures/domain-control-monitor-v${version}.json`, import.meta.url), 'utf8');
    const monitor = await runDomainControlMonitor(JSON.stringify(input.manifest), previous, {
      executeLookup: async () => input.lookups[0], now: () => '2026-08-21T00:00:00.000Z', limit: 1, concurrency: 1,
    });
    assert.equal(monitor.version, 3);
    assert.equal(monitor.flightRecorder.observationCount, 2);
  }
});
