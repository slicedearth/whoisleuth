import assert from 'node:assert/strict';
import test from 'node:test';
import { explainImportedFindingFields } from '../frontend/src/lib/analysis/import-field-explanation.ts';
import { externalFindingCaseProjection, parseExternalFindingsDocument, EXTERNAL_FINDINGS_VERSION } from '../packages/interchange/external-findings-import.mts';

function document(finding: Record<string, unknown> = {}, source = { name: 'Supplied example', reference: null as string | null }) {
  return {
    schema: 'whoisleuth.external-findings', schemaVersion: EXTERNAL_FINDINGS_VERSION, source,
    findings: [{ domain: 'Login.Example.TEST.', category: 'page', evidenceClass: 'provider_report',
      summary: 'A retained page observation.', observedAt: '2026-10-01T01:00:00+10:00', completeness: 'partial',
      limitations: ['Supplied, not collected here.'], reference: null, ...finding }],
  };
}

test('import explanations distinguish accepted hostname and time from unavailable original lexical values', () => {
  const raw = document();
  const before = structuredClone(raw);
  const parsed = parseExternalFindingsDocument(raw), finding = parsed.findings[0]!;
  const projection = externalFindingCaseProjection(finding, parsed.source);
  const retainedBefore = structuredClone({ parsed, projection });
  const fields = explainImportedFindingFields(finding, parsed.source, projection);
  const hostname = fields.find(field => field.id === 'hostname')!;
  assert.deepEqual(hostname.accepted, [{ path: 'finding.domain', value: 'login.example.test' }]);
  assert.deepEqual(hostname.retained, { path: 'evidencePin.observationHostname', value: 'login.example.test' });
  const time = fields.find(field => field.id === 'observedAt')!;
  assert.deepEqual(time.accepted, [{ path: 'finding.observedAt', value: '2026-09-30T15:00:00.000Z' }]);
  assert.equal(time.retained.value, '2026-09-30T15:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(fields), /Login\.Example\.TEST|2026-10-01T01:00:00\+10:00/u);
  assert.deepEqual(raw, before); assert.deepEqual({ parsed, projection }, retainedBefore);
});

test('long accepted values remain exact while the actual bounded Case projection stays separate', () => {
  const parsed = parseExternalFindingsDocument(document({ summary: 's'.repeat(900), reference: 'r'.repeat(500) },
    { name: 'n'.repeat(80), reference: null }));
  const finding = parsed.findings[0]!, projection = externalFindingCaseProjection(finding, parsed.source);
  const fields = explainImportedFindingFields(finding, parsed.source, projection);
  const value = fields.find(field => field.id === 'value')!;
  assert.deepEqual(value.accepted, [{ path: 'finding.summary', value: 's'.repeat(900) }, { path: 'finding.reference', value: 'r'.repeat(500) }]);
  assert.equal(value.retained.value, `${'s'.repeat(900)} Reference: ${'r'.repeat(500)}`.slice(0, 1000));
  const source = fields.find(field => field.id === 'source')!;
  assert.equal(source.accepted[0]!.value, 'n'.repeat(80));
  assert.equal(source.retained.value, `Provider report: ${'n'.repeat(80)}`.slice(0, 80));
  assert.deepEqual(projection.shortenedFields, ['finding value', 'source label']);
  assert.equal(projection.evidencePin.truncated, true);
});

test('structured evidence uses its accepted value and does not misidentify the summary as the retained source', () => {
  const parsed = parseExternalFindingsDocument(document({ category: 'dns', evidenceClass: 'deployment_observation',
    summary: 'Descriptive summary is not the DNS value.',
    structuredObservation: { sourceSchema: 'whoisleuth.dns-observation-rows', sourceVersion: 1, field: 'A', value: '192.0.2.12' } }));
  const finding = parsed.findings[0]!, projection = externalFindingCaseProjection(finding, parsed.source);
  const fields = explainImportedFindingFields(finding, parsed.source, projection);
  const value = fields.find(field => field.id === 'value')!;
  assert.deepEqual(value.accepted, [{ path: 'finding.structuredObservation.value', value: '192.0.2.12' }]);
  assert.equal(value.retained.value, '192.0.2.12');
  assert.equal(fields.find(field => field.id === 'source')!.retained.value, 'Deployment observation: Supplied example');
});

test('absent references remain absent and explanation cannot substitute its own retention algorithm', () => {
  const parsed = parseExternalFindingsDocument(document()), finding = parsed.findings[0]!;
  const projection = externalFindingCaseProjection(finding, parsed.source);
  const fields = explainImportedFindingFields(finding, parsed.source, { ...projection,
    evidencePin: { ...projection.evidencePin, value: 'Result provided by the retention owner' } });
  const value = fields.find(field => field.id === 'value')!;
  assert.deepEqual(value.accepted[1], { path: 'finding.reference', value: null });
  assert.equal(value.retained.value, 'Result provided by the retention owner');
});
