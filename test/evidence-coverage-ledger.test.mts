import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';

test('evidence coverage preserves distinct limited and absent-source states', () => {
  const ledger = buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'RDAP', category: 'registry', status: 'success' },
    { id: 'whois', label: 'WHOIS', category: 'registry', status: 'partial', complete: false },
    { id: 'dns', label: 'DNS', category: 'network', status: 'not_found', complete: false },
    { id: 'http', label: 'HTTP', category: 'web', status: 'unavailable' },
    { id: 'tls', label: 'TLS', category: 'web', status: 'skipped' },
    { id: 'page', label: 'Page identity', category: 'web', status: 'unsupported' },
    { id: 'analysis', label: 'Derived analysis', category: 'analysis' },
  ]);

  assert.deepEqual(ledger.entries.map(({ id, state }) => ({ id, state })), [
    { id: 'rdap', state: 'complete' },
    { id: 'whois', state: 'partial' },
    { id: 'dns', state: 'not_found' },
    { id: 'http', state: 'unavailable' },
    { id: 'tls', state: 'skipped' },
    { id: 'page', state: 'unsupported' },
    { id: 'analysis', state: 'unknown' },
  ]);
  assert.equal(ledger.completeCount, 1);
  assert.equal(ledger.limitedCount, 3);
});

test('evidence coverage bounds hostile labels, duplicates, entries, and limitations', () => {
  const ledger = buildEvidenceCoverageLedger(Array.from({ length: 30 }, (_, index) => ({
    id: index === 1 ? 'source-0' : `source-${index}\u0000`,
    label: `Source ${index}\u0000${'x'.repeat(200)}`,
    category: 'external' as const,
    status: index % 2 ? 'invented-state' : 'success',
    limitations: Array.from({ length: 20 }, (__, limitation) => `Limit ${limitation}\u0000${'y'.repeat(400)}`),
  })));

  assert.equal(ledger.entries.length, 23);
  assert.ok(ledger.entries.every((entry) => entry.label.length <= 120));
  assert.ok(ledger.entries.every((entry) => entry.limitations.length <= 8));
  assert.ok(ledger.entries.every((entry) => entry.limitations.every((limitation) => limitation.length <= 280)));
  assert.equal(ledger.entries.find((entry) => entry.state === 'unknown')?.manualReviewSuggested, true);
});

test('truncation overrides a nominal source success', () => {
  const ledger = buildEvidenceCoverageLedger([
    { id: 'page', label: 'Page identity', category: 'web', status: 'success', truncated: true },
  ]);
  assert.equal(ledger.entries[0]?.state, 'partial');
});
