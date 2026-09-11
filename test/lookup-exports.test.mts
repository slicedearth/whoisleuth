import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  exportLookupEvidence,
  exportLookupReadableReport,
  prepareLookupEvidenceExport,
} from '../frontend/src/lib/analysis/lookup-exports.ts';
import type { LookupHttpResponse } from '../lib/lookup-response-contract.mts';
import { MAX_BOUNDED_JSON_DEPTH } from '../lib/bounded-json.mts';
import { buildDecisionFacts } from '../packages/evidence/decision-fact.mts';

const result: LookupHttpResponse = {
  query: 'example.test', type: 'domain', observedAt: '2026-09-01T00:00:00.000Z',
  rdap: { data: { privateContact: 'not-for-export@example.test' } },
  whois: { raw: 'private raw response' },
  availability: { state: 'unknown', applicable: true },
  diagnostics: {},
};
const options = { generatedAt: '2026-09-01T00:00:00.000Z', applicationVersion: '2.3.1' };

test('Lookup evidence download uses the prepared projection and preserves its privacy boundary', async () => {
  const projection = prepareLookupEvidenceExport(result, options);
  assert.equal(projection.error, null);
  assert.ok(projection.document);
  const downloads: { blob: Blob; filename: string }[] = [];
  assert.equal(exportLookupEvidence(result, projection, (blob, filename) => downloads.push({ blob, filename })), '');
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0]!.blob.type, 'application/json');
  assert.match(downloads[0]!.filename, /\.json$/u);
  const body = await downloads[0]!.blob.text();
  assert.doesNotMatch(body, /not-for-export|private raw response/u);
  assert.match(body, /example\.test/u);
});

test('absent or bounded-out Lookup evidence never starts a download', () => {
  const download = () => assert.fail('No download should be attempted.');
  const absent = prepareLookupEvidenceExport(null, options);
  assert.deepEqual(absent, { document: null, error: null });
  assert.equal(exportLookupEvidence(null, absent, download), null);
  assert.equal(exportLookupReadableReport(null, absent, {}, download), null);
  const limited = { document: null, error: 'The evidence structure exceeds its bound.' };
  assert.match(exportLookupEvidence(result, limited, download)!, /^Evidence JSON was not created\./u);
  assert.match(exportLookupReadableReport(result, limited, {}, download)!, /^Readable report was not created\./u);
});

test('Lookup export keeps unexpected builder and download failures visible', () => {
  assert.throws(() => prepareLookupEvidenceExport(result, { generatedAt: 'invalid' }), /generation time/u);
  const projection = prepareLookupEvidenceExport(result, options);
  const failure = new Error('Local download unavailable');
  assert.throws(() => exportLookupEvidence(result, projection, () => { throw failure; }), (cause) => cause === failure);
});

test('oversized evidence reports a bounded failure while retaining the original result', () => {
  let nested: Record<string, unknown> = {};
  for (let depth = 0; depth <= MAX_BOUNDED_JSON_DEPTH; depth += 1) nested = { child: nested };
  const oversized = { ...result, rdap: { data: nested } } as LookupHttpResponse;
  const projection = prepareLookupEvidenceExport(oversized, options);
  assert.equal(projection.document, null);
  assert.match(projection.error!, /result remains available/u);
  assert.equal(oversized.rdap?.data, nested);
});

test('readable report download retains the output type and excludes raw source material', async () => {
  const projection = prepareLookupEvidenceExport(result, options);
  const downloads: Blob[] = [];
  const decisionFacts = buildDecisionFacts([{
    id: 'retained-registration', question: 'What does the retained registration evidence establish?',
    conclusion: 'Registration evidence is unavailable.', importance: 'medium',
    evidenceState: 'unavailable', freshness: 'unknown', consistency: 'not_applicable',
    contributors: [], limitations: [], references: [], nextActions: [],
  }]);
  assert.equal(exportLookupReadableReport(result, projection, { decisionFacts }, (blob, filename) => {
    assert.match(filename, /\.md$/u);
    downloads.push(blob);
  }), null);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0]!.type, 'text/markdown;charset=utf-8');
  assert.doesNotMatch(await downloads[0]!.text(), /not-for-export|private raw response/u);
});
