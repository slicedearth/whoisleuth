import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  buildDomainControlFlightRecorder,
  formatDomainControlFlightRecorder,
} from '../lib/domain-control-flight-recorder.mts';

const firstAt = '2026-08-01T00:00:00.000Z';
const secondAt = '2026-08-02T00:00:00.000Z';

function observation(observedAt: string, fields: unknown[]) {
  return {
    domain: 'Example.Test.',
    observedAt,
    collectionDepth: 'deep',
    fields,
  };
}

describe('domain-control flight recorder', () => {
  test('separates observed change, collection degradation, recovery, and approved timing', () => {
    const report = buildDomainControlFlightRecorder({
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
      version: 1,
      observations: [
        observation(firstAt, [
          { id: 'delegated_nameservers', source: 'DNS', state: 'observed', values: ['NS1.EXAMPLE.TEST.'] },
          { id: 'mail_exchangers', source: 'DNS', state: 'observed', values: ['10 MAIL.EXAMPLE.TEST'] },
          { id: 'http_origin', source: 'HTTP', state: 'partial', values: [] },
        ]),
        observation(secondAt, [
          { id: 'delegated_nameservers', source: 'DNS', state: 'observed', values: ['ns2.example.test'] },
          { id: 'mail_exchangers', source: 'DNS', state: 'partial', values: [] },
          { id: 'http_origin', source: 'HTTP', state: 'observed', values: ['https://example.test'] },
        ]),
      ],
      approvedWindows: [{
        id: 'dns-change-1',
        domain: 'example.test',
        startsAt: '2026-08-01T23:30:00.000Z',
        endsAt: '2026-08-02T00:30:00.000Z',
        fields: ['delegated_nameservers'],
        reason: 'Reviewed nameserver migration.',
      }],
    }, secondAt);

    assert.deepEqual(report.summary, {
      firstObservations: 2,
      observedChanges: 1,
      approvedChanges: 1,
      unexpectedChanges: 0,
      collectionChanges: 1,
      recoveredSources: 1,
    });
    const nameserverChange = report.events.find((event) => event.field === 'delegated_nameservers' && event.kind === 'observed_change');
    assert.deepEqual(nameserverChange?.before, ['ns1.example.test.']);
    assert.deepEqual(nameserverChange?.after, ['ns2.example.test']);
    assert.equal(nameserverChange?.approvedWindow?.id, 'dns-change-1');
    assert.match(formatDomainControlFlightRecorder(report), /Collection changes\s+1/u);
  });

  test('never converts an incomplete source state into evidence of removal', () => {
    const report = buildDomainControlFlightRecorder({
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
      version: 1,
      observations: [
        observation(firstAt, [{ id: 'registry_nameservers', source: 'Registry RDAP', state: 'observed', values: ['ns1.example.test'] }]),
        observation(secondAt, [{ id: 'registry_nameservers', source: 'Registry RDAP', state: 'unavailable', values: [] }]),
      ],
      approvedWindows: [],
    }, secondAt);

    const event = report.events.at(-1);
    assert.equal(event?.kind, 'collection_change');
    assert.deepEqual(event?.after, []);
    assert.match(event?.explanation ?? '', /not evidence/iu);
  });

  test('rejects unsupported fields and non-canonical input shape', () => {
    assert.throws(() => buildDomainControlFlightRecorder({
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
      version: 1,
      observations: [observation(firstAt, [{ id: 'raw_payload', source: 'Unknown', state: 'observed', values: ['secret'] }])],
      approvedWindows: [],
    }, secondAt), /unsupported or duplicate field/iu);

    assert.throws(() => buildDomainControlFlightRecorder({
      schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
      version: 1,
      observations: [observation(firstAt, [])],
      approvedWindows: [],
      rawEvidence: 'not accepted',
    }, secondAt), /unknown field/iu);
  });
});
