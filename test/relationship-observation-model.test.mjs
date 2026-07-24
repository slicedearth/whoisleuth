import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_RELATIONSHIP_OBSERVATIONS,
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  buildRelationshipObservationExport,
  createRelationshipObservation,
  deleteRelationshipObservation,
  mergeRelationshipObservations,
  normalizeRelationshipObservation,
  normalizeRelationshipObservationStore,
  relationshipObservationId,
  serializeRelationshipObservationStore,
  upsertRelationshipObservation,
} from '../frontend/src/lib/analysis/relationship-observation-model.ts';

const EARLY = '2026-07-20T01:00:00.000Z';
const LATE = '2026-07-21T01:00:00.000Z';

function input(overrides = {}) {
  return {
    type: 'nameserver_set',
    label: 'Shared nameserver set',
    method: 'Exact normalized set',
    normalizedValue: 'ns1.shared.invalid · ns2.shared.invalid',
    value: 'ns1.shared.invalid · ns2.shared.invalid',
    domains: ['SECOND.INVALID', 'first.invalid', 'first.invalid'],
    description: 'Bounded relationship fixture.',
    ...overrides,
  };
}

function observation(overrides = {}, options = {}) {
  return createRelationshipObservation(input(overrides), {
    observedAt: EARLY,
    retainedAt: LATE,
    complete: true,
    truncated: false,
    limitations: ['Shared infrastructure is not proof of common control.'],
    sourceVersion: 2,
    ...options,
  });
}

describe('retained relationship observation model', () => {
  test('creates a deterministic bounded derived observation without mutating input', () => {
    const raw = input();
    const before = structuredClone(raw);
    const first = observation();
    const second = observation();

    assert.deepEqual(raw, before);
    assert.equal(first.id, second.id);
    assert.equal(first.id, relationshipObservationId(raw));
    assert.deepEqual(first.domains, ['first.invalid', 'second.invalid']);
    assert.equal(first.classification, 'derived');
    assert.equal(first.source, 'bulk_relationship_analysis');
    assert.equal(first.sourceVersion, 2);
    assert.equal(first.complete, true);
    assert.equal(first.truncated, false);
  });

  test('re-derives imported identities and fixed provenance from normalized content', () => {
    const source = observation();
    const normalized = normalizeRelationshipObservation({
      ...source,
      id: 'relationship-evil-alias',
      classification: 'direct',
      source: 'untrusted_provider',
      label: 'Misleading label',
      method: 'Approximate ownership match',
      description: 'Misleading description.',
      limitations: [],
    });

    assert.equal(normalized.id, source.id);
    assert.equal(normalized.classification, 'derived');
    assert.equal(normalized.source, 'bulk_relationship_analysis');
    assert.equal(normalized.label, 'Shared nameserver set');
    assert.equal(normalized.method, 'Exact normalized set');
    assert.match(normalized.description, /shared DNS providers are common/i);
    assert.match(normalized.limitations.join(' '), /does not prove ownership/i);
    assert.equal(normalizeRelationshipObservation({ ...source, observedAt: 'not-a-date' }), null);
    assert.equal(normalizeRelationshipObservation({ ...source, domains: [] }), null);
    assert.equal(normalizeRelationshipObservation({ ...source, normalizedValue: 'not a nameserver set!' }), null);
    assert.throws(() => createRelationshipObservation(input({
      type: 'ip_address',
      normalizedValue: '999.0.0.1',
      value: '999.0.0.1',
    })), /supported bounded value/i);
  });

  test('refreshes an existing identity, deletes explicitly, and keeps the store bounded', () => {
    const current = observation({}, { retainedAt: EARLY });
    const refreshed = observation({}, { retainedAt: LATE });
    const result = upsertRelationshipObservation([current], refreshed);

    assert.equal(result.added, false);
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].retainedAt, LATE);
    assert.deepEqual(deleteRelationshipObservation(result.observations, refreshed.id), []);

    const many = Array.from({ length: MAX_RELATIONSHIP_OBSERVATIONS + 10 }, (_, index) => observation({
      type: 'ip_address',
      label: 'Shared IP address',
      method: 'Exact normalized address',
      normalizedValue: `192.0.2.${index % 250}`,
      value: `192.0.2.${index % 250}`,
      domains: [`candidate-${index}.invalid`],
    }, { retainedAt: new Date(Date.parse(LATE) + index * 1000).toISOString() }));
    const bounded = normalizeRelationshipObservationStore(many).observations;
    assert.equal(bounded.length, MAX_RELATIONSHIP_OBSERVATIONS);
    assert.equal(bounded[0].retainedAt, many.at(-1).retainedAt);
    assert.equal(bounded.some((item) => item.id === many[0].id), false);
  });

  test('merges non-destructively and refuses future portable sections', () => {
    const local = observation({}, { retainedAt: LATE });
    const older = observation({ description: 'Older archive copy.' }, { retainedAt: EARLY });
    const added = observation({
      type: 'certificate',
      label: 'Shared TLS certificate',
      method: 'Exact leaf-certificate SHA-256',
      normalizedValue: 'a'.repeat(64),
      value: 'a'.repeat(64),
      domains: ['first.invalid', 'third.invalid'],
    });
    const merged = mergeRelationshipObservations([local], {
      schema: RELATIONSHIP_OBSERVATION_SCHEMA,
      version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
      observations: [older, added, { malformed: true }],
    });

    assert.equal(merged.added, 1);
    assert.equal(merged.updated, 0);
    assert.equal(merged.skipped, 2);
    assert.equal(merged.observations.find((item) => item.id === local.id).description, local.description);
    assert.throws(() => mergeRelationshipObservations([], {
      schema: RELATIONSHIP_OBSERVATION_SCHEMA,
      version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION + 1,
      observations: [],
    }), /newer schema/i);
  });

  test('serializes and exports only the current bounded contract', () => {
    const record = observation();
    const serialized = JSON.parse(serializeRelationshipObservationStore([record]));
    const exported = buildRelationshipObservationExport([record], LATE);

    assert.equal(serialized.schema, RELATIONSHIP_OBSERVATION_SCHEMA);
    assert.equal(serialized.version, RELATIONSHIP_OBSERVATION_SCHEMA_VERSION);
    assert.equal(serialized.observations.length, 1);
    assert.equal(exported.schema, RELATIONSHIP_OBSERVATION_SCHEMA);
    assert.equal(exported.generatedAt, LATE);
    assert.match(exported.limitations.join(' '), /not proof of ownership/i);
    assert.equal(Object.hasOwn(exported.observations[0], 'data'), false);
  });
});
