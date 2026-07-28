import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOOKUP_CAPABILITY_MATRIX_VERSION,
  LOOKUP_CAPABILITY_ROWS,
  lookupCapabilityRows,
  lookupCapabilityStateLabel,
} from '../frontend/src/lib/analysis/lookup-capability-matrix.ts';

test('publishes a stable field-level lookup matrix with explicit collection states', () => {
  assert.equal(LOOKUP_CAPABILITY_MATRIX_VERSION, 1);
  assert.ok(LOOKUP_CAPABILITY_ROWS.length >= 18);
  assert.equal(new Set(LOOKUP_CAPABILITY_ROWS.map((row) => row.id)).size, LOOKUP_CAPABILITY_ROWS.length);
  assert.ok(LOOKUP_CAPABILITY_ROWS.every((row) => row.field && row.source && row.limitation && row.targets.length));
  assert.ok(LOOKUP_CAPABILITY_ROWS.every((row) => (
    ['Collected', 'Conditional', 'Not collected', 'Not applicable'].includes(lookupCapabilityStateLabel(row.fast))
  )));
});

test('filters the matrix by supported target without inventing applicability', () => {
  const domain = lookupCapabilityRows('domain');
  const ip = lookupCapabilityRows('ip');
  const asn = lookupCapabilityRows('asn');
  assert.ok(domain.every((row) => row.targets.includes('domain')));
  assert.deepEqual(ip.map((row) => row.id), ['ip-rdap', 'reverse-dns']);
  assert.deepEqual(asn.map((row) => row.id), ['asn-rdap']);
  assert.deepEqual(lookupCapabilityRows('invalid'), []);
});
