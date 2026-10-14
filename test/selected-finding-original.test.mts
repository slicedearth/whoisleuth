import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseSelectedFindingJson } from '../frontend/src/lib/analysis/selected-finding-original.ts';
import { externalFindingCaseProjection, MAX_EXTERNAL_FINDINGS_IMPORT_BYTES } from '../packages/interchange/external-findings-import.mts';

const finding = { domain: 'Login.Example.TEST.', category: 'page', evidenceClass: 'provider_report',
  summary: 'Selected fixture observation', observedAt: '2026-10-01T01:00:00+10:00', completeness: 'partial', limitations: ['Fixture source'] };
const document = (findings: unknown[] = [finding]) => ({ schema: 'whoisleuth.external-findings', schemaVersion: 5, source: { name: 'Selected fixture' }, findings });
const bytes = (raw: string) => new TextEncoder().encode(raw).buffer;

test('selected original preserves source spelling and time notation, byte identity, BOM and parser-owned locations', async () => {
  const raw = '\ufeff' + JSON.stringify(document(), null, 2).replaceAll('\n', '\r\n').replace('"domain"', '"dom\\u0061in"').replace('Selected fixture observation', 'Selected \\u0066ixture observation');
  const input = bytes(raw), parsed = await parseSelectedFindingJson(input);
  assert.ok(parsed.document && parsed.original);
  const accepted = parsed.document.findings[0]!;
  const location = parsed.original.locate(parsed.document, accepted, 'finding.domain');
  assert.equal(location.state, 'available');
  if (location.state !== 'available') throw new Error('Missing source location');
  assert.equal(location.path, '$.findings[0].domain');
  assert.equal(location.lexical, '"Login.Example.TEST."');
  assert.equal(location.value, 'Login.Example.TEST.');
  assert.equal(location.offset, raw.indexOf('"Login.Example.TEST."'));
  assert.equal(location.end, location.offset + 21);
  assert.equal(location.line, 9); assert.equal(location.column, 22);
  assert.equal(location.byteOrderMark, true);
  assert.equal(location.byteLength, input.byteLength);
  assert.equal(location.digestSha256, createHash('sha256').update(new Uint8Array(input)).digest('hex'));
  assert.equal(accepted.domain, 'login.example.test');
  assert.equal(accepted.observedAt, '2026-09-30T15:00:00.000Z');
  const time = parsed.original.locate(parsed.document, accepted, 'finding.observedAt');
  assert.equal(time.state === 'available' && time.value, finding.observedAt);
  const summary = parsed.original.locate(parsed.document, accepted, 'finding.summary');
  assert.equal(summary.state === 'available' && summary.lexical, '"Selected \\u0066ixture observation"');
  const projected = externalFindingCaseProjection(accepted, parsed.document.source);
  assert.doesNotMatch(JSON.stringify(projected), /Login\.Example\.TEST|dom\\u0061in|digestSha256|byteOrderMark/);
  assert.equal(parsed.original.locate(parsed.document, accepted, 'finding.reference').state, 'not_supplied');
  assert.equal(parsed.original.locate(parsed.document, accepted, 'finding.missing').state, 'unavailable');
  assert.equal(parsed.original.locate(structuredClone(parsed.document), accepted, 'finding.domain').state, 'unavailable');
  assert.equal(parsed.original.locate(parsed.document, { ...accepted }, 'finding.domain').state, 'unavailable');
  parsed.original.dispose();
  assert.equal(parsed.original.locate(parsed.document, accepted, 'source.name').state, 'unavailable');
});

test('deduplication keeps ambiguous origins separate from the next original row and a unique source label', async () => {
  const raw = JSON.stringify(document([finding, { ...finding, domain: 'login.example.test', observedAt: '2026-09-30T15:00:00Z' },
    { ...finding, domain: 'third.example.test', summary: 'Different row with the same reported time' }]));
  const parsed = await parseSelectedFindingJson(bytes(raw));
  assert.ok(parsed.document && parsed.original);
  assert.equal(parsed.document.findings.length, 2);
  assert.equal(parsed.original.locate(parsed.document, parsed.document.findings[0]!, 'finding.domain').state, 'ambiguous');
  const source = parsed.original.locate(parsed.document, parsed.document.findings[0]!, 'source.name');
  assert.equal(source.state === 'available' && source.value, 'Selected fixture');
  const third = parsed.original.locate(parsed.document, parsed.document.findings[1]!, 'finding.domain');
  assert.equal(third.state === 'available' && third.path, '$.findings[2].domain');
  assert.equal(third.state === 'available' && third.value, 'third.example.test');
});

test('a selected input snapshot survives caller mutation and keeps structured values distinct from summary text', async () => {
  const raw = JSON.stringify(document([{ ...finding, category: 'dns', evidenceClass: 'deployment_observation',
    structuredObservation: { sourceSchema: 'whoisleuth.dns-observation-rows', sourceVersion: 1, field: 'A', value: '192.0.2.12' } }]));
  const input = bytes(raw), pending = parseSelectedFindingJson(input);
  new Uint8Array(input).fill(0);
  const parsed = await pending;
  assert.ok(parsed.document && parsed.original);
  const source = parsed.original.locate(parsed.document, parsed.document.findings[0]!, 'finding.structuredObservation.value');
  assert.equal(source.state === 'available' && source.lexical, '"192.0.2.12"');
  assert.equal(source.state === 'available' && source.digestSha256, createHash('sha256').update(raw).digest('hex'));
});

test('unsupported documents have no original finding context, and invalid or oversized inputs fail before publication', async () => {
  assert.deepEqual(await parseSelectedFindingJson(bytes('[{"domain":"input.example"}]')), { value: [{ domain: 'input.example' }], document: null, original: null });
  for (const raw of ['', '{', '{"x":1,"x":2}', JSON.stringify({ ...document(), schemaVersion: 999 }),
    JSON.stringify(document()) + ' '.repeat(MAX_EXTERNAL_FINDINGS_IMPORT_BYTES), ' '.repeat(512 * 1024 + 1)]) {
    await assert.rejects(parseSelectedFindingJson(bytes(raw)));
  }
  await assert.rejects(parseSelectedFindingJson(Uint8Array.of(0xff).buffer));
});

test('digest failures do not expose unexpected implementation messages or publish a partial original', async context => {
  context.mock.method(globalThis.crypto.subtle, 'digest', async () => { throw new Error('private digest detail'); });
  await assert.rejects(parseSelectedFindingJson(bytes(JSON.stringify(document()))),
    { message: 'The selected file digest could not be prepared. No findings were imported.' });
});
