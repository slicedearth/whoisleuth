#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { serializeCaseStore } from '../packages/cases/case-storage-model.mts';
import { BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID } from '../packages/contracts/browser-local-collection-manifest.mts';
import { startVerifiedLocalProcess } from './local-application-process.mts';

const [packageDirectory, guard] = process.argv.slice(2);
if (!packageDirectory || !guard) throw new Error('An installed local package and its fixture network guard are required.');
const root = path.resolve(packageDirectory, 'runtime');
const protocol: typeof import('../packages/workspace/local-application-protocol.mts') = await import(pathToFileURL(path.join(root, 'packages/workspace/local-application-protocol.mjs')).href);
const executable = path.join(root, 'packages/local-application/bin/whoisleuth-local.mjs');
const temporary = await mkdtemp(path.join(tmpdir(), 'whoisleuth-installed-local-')), workspace = path.join(temporary, 'workspace');
const checks: string[] = [];

async function start(create: boolean) {
  const process = await startVerifiedLocalProcess({ entry: executable, guard: guard!, workspace, cwd: temporary, create });
  try {
    const { origin } = process;
    const token = new URL(process.launchUrl).hash.slice(1);
    const response = await fetch(`${origin}/api/local-session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const request = (endpoint: string, body?: BodyInit, contentType = 'application/json', workspaceId?: string) => fetch(`${origin}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': contentType, ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}) },
      ...(body === undefined ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    const info = await (await request('/api/local-workspace/info')).json();
    return { origin, request, workspaceId: info.workspaceId as string, close: process.close };
  } catch (cause) { await process.close(); throw cause; }
}

let instance: Awaited<ReturnType<typeof start>> | undefined;
try {
  instance = await start(true);
  const { workspaceId, request } = instance;
  for (const route of ['/dashboard', '/cases', '/lookup', '/cli']) {
    const response = await request(route); assert.equal(response.status, 200);
    assert.match(await response.text(), /name="whoisleuth-local-application" content="1"/u);
  }
  assert.equal((await fetch(`${instance.origin}/api/local-workspace/info`, { headers: { Origin: instance.origin } })).status, 401);
  assert.equal((await request('/api/lookup', '{}')).status, 503);
  checks.push('compiled loopback host and production routes', 'authentication and offline collection denial');
  // Repository models prepare synthetic input only. Execution, protocol and
  // persistence must resolve exclusively from the installed package.
  const record = createCase({ domain: 'example.test', note: 'Retained local package fixture.' }, '2026-09-01T00:00:00.000Z');
  const payload = JSON.stringify({ id: record.id, value: record });
  const rows = [{ key: ['cases', record.id] as [string, string], collection: 'cases', lookupKey: record.id, ordinal: 0, codec: 'json-v1', payload, payloadBytes: Buffer.byteLength(payload) }];
  const canonical = JSON.stringify(rows.map(row => [row.lookupKey, row.ordinal, row.codec, row.payload, row.payloadBytes]));
  const manifest = { collection: 'cases', schemaVersion: BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.cases.schemaVersion, codec: 'json-v1', revision: 1, recordCount: 1,
    serializedBytes: Buffer.byteLength(serializeCaseStore([record])), digest: createHash('sha256').update(canonical).digest('base64url'), source: 'application' as const,
    updatedAt: '2026-09-01T00:00:00.000Z', legacyKey: 'whois-rdap-cases-v1', legacyDigest: null };
  const bytes = protocol.encodeLocalApplicationCommit({ expected: new Map([['cases', null]]), collections: [{ manifest, records: rows }], binaries: [], createEmpty: new Set(['cases']) }, randomUUID());
  const commit = await request('/api/local-workspace/commit', new Blob([Uint8Array.from(bytes)]), 'application/zip', workspaceId);
  assert.equal(commit.status, 200); const acknowledgement = await commit.json();
  const receipt = await (await request(`/api/local-workspace/receipt/${acknowledgement.operationId}`, undefined, undefined, workspaceId)).json();
  assert.equal(receipt.digest, createHash('sha256').update(bytes).digest('hex'));
  checks.push('compiled worker and atomic filesystem transaction', 'exact durable write acknowledgement');
  await instance.close(); instance = undefined;
  instance = await start(false); assert.equal(instance.workspaceId, workspaceId);
  const capture = await (await instance.request('/api/local-workspace/capture', JSON.stringify({ collections: ['cases'] }), undefined, workspaceId)).json();
  assert.equal(capture[0].records.length, 1); assert.deepEqual(JSON.parse(capture[0].records[0][1]).value, record);
  const file = await readFile(path.join(workspace, 'workspace.sqlite')); assert.equal(file.subarray(0, 16).toString('binary'), 'SQLite format 3\0');
  checks.push('process restart preserves Case identity and content', 'clean termination leaves a readable workspace');
  await instance.close(); instance = undefined;
  process.stdout.write(JSON.stringify(checks) + '\n');
} finally { await instance?.close(); await rm(temporary, { recursive: true, force: true }); }
