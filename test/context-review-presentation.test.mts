import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextReviewSources, contextReviewTargets, incidentPresentation, platformPresentation, storefrontPresentation } from '../frontend/src/lib/analysis/context-review-presentation.ts';
import { connectorProvenancePresentation, reviewConnectorProvenance } from '../packages/investigation/connector-provenance-review.mts';
import { CONTEXT_NOW, CONTEXT_BEFORE, contextInputs, incidentStage, platformObject, storefrontObservation } from './context-review-fixtures.mts';

test('platform presentation groups exact identities, orders observations and keeps outcome dimensions separate', () => {
  const earlier = platformObject();
  const later = { ...earlier, observedAt: CONTEXT_NOW, version: '2.0.0', recheck: 'not_reproduced' };
  const other = { ...earlier, objectId: 'other-object' };
  const input = [later, other, earlier];
  const original = structuredClone(input);
  const view = platformPresentation(input);
  assert.deepEqual(input, original);
  assert.equal(view.groups.length, 2);
  assert.deepEqual(view.groups[0]?.map(row => row.observedAt), [CONTEXT_BEFORE, CONTEXT_NOW]);
  assert.equal(view.groups[0]?.[1]?.report, 'acknowledged');
  assert.equal(view.groups[0]?.[1]?.providerOutcome, 'provider_reports_resolved');
  assert.equal(view.groups[0]?.[1]?.recheck, 'not_reproduced');
});

test('storefront columns preserve unreviewed, reviewed-empty and supplied values', () => {
  const official = storefrontObservation(), candidate = { ...storefrontObservation('candidate.example.test'), brandNames: null, paymentMethods: [] };
  const view = storefrontPresentation({ official, candidate, authorisedComparator: true, resellerStatus: 'unknown', resellerSource: null });
  assert.deepEqual(view.official.brandNames, ['Example shop']);
  assert.equal(view.candidate.brandNames, null);
  assert.deepEqual(view.candidate.paymentMethods, []);
  assert.throws(() => storefrontPresentation({ official, candidate: { ...candidate, hostname: 'invalid host' }, authorisedComparator: true, resellerStatus: 'unknown', resellerSource: null }));
});

test('incident presentation retains analyst order, unknown time and source basis', () => {
  const input = [{ ...incidentStage(), id: 'later', occurredAt: CONTEXT_NOW }, { ...incidentStage(), id: 'earlier', occurredAt: CONTEXT_BEFORE }, incidentStage()];
  const view = incidentPresentation(input);
  assert.deepEqual(view.stages.map(row => row.id), ['later', 'earlier', 'reported-stage']);
  assert.equal(view.stages[2]?.occurredAt, null);
  assert.equal(view.stages[2]?.basis, 'reported_action');
});

test('connector layout gets minimised metadata without changing the portable report', () => {
  const input = contextInputs()[3]!.evidence;
  const result = connectorProvenancePresentation(input, CONTEXT_NOW);
  assert.deepEqual(result.report, reviewConnectorProvenance(input, CONTEXT_NOW));
  assert.equal(result.connectors.length, 2);
  assert.equal(result.connectors[0]?.origin, 'https://connector.example.test');
  assert.equal(result.connectors[1]?.package, '@example/connector@1.0.0');
  assert.doesNotMatch(JSON.stringify(result), /excluded-|private\/selected|--secret|Authorization/u);
  const sources = contextReviewSources(result.report);
  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.observedAt, null);
  assert.equal(sources[0]?.observations.length, 2);
  assert.deepEqual(contextReviewTargets(result.report), ['connector.example.test']);
  const observed = { ...result.report.observations[0]!, observedAt: CONTEXT_NOW };
  assert.equal(contextReviewSources({ ...result.report, observations: [...result.report.observations, observed] }).length, 2);
});
