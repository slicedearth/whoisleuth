import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewPriorRegistration } from '../packages/evidence/prior-registration.mts';

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
  assert.match(invalid.limitations[0]!, /No dated certificate or archive observation/u);
});
