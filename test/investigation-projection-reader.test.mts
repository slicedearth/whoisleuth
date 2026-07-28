import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
  MAX_PROJECTION_ENTITIES,
  MAX_PROJECTION_OBSERVATIONS,
  MAX_PROJECTION_RELATIONSHIPS,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import { readBoundedInvestigationProjection } from '../frontend/src/lib/analysis/investigation-projection-reader.ts';

function projection(overrides: Record<string, unknown> = {}) {
  return {
    schema: INVESTIGATION_PROJECTION_SCHEMA,
    version: INVESTIGATION_PROJECTION_VERSION,
    generatedAt: '2026-07-28T00:00:00.000Z',
    sources: {},
    entities: [],
    observations: [],
    relationships: [],
    limitations: [],
    truncated: false,
    ...overrides,
  };
}

test('reads the current projection without mutating its collections', () => {
  const input = projection({
    entities: [{ id: 'entity:one' }],
    observations: [{ id: 'observation:one' }],
    relationships: [{ id: 'relationship:one' }],
  });
  const before = structuredClone(input);
  const result = readBoundedInvestigationProjection(input);
  assert.equal(result.state, 'ready');
  assert.equal(result.version, INVESTIGATION_PROJECTION_VERSION);
  assert.deepEqual(result.entities, input.entities);
  assert.notEqual(result.entities, input.entities);
  assert.deepEqual(input, before);
});

test('keeps absent, malformed, and future projection states distinct', () => {
  assert.equal(readBoundedInvestigationProjection(null).state, 'absent');
  assert.equal(readBoundedInvestigationProjection({ schema: 'wrong', version: 1 }).state, 'invalid');
  const future = readBoundedInvestigationProjection(projection({
    version: INVESTIGATION_PROJECTION_VERSION + 1,
  }));
  assert.equal(future.state, 'unsupported');
  assert.match(future.detail, /newer than supported/u);
});

test('requires every current projection collection before traversal', () => {
  const missing = projection();
  Reflect.deleteProperty(missing, 'relationships');
  const result = readBoundedInvestigationProjection(missing);
  assert.equal(result.state, 'invalid');
  assert.deepEqual(result.entities, []);
});

test('bounds every collection and discloses truncation', () => {
  const result = readBoundedInvestigationProjection(projection({
    entities: Array.from({ length: MAX_PROJECTION_ENTITIES + 1 }, (_, index) => index),
    observations: Array.from({ length: MAX_PROJECTION_OBSERVATIONS + 1 }, (_, index) => index),
    relationships: Array.from({ length: MAX_PROJECTION_RELATIONSHIPS + 1 }, (_, index) => index),
  }));
  assert.equal(result.state, 'ready');
  assert.equal(result.entities.length, MAX_PROJECTION_ENTITIES);
  assert.equal(result.observations.length, MAX_PROJECTION_OBSERVATIONS);
  assert.equal(result.relationships.length, MAX_PROJECTION_RELATIONSHIPS);
  assert.equal(result.truncated, true);
});
