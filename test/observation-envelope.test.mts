import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_ENVELOPE_BYTES,
  OBSERVATION_ENVELOPE_SCHEMA,
  OBSERVATION_ENVELOPE_VERSION,
  RELATIONSHIP_OBSERVATION_ADAPTER_ID,
  adaptRelationshipObservationsToEnvelope,
  observationEnvelopeId,
  readObservationEnvelopeDocument,
} from '../frontend/src/lib/analysis/observation-envelope.ts';
import { RELATIONSHIP_EVIDENCE_VERSION } from '../frontend/src/lib/analysis/relationship-evidence.ts';
import {
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  createRelationshipObservation,
} from '../frontend/src/lib/analysis/relationship-observation-model.ts';

const OBSERVED_AT = '2026-07-01T00:00:00.000Z';
const RETAINED_AT = '2026-07-02T00:00:00.000Z';
const GENERATED_AT = '2026-07-28T00:00:00.000Z';

function retainedIp() {
  return createRelationshipObservation({
    type: 'ip_address',
    normalizedValue: '192.0.2.24',
    domains: ['second.invalid', 'first.invalid'],
  }, {
    observedAt: OBSERVED_AT,
    retainedAt: RETAINED_AT,
    complete: true,
    truncated: false,
    sourceVersion: RELATIONSHIP_EVIDENCE_VERSION,
    limitations: ['The address may represent shared hosting.'],
  });
}

function currentSource(observations: unknown[]) {
  return {
    version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    observations,
  };
}

describe('incremental browser-local observation envelope', () => {
  test('adapts retained relationships deterministically without mutating the authoritative source', () => {
    const source = currentSource([retainedIp()]);
    const before = structuredClone(source);
    const first = adaptRelationshipObservationsToEnvelope(source, { generatedAt: GENERATED_AT });
    const second = adaptRelationshipObservationsToEnvelope(source, { generatedAt: GENERATED_AT });

    assert.equal(first.state, 'ready');
    assert.equal(second.state, 'ready');
    assert.deepEqual(first, second);
    assert.deepEqual(source, before);
    const document = first.document;
    assert.equal(document.schema, OBSERVATION_ENVELOPE_SCHEMA);
    assert.equal(document.version, OBSERVATION_ENVELOPE_VERSION);
    assert.equal(document.generatedAt, GENERATED_AT);
    assert.equal(document.adapter.id, RELATIONSHIP_OBSERVATION_ADAPTER_ID);
    assert.deepEqual(document.adapter.source, {
      collection: 'relationship_observations',
      schema: RELATIONSHIP_OBSERVATION_SCHEMA,
      version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    });
    assert.equal(document.entities.length, 3);
    assert.equal(document.observations.length, 1);
    assert.equal(document.relationships.length, 2);
    assert.deepEqual(document.artifactReferences, []);
    assert.deepEqual(document.assertions, []);
    assert.equal(document.quota.records, 6);
    assert.ok(document.quota.bytes > 0);
    assert.ok(document.quota.bytes <= MAX_ENVELOPE_BYTES);
    assert.equal(document.quota.truncated, false);
    assert.equal(document.rollback.authoritativeCollection, 'relationship_observations');
    assert.equal(document.rollback.writesPerformed, false);

    const observation = document.observations[0];
    assert.ok(observation);
    assert.equal(observation.sourceRecordId, retainedIp().id);
    assert.equal(observation.observedAt, OBSERVED_AT);
    assert.equal(observation.collectionDepth, null);
    assert.equal(observation.status, 'success');
    assert.equal(observation.complete, true);
    assert.equal(observation.truncated, false);
    assert.equal(observation.derivation, 'derived');
    assert.equal(observation.sourceSchema.version, RELATIONSHIP_OBSERVATION_SCHEMA_VERSION);
    assert.deepEqual(observation.upstreamSchemas, [{
      collection: 'bulk_relationship_evidence',
      schema: 'whoisleuth.relationship-evidence',
      version: RELATIONSHIP_EVIDENCE_VERSION,
    }]);
    assert.match(observation.limitations.join(' '), /explicit analyst action/iu);
    assert.ok(document.relationships.every((relationship) => (
      relationship.sourceObservationIds[0] === observation.id
      && relationship.derivation === 'derived'
      && relationship.complete === true
    )));
  });

  test('uses stable collision-resistant identifiers for the same typed canonical value', () => {
    assert.equal(
      observationEnvelopeId('ip_address', '192.0.2.24'),
      observationEnvelopeId('ip_address', '192.0.2.24'),
    );
    assert.notEqual(
      observationEnvelopeId('ip_address', '192.0.2.24'),
      observationEnvelopeId('domain', '192.0.2.24'),
    );
  });

  test('keeps empty current sources explicit and rollback-safe', () => {
    const result = adaptRelationshipObservationsToEnvelope(currentSource([]), { generatedAt: GENERATED_AT });
    assert.equal(result.state, 'ready');
    assert.deepEqual(result.document.entities, []);
    assert.deepEqual(result.document.observations, []);
    assert.deepEqual(result.document.relationships, []);
    assert.equal(result.document.quota.records, 0);
    assert.equal(result.document.rollback.writesPerformed, false);
  });

  test('refuses malformed and future authoritative source schemas', () => {
    assert.equal(adaptRelationshipObservationsToEnvelope({ observations: 'invalid' }).state, 'invalid');
    const future = adaptRelationshipObservationsToEnvelope({
      version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION + 1,
      observations: [retainedIp()],
    });
    assert.equal(future.state, 'unsupported');
    assert.equal(future.sourceVersion, RELATIONSHIP_OBSERVATION_SCHEMA_VERSION + 1);
    assert.match(future.detail, /newer than supported/iu);
  });

  test('reads a current envelope and keeps absent, malformed, future, and cyclic inputs distinct', () => {
    const adapted = adaptRelationshipObservationsToEnvelope(
      currentSource([retainedIp()]),
      { generatedAt: GENERATED_AT },
    );
    assert.equal(adapted.state, 'ready');
    const current = readObservationEnvelopeDocument(adapted.document);
    assert.equal(current.state, 'ready');
    assert.deepEqual(current.document, adapted.document);
    assert.notEqual(current.document, adapted.document);

    assert.equal(readObservationEnvelopeDocument(null).state, 'absent');
    assert.equal(readObservationEnvelopeDocument({ schema: 'wrong', version: 1 }).state, 'invalid');
    assert.equal(readObservationEnvelopeDocument({
      ...adapted.document,
      version: OBSERVATION_ENVELOPE_VERSION + 1,
    }).state, 'unsupported');

    const cyclic: Record<string, unknown> = {
      schema: OBSERVATION_ENVELOPE_SCHEMA,
      version: OBSERVATION_ENVELOPE_VERSION,
    };
    cyclic.self = cyclic;
    assert.doesNotThrow(() => readObservationEnvelopeDocument(cyclic));
    assert.equal(readObservationEnvelopeDocument(cyclic).state, 'invalid');
  });

  test('rejects a structurally corrupted envelope instead of indexing unknown records', () => {
    const adapted = adaptRelationshipObservationsToEnvelope(
      currentSource([retainedIp()]),
      { generatedAt: GENERATED_AT },
    );
    assert.equal(adapted.state, 'ready');
    const corrupted = structuredClone(adapted.document) as unknown as Record<string, unknown>;
    const entities = corrupted.entities as Array<Record<string, unknown>>;
    assert.ok(entities[0]);
    entities[0].canonical = 'bad\ncanonical';
    assert.equal(readObservationEnvelopeDocument(corrupted).state, 'invalid');
  });
});
