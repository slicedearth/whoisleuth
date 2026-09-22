import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readPageBehaviour, readManifestPageBehaviour, comparePageBehaviour, type PageBehaviour } from '../packages/investigation/page-behaviour.mts';
import { buildPageBehaviour } from '../packages/web-capture/page-observation-boundary.mts';
import { readWebCaptureManifest } from '../packages/interchange/web-capture-import.mts';

const empty = (): PageBehaviour => ({ version: 1, state: 'observed', requests: [], elements: [], actionHints: [], clipboardWriteAttempts: 0 });
const script = (position = 1, digest = 'a'.repeat(64)) => ({ position, kind: 'script' as const, origin: 'https://static.example.test', contentSha256: digest, status: 200, cspEnforced: false, cspReportOnly: false });

test('capture observations minimise URLs and hash inline scripts without retaining code or form values', () => {
  const code = '/* private script text */';
  const result = buildPageBehaviour({ partial: false, clipboardWriteAttempts: 1, elements: [
    { position: 1, kind: 'script', url: '', base: 'https://example.test/private?token=sentinel', inlineText: code, inline: true, integrity: false, method: null, passwordFields: 0 },
    { position: 2, kind: 'form', url: 'https://submit.example.test/private?token=sentinel', base: 'https://example.test/', inlineText: null, inline: false, integrity: false, method: 'POST', passwordFields: 1 },
    { position: 3, kind: 'frame', url: 'https://user:secret@frame.example.test/', base: 'https://example.test/', inlineText: null, inline: false, integrity: false, method: null, passwordFields: 0 },
  ] }, [script()], 'Verify you are human. Copy and paste into terminal.', false);
  assert.equal(result.elements[0]!.scriptSha256, createHash('sha256').update(code).digest('hex'));
  assert.equal(result.elements[1]!.origin, 'https://submit.example.test');
  assert.equal(result.elements[2]!.origin, null);
  assert.equal(result.clipboardWriteAttempts, 1);
  assert.deepEqual(result.actionHints, ['clipboard_instruction', 'shell_instruction', 'verification_prompt']);
  assert.doesNotMatch(JSON.stringify(result), /private|sentinel|secret|script text|Verify you/u);
});

test('page observation reader rejects extra raw fields, full URLs, invalid kinds, duplicate positions and bounds', () => {
  for (const value of [
    { ...empty(), rawText: 'private' }, { ...empty(), version: 2 },
    { ...empty(), requests: [{ ...script(), origin: 'https://example.test/private?token=secret' }] },
    { ...empty(), requests: [script(), script()] },
    { ...empty(), requests: [{ ...script(), kind: 'navigation' }] },
    { ...empty(), requests: Array.from({ length: 501 }, (_, i) => script(i + 1)) },
    { ...empty(), clipboardWriteAttempts: -1 }, { ...empty(), actionHints: ['consent_instruction', 'consent_instruction'] },
    { ...empty(), elements: [{ position: 1, kind: 'script', inline: false, origin: null, integrity: 'absent', method: null, passwordFields: 0, scriptSha256: 'a'.repeat(64) }] },
  ]) assert.throws(() => readPageBehaviour(value));
});

test('versioned manifests keep historical observations unknown and reject missing or contradictory current observations', async () => {
  const read = async (version: number) => JSON.parse(await readFile(new URL(`./fixtures/extracted-domain-lifecycle/web-capture-manifest-v${version}.json`, import.meta.url), 'utf8'));
  const old = await read(2), current = await read(3);
  assert.equal(readWebCaptureManifest(old).captures[0]!.pageBehaviour, null);
  assert.equal(readWebCaptureManifest(current).captures[0]!.pageBehaviour!.state, 'partial');
  assert.throws(() => readWebCaptureManifest({ ...current, schemaVersion: 4 }));
  assert.throws(() => readWebCaptureManifest({ ...current, schemaVersion: 2 }));
  assert.throws(() => readManifestPageBehaviour(undefined, 3));
  current.captures[0].completeness = 'complete';
  assert.throws(() => readWebCaptureManifest(current), /Partial/u);
});

test('dependency comparison preserves multiplicity and hash and policy changes', () => {
  const first = { ...empty(), requests: [script(1), script(2)] };
  const second = { ...empty(), requests: [script(1), { ...script(2, 'b'.repeat(64)), cspEnforced: true }] };
  const result = comparePageBehaviour(first, second);
  assert.equal(result.state, 'changed');
  assert.equal(result.added.length, 1); assert.equal(result.notReobserved.length, 1);
  assert.equal(result.notReobserved[0]!.count, 1); assert.equal(result.added[0]!.digest, 'b'.repeat(64));
  assert.equal(comparePageBehaviour(first, first).state, 'unchanged');
  assert.equal(comparePageBehaviour({ ...first, state: 'partial' }, first).state, 'inconclusive');
  assert.deepEqual(comparePageBehaviour(null, first).added, []);
  assert.equal(comparePageBehaviour(null, first).state, 'unavailable');
  assert.equal(result.removalEstablished, false);
});

test('navigation order and blocked clipboard attempts are distinct from resource inventory changes', () => {
  const nav = (position: number, origin: string) => ({ ...script(position), kind: 'navigation' as const, origin, contentSha256: null });
  const first = { ...empty(), requests: [nav(1, 'https://example.test'), nav(2, 'https://other.example.test')] };
  const second = { ...first, requests: [nav(1, 'https://other.example.test'), nav(2, 'https://example.test')] };
  assert.equal(comparePageBehaviour(first, second).navigationChanged, true);
  assert.equal(comparePageBehaviour(first, { ...first, clipboardWriteAttempts: 1 }).clipboardWriteDelta, 1);
  assert.equal(comparePageBehaviour(first, { ...first, clipboardWriteAttempts: 1 }).state, 'changed');
});
