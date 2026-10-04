import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { parseContextInput, reviewContextInput } from '../packages/investigation/context-review.mts';
import { reviewDomainHistory, readDomainHistoryDeclarations } from '../packages/investigation/domain-history-review.mts';
import { domainTransitionReview } from '../packages/investigation/domain-transition-review.mts';
import { reviewPlatformContinuity, readPlatformObjects } from '../packages/investigation/platform-continuity-review.mts';
import { reviewStorefront, readStorefrontObservation } from '../packages/investigation/storefront-review.mts';
import { reviewConnectorProvenance, readConnectorConfiguration, reviewConnectorConfigurationText, connectorConfigurationPresentation } from '../packages/investigation/connector-provenance-review.mts';
import { reviewIncidentSequence, readIncidentStages, incidentStageFromPin } from '../packages/investigation/incident-sequence-review.mts';
import { updateCase } from '../packages/cases/case-record-operations.mts';
import { MAX_CONTEXT_INPUT_BYTES, MAX_CONTEXT_RECORDS } from '../packages/contracts/context-review.mts';
import { contextReviewTargets } from '../frontend/src/lib/analysis/context-review-presentation.ts';
import { storefrontDraft, storefrontDraftInput } from '../frontend/src/lib/analysis/storefront-review-draft.ts';
import { buildOfflineEvidenceReview, formatOfflineEvidenceReview } from '../cli/offline-evidence-review.mts';
import { runCli } from '../cli/runner.mts';
import { CONTEXT_NOW as NOW, CONTEXT_BEFORE as BEFORE, contextInputs, historyCase, platformObject, storefrontObservation, incidentStage } from './context-review-fixtures.mts';

