import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  certificatePriorRegistrationObservations, PRIOR_REGISTRATION_CONTEXT_LIMITATION, reviewPriorRegistration,
} from '../packages/evidence/prior-registration.mts';

test('an observation well before the creation date suggests an earlier registration', () => {
  const review = reviewPriorRegistration({
    registrationCreatedAt: '2024-03-01T00:00:00Z',
    observations: [
      { source: 'web_archive', observedAt: '2024-05-01T00:00:00.000Z' },
      { source: 'certificate_log', observedAt: '2019-06-10T12:00:00.000Z' },
    ],
  });
  assert.equal(review.state, 'earlier_observation');
  assert.equal(review.registrationCreatedAt, '2024-03-01T00:00:00.000Z');
  assert.deepEqual(review.observations.map((item) => [item.source, item.daysBeforeRegistration]), [
    ['certificate_log', 1725],
    ['web_archive', null],
  ]);
  assert.match(review.limitations[0]!, /does not identify a previous or current owner/u);
});

test('observations within the tolerance or after creation do not suggest an earlier registration', () => {
  const review = reviewPriorRegistration({
    registrationCreatedAt: '2024-03-01',
    observations: [{ source: 'certificate_log', observedAt: '2024-02-28T06:00:00.000Z' }],
  });
  assert.equal(review.state, 'no_earlier_observation');
  assert.equal(review.observations[0]?.daysBeforeRegistration, null);
  assert.match(review.limitations[0]!, /does not show that the current registration is the first/u);
});

test('missing dates, invalid times and unknown sources are not comparable rather than absent', () => {
  assert.equal(reviewPriorRegistration({ registrationCreatedAt: null,
    observations: [{ source: 'certificate_log', observedAt: '2019-01-01T00:00:00Z' }] }).state, 'not_comparable');
  const invalid = reviewPriorRegistration({ registrationCreatedAt: '2024-03-01T00:00:00Z', observations: [
    { source: 'certificate_log', observedAt: '2019-01-01' },
    { source: 'other' as 'certificate_log', observedAt: '2019-01-01T00:00:00Z' },
  ] });
  assert.equal(invalid.state, 'not_comparable');
  assert.deepEqual(invalid.observations, []);
  assert.match(invalid.limitations[0]!, /No dated certificate log or archive observation/u);
});

test('a certificate validity start is context and cannot establish an earlier observation', () => {
  const validityOnly = reviewPriorRegistration({
    registrationCreatedAt: '2024-03-01T00:00:00Z',
    observations: [{ source: 'certificate_validity', observedAt: '2020-03-01T00:00:00Z' }],
  });
  assert.equal(validityOnly.state, 'not_comparable');
  assert.deepEqual(validityOnly.observations.map((item) => [item.source, item.label, item.context]),
    [['certificate_validity', 'Earliest certificate validity start', true]]);
  assert.ok(validityOnly.limitations.includes(PRIOR_REGISTRATION_CONTEXT_LIMITATION));
  // A later log entry beside an earlier validity start still yields no earlier observation.
  const laterLog = reviewPriorRegistration({
    registrationCreatedAt: '2024-03-01T00:00:00Z',
    observations: [{ source: 'certificate_validity', observedAt: '2020-03-01T00:00:00Z' }, { source: 'certificate_log', observedAt: '2024-06-01T00:00:00Z' }],
  });
  assert.equal(laterLog.state, 'no_earlier_observation');
  // Qualifying log entries and archive captures still establish one.
  for (const source of ['certificate_log', 'web_archive'] as const) {
    const review = reviewPriorRegistration({ registrationCreatedAt: '2024-03-01T00:00:00Z', observations: [{ source, observedAt: '2020-03-01T00:00:00Z' }] });
    assert.equal(review.state, 'earlier_observation', source);
    assert.equal(review.observations[0]?.context, false);
  }
});

test('certificate provenance yields an eligible log observation and validity context', () => {
  assert.deepEqual(certificatePriorRegistrationObservations({ firstObservedAt: '2020-01-01T00:00:00.000Z', firstValidFrom: '2019-06-01T00:00:00.000Z' }), [
    { source: 'certificate_log', observedAt: '2020-01-01T00:00:00.000Z' },
    { source: 'certificate_validity', observedAt: '2019-06-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(certificatePriorRegistrationObservations({ firstObservedAt: '2020-01-01T00:00:00.000Z', chronologyContradicted: true }), []);
  assert.deepEqual(certificatePriorRegistrationObservations({ firstObservedAt: null, firstValidFrom: '2019-06-01T00:00:00.000Z' }),
    [{ source: 'certificate_validity', observedAt: '2019-06-01T00:00:00.000Z' }]);
  assert.deepEqual(certificatePriorRegistrationObservations(null), []);
});