describe('contextual evidence review', () => {
  test('domain history targets registration at the parent and explicit mail, web and certificate observations at their host', async () => {
    let record = historyCase();
    record.evidenceHistory = record.evidenceHistory.map(snapshot => ({ ...snapshot, inputHostname: 'login.example.test', observationHostname: 'login.example.test' }));
    const pin = { field: 'fingerprintSha256', category: 'certificate', label: 'Certificate publication', value: 'a'.repeat(64),
      source: 'Supplied certificate event', sourceSchema: { collection: 'external_observations', schema: 'whoisleuth.certificate-observation-rows', version: 1 },
      observedAt: NOW, completeness: 'partial', observationHostname: 'certificate.example.test',
      certificateObservation: { eventId: 'event-17', logId: 'fixture-log', certificateSha256: 'a'.repeat(64), issuer: null, notAfter: null, dnsNameCount: 1, namesComplete: true } };
    record = updateCase([record], record.id, { evidencePin: pin }, NOW).record;
    record = updateCase([record], record.id, { evidencePin: { ...pin, label: 'Certificate host unknown', observationHostname: undefined } }, NOW).record;
    const original = structuredClone(record);
    const report = reviewDomainHistory(record, { expectedChanges: [], retiredDependencies: [] }, NOW);
    for (const label of ['registration · Registrar', 'dns · Nameservers']) assert.equal(report.observations.find(row => row.label === label)?.hostname, 'example.test');
    for (const label of ['mail · MX', 'web · Page title']) assert.equal(report.observations.find(row => row.label === label)?.hostname, 'login.example.test');
    assert.equal(report.observations.find(row => row.label === 'Retained certificate · Certificate publication')?.hostname, 'certificate.example.test');
    assert.equal(report.observations.find(row => row.label === 'Retained certificate · Certificate host unknown')?.hostname, null);
    assert.deepEqual(contextReviewTargets(report), ['example.test', 'login.example.test', 'certificate.example.test']);
    const file = new File([JSON.stringify(report, null, 2)], 'history-review.json', { type: 'application/json' });
    assert.deepEqual(JSON.parse(await file.text()), report);
    assert.deepEqual(record, original);
  });

  test('browser and CLI dispatch the same exact bounded input without performing collection', () => {
    const inputs = contextInputs();
    assert.deepEqual(inputs.map(input => reviewContextInput(input, NOW).kind), ['domain_history', 'platform_continuity', 'storefront', 'connector', 'incident_sequence']);
    for (const input of inputs) {
      const copy = structuredClone(input), cli = buildOfflineEvidenceReview(JSON.stringify(input), NOW);
      assert.deepEqual(cli.result, reviewContextInput(input, NOW)); assert.deepEqual(input, copy);
      assert.match(formatOfflineEvidenceReview(cli), /Source:/u);
    }
  });
  test('rejects future formats, unknown fields, duplicated keys, excessive bytes and malformed nested evidence', () => {
    for (const input of contextInputs()) {
      assert.throws(() => reviewContextInput({ ...input, version: 2 }, NOW), /Unsupported/u);
      assert.throws(() => reviewContextInput({ ...input, extra: true }, NOW), /structure/u);
      assert.throws(() => reviewContextInput({ ...input, evidence: null }, NOW));
    }
    assert.throws(() => parseContextInput('{"schema":"a","schema":"b"}'), /duplicate/iu);
    assert.throws(() => parseContextInput(' '.repeat(MAX_CONTEXT_INPUT_BYTES + 1)), /byte/iu);
  });
  test('domain history derives meaningful changes from the existing comparison owner and retains declarations', () => {
    const result = reviewContextInput(contextInputs()[0], NOW);
    assert.ok(result.observations.some(row => row.label.startsWith('registration') && row.state === 'changed'));
    assert.ok(result.observations.some(row => row.label.startsWith('dns') && row.detail.includes('Overlaps 1')));
    assert.ok(result.observations.some(row => row.label.startsWith('mail')));
    assert.ok(result.observations.some(row => row.label.startsWith('web')));
    assert.ok(result.observations.some(row => row.label.includes('retired') && row.state === 'reported'));
    assert.ok(result.limitations.some(value => value.includes('takeover')));
  });
  test('history does not promote missing, equal-time or fast observations into a change sequence', () => {
    const declarations = { expectedChanges: [], retiredDependencies: [] };
    assert.equal(reviewDomainHistory(createCase({ domain: 'example.test' }, NOW), declarations, NOW).state, 'partial');
    const record = historyCase();
    const concurrent = { ...record, evidenceHistory: record.evidenceHistory.map(row => ({ ...row, capturedAt: NOW })) };
    const result = reviewDomainHistory(concurrent, declarations, NOW);
    assert.equal(result.state, 'partial'); assert.ok(result.observations.every(row => row.state !== 'changed'));
    const fast = { ...record, evidenceHistory: record.evidenceHistory.map(row => ({ ...row, scanDepth: 'fast' })) };
    assert.ok(reviewDomainHistory(fast, declarations, NOW).observations.every(row => !row.label.startsWith('mail') && !row.label.startsWith('web')));
  });
  test('expected windows, retirement relationships and Case export selection fail closed', () => {
    assert.throws(() => readDomainHistoryDeclarations({ expectedChanges: [{ family: 'dns', start: NOW, end: BEFORE, reason: 'Change' }], retiredDependencies: [] }), /ends before/u);
    assert.throws(() => reviewDomainHistory(historyCase(), { expectedChanges: [], retiredDependencies: [{ asset: 'unrelated.test', dependency: 'other.test', family: 'web', retiredAt: BEFORE, source: 'Fixture' }] }, NOW), /involve/u);
    const input = contextInputs()[0]!;
    assert.throws(() => reviewContextInput({ ...input, evidence: { ...(input.evidence as object), caseId: 'absent' } }, NOW), /not present/u);
  });
  test('domain transitions prompt scoped reassessment without changing earlier decisions or inferring control', () => {
    assert.match(domainTransitionReview('createdDate', BEFORE, NOW)!, /earlier relevance.*Keep the prior history.*does not establish/u);
    assert.match(domainTransitionReview('expiryDate', BEFORE, NOW)!, /Expiry, deletion and re-registration are different/u);
    assert.match(domainTransitionReview('hasPasswordField', false, true)!, /newly observed password form.*alone is not credential theft/u);
    assert.match(domainTransitionReview('hasMx', false, true)!, /does not show whether messages were sent/u);
    assert.match(domainTransitionReview('activityStatus', 'active', 'unreachable')!, /inconclusive.*do not treat it as disappearance/u);
    assert.match(domainTransitionReview('pageTitle', 'Parked', 'New shop')!, /expected site changes/u);
    for (const field of ['riskScore', 'riskModelVersion', 'opportunityScore', 'mutationTypes', 'feedMembership']) {
      assert.equal(domainTransitionReview(field, 0, 1), null);
    }
    assert.equal(domainTransitionReview('hasPasswordField', null, true), null);
    const record = historyCase();
    record.evidenceHistory[0]!.hasPasswordField = false;
    record.evidenceHistory[1]!.hasPasswordField = true;
    const original = structuredClone(record);
    const report = reviewDomainHistory(record, { expectedChanges: [], retiredDependencies: [] }, NOW);
    assert.ok(report.observations.some(row => row.label.includes('Password form') && row.state === 'changed'));
    assert.ok(report.nextSteps.some(value => value.includes('newly observed password form')));
    assert.deepEqual(record, original);
  });
  test('partial collections expose the comparison gap without creating an activation prompt', () => {
    const record = historyCase();
    record.evidenceHistory[0]!.hasPasswordField = false;
    record.evidenceHistory[1]!.hasPasswordField = true;
    record.evidenceHistory[1]!.webCollectionQuality = { version: 1, page: 'unavailable', favicon: 'not_collected', combined: 'partial' };
    const report = reviewDomainHistory(record, { expectedChanges: [], retiredDependencies: [] }, NOW);
    assert.equal(report.state, 'partial');
    assert.ok(report.observations.some(row => row.label === 'Comparison coverage' && row.state === 'partial'));
    assert.ok(!report.observations.some(row => row.label.includes('Password form')));
    assert.ok(!report.nextSteps.some(value => value.includes('newly observed password form')));
  });
  test('platform continuity scopes identity to origin and object type, preserving version and per-object outcomes', () => {
    const first = platformObject();
    const result = reviewPlatformContinuity([first, { ...first, version: '2.0.0', observedAt: NOW }, { ...first, objectType: 'account' }, { ...first, platformOrigin: 'https://different.example.test' }], NOW);
    assert.match(result.summary, /distinct platform objects: 3/u);
    assert.match(result.observations[0]!.detail, /provider reports resolved; independent recheck: still observed/u);
    assert.match(result.observations[0]!.detail, /2 versions/u);
    assert.equal(result.observations[0]!.state, 'reported');
  });
  test('platform records reject contradictions, duplicate observations and unbounded identifiers', () => {
    const row = platformObject();
    for (const patch of [{ platformOrigin: 'https://example.test/path?secret=1' }, { report: 'not_reported' }, { recheckedAt: null }, { recheckedAt: '2026-01-01T00:00:00.000Z' }, { objectId: 'a'.repeat(241) }]) assert.throws(() => readPlatformObjects([{ ...row, ...patch }]));
    assert.throws(() => readPlatformObjects([row, row]), /Duplicate/u);
    assert.throws(() => readPlatformObjects(Array(MAX_CONTEXT_RECORDS + 1).fill(row)));
    assert.equal(reviewPlatformContinuity([], NOW).state, 'partial');
  });
  test('storefront review preserves legitimate authority and unknown categories without a scam score', () => {
    const evidence = contextInputs()[2]!.evidence as Record<string, unknown>;
    const result = reviewStorefront(evidence, NOW);
    assert.ok(result.observations.some(row => row.label.includes('Reseller') && row.detail === 'authorised'));
    assert.ok(result.observations.some(row => row.detail.includes('Exact shared values: 1')));
    assert.equal(Object.hasOwn(result, 'score'), false);
    const partial = reviewStorefront({ ...evidence, candidate: { ...storefrontObservation('candidate.example.test'), brandNames: null, assetHashes: null } }, NOW);
    assert.equal(partial.state, 'partial'); assert.equal(partial.observations.filter(row => row.state === 'unknown').length, 2);
  });
  test('storefront comparison requires authority, source, valid origins, digests and distinct sites', () => {
    const evidence = contextInputs()[2]!.evidence as Record<string, unknown>;
    for (const patch of [{ authorisedComparator: false }, { resellerSource: null }, { candidate: evidence.official }]) assert.throws(() => reviewStorefront({ ...evidence, ...patch }, NOW));
    for (const patch of [{ assetHashes: ['not-a-digest'] }, { checkoutOrigins: ['https://checkout.example.test/pay?token=1'] }, { brandNames: Array(MAX_CONTEXT_RECORDS + 1).fill('Example') }]) assert.throws(() => readStorefrontObservation({ ...storefrontObservation(), ...patch }));
  });
  test('storefront drafts preserve not-reviewed versus no-values and require explicit timezone', () => {
    const draft = storefrontDraft('example.test'); draft.source = 'Fixture'; draft.observedAt = NOW;
    draft.fields.brandNames.reviewed = true;
    const input = storefrontDraftInput(draft); assert.deepEqual(input.brandNames, []); assert.equal(input.assetHashes, null);
    draft.observedAt = '2026-09-20'; assert.throws(() => storefrontDraftInput(draft), /timezone/u);
  });
  test('connector projection excludes private values, local paths, URLs and execution arguments independently', () => {
    const result = reviewContextInput(contextInputs()[3], NOW), output = JSON.stringify(result);
    assert.doesNotMatch(output, /excluded-|private\/selected|private\?token|Authorization|--secret/u);
    assert.match(output, /@example\/connector@1.0.0/u); assert.match(output, /https:\/\/connector.example.test/u);
    assert.match(output, /local connector/u); assert.match(output, /remote connector/u);
    assert.ok(result.observations.every(row => row.observedAt === null));
  });
  test('connector comparison distinguishes changed metadata, new entries and excluded values not compared', () => {
    const previous = { servers: { one: { url: 'https://one.example.test/path?key=a', headers: { X: 'first' } }, gone: { command: 'example' } } };
    const current = { servers: { one: { url: 'https://one.example.test/other?key=b', headers: { X: 'second' } }, new: { command: 'example' } } };
    const result = reviewConnectorProvenance({ previous, current }, NOW);
    assert.match(result.observations[0]!.detail, /matches; excluded values were not compared/u);
    assert.match(result.observations[1]!.detail, /Newly listed/u);
    assert.match(result.observations[2]!.label, /no longer listed/u);
    const changed = reviewConnectorProvenance({ previous, current: { servers: { one: { url: 'https://changed.example.test', disabled: true } } } }, NOW);
    assert.equal(changed.observations[0]!.state, 'changed'); assert.match(changed.observations[0]!.detail, /disabled/u);
  });
  test('connector handling rejects ambiguous containers and credentials and qualifies unsupported fields', () => {
    for (const input of [{ servers: {}, mcpServers: {} }, { servers: {}, unrelated: {} }, { servers: { one: { url: 'https://secret:password@example.test' } } }, { servers: { one: { command: 'npx', enabled: true, disabled: true } } }]) assert.throws(() => readConnectorConfiguration(input));
    const result = reviewConnectorProvenance({ current: { servers: { one: { url: 'https://example.test', command: 'node', futureOption: true } } }, previous: null }, NOW);
    assert.equal(result.state, 'partial'); assert.match(result.observations[0]!.detail, /Uninterpreted fields: 1/u);
    assert.equal(reviewConnectorProvenance({ current: { servers: {} }, previous: null }, NOW).state, 'partial');
  });
  test('connector worker computation shares bounded parsing and handles only one request', async () => {
    const current = JSON.stringify({ servers: { selected: { url: 'https://example.test/private?token=excluded-worker-value', headers: { Authorization: 'excluded-secret' } } } });
    const expected = connectorConfigurationPresentation(current, '', NOW);
    assert.doesNotMatch(JSON.stringify(expected), /excluded-/u);
    assert.throws(() => reviewConnectorConfigurationText('{"servers":{},"servers":{}}', '', NOW), /duplicate/iu);
    assert.throws(() => reviewConnectorConfigurationText(' '.repeat(MAX_CONTEXT_INPUT_BYTES + 1), '', NOW), /byte/iu);
    const original = Object.getOwnPropertyDescriptor(globalThis, 'self'), replies: unknown[] = [];
    const scope: { postMessage(value: unknown): void; onmessage?: (event: MessageEvent) => void } = { postMessage: value => replies.push(value) };
    Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
    try {
      await import('../frontend/src/lib/workers/connector-provenance.worker.ts');
      assert.equal(typeof scope.onmessage, 'function');
      scope.onmessage!(new MessageEvent('message', { data: { current, previous: '', reviewedAt: NOW } }));
      scope.onmessage!(new MessageEvent('message', { data: { current: '{}', previous: '', reviewedAt: NOW } }));
      assert.deepEqual(replies, [expected]);
    } finally { if (original) Object.defineProperty(globalThis, 'self', original); else Reflect.deleteProperty(globalThis, 'self'); }
  });
  test('CLI contextual workflows retain strict partial exit and make no network calls', async () => {
    for (const input of [...contextInputs(), { schema: 'whoisleuth.platform-continuity.input', version: 1, evidence: [] }]) {
      let output = '';
      let requests = 0;
      const denied = async (): Promise<never> => { requests++; throw new Error('No collection is permitted'); };
      const code = await runCli(['review-evidence', '--json', '--strict-exit'], { readArtifactInput: async () => JSON.stringify(input), stdout: { write(value: string) { output += value; } }, stderr: { write() {} }, runUnifiedLookup: denied, safeFetch: denied, resolvePublicAddresses: denied, whoisQuery: denied, now: () => NOW });
      const expected = reviewContextInput(input, NOW); assert.equal(code, expected.state === 'partial' ? 4 : 0);
      assert.deepEqual(JSON.parse(output).result, expected);
      assert.equal(requests, 0);
    }
  });
  test('incident sequences preserve source basis, unknown times and analyst order without a causal verdict', () => {
    const first = incidentStage();
    const input = [first, { ...first, id: 'imported-stage', kind: 'navigation', basis: 'imported_record', occurredAt: NOW, completeness: 'complete' },
      { ...first, id: 'earlier-stage', occurredAt: BEFORE, completeness: 'complete' }];
    const result = reviewIncidentSequence(input, NOW);
    assert.equal(result.state, 'partial');
    assert.match(result.summary, /Timestamp reversals needing review: 1/u);
    assert.equal(result.observations[0]!.observedAt, null);
    assert.match(result.observations[1]!.label, /imported record/u);
    assert.match(result.observations[2]!.label, /reported action/u);
    assert.ok(result.limitations.some(value => value.includes('not proof of causation')));
    assert.equal(Object.hasOwn(result, 'verdict'), false);
    assert.equal(reviewIncidentSequence([], NOW).state, 'partial');
  });
  test('retained stage selection copies provenance and downgrades a contradictory truncated pin', () => {
    const initial = createCase({ domain: 'example.test' }, NOW);
    const saved = updateCase([initial], initial.id, { evidencePin: { label: 'Selected page prompt', value: 'A credential form was visible.', source: 'Selected capture', observedAt: null, completeness: 'complete', truncated: true, limitations: ['Only the first screen was captured.'] } }, NOW).record;
    const pin = saved.evidencePins[0]!;
    const stage = incidentStageFromPin(pin, 'identity_prompt', 'stage-1');
    assert.equal(stage.occurredAt, null); assert.equal(stage.completeness, 'partial');
    assert.equal(stage.reference, pin.id); assert.equal(stage.source, pin.source);
    assert.deepEqual(stage.limitations, pin.limitations); assert.equal(stage.description, pin.value);
  });
  test('incident input rejects ambiguous identities, control data, future fields and false date precision', () => {
    const row = incidentStage();
    for (const patch of [{ id: '../bad' }, { basis: 'confirmed_attack' }, { occurredAt: '2026-09-20' }, { hostname: 'https://example.test/path' }, { referenceSha256: 'bad' }, { unexpected: true }, { description: '\u001b[31m' }]) assert.throws(() => readIncidentStages([{ ...row, ...patch }]));
    assert.throws(() => readIncidentStages([row, row]), /unique/u);
    assert.throws(() => readIncidentStages(Array(MAX_CONTEXT_RECORDS + 1).fill(row)));
  });
});
