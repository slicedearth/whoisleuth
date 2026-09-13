import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { zipSync, unzipSync } from 'fflate';
import {
  prepareBagItEntries, inspectBagItEntries, encodeBagItEntries, readBagItZip,
  assertBagItSelection, bagItPath, MAX_BAGIT_PAYLOAD_FILES, MAX_BAGIT_FILE_BYTES,
  MAX_BAGIT_PAYLOAD_BYTES, MAX_BAGIT_TAG_BYTES, MAX_BAGIT_TAG_FILES, MAX_BAGIT_TOTAL_TAG_BYTES,
  MAX_BAGIT_DEPTH, MAX_BAGIT_PATH_BYTES, UnsupportedBagItError,
} from '../packages/interchange/bagit.mts';
import { buildInvestigationBagIt } from '../packages/investigation/investigation-bagit.mts';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
const hash = (value: Uint8Array, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
// Independently assembled expectations: this fixture does not use the writer.
function fixture() {
  const content = bytes('original evidence\n');
  return new Map([
    ['bagit.txt', bytes('BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n')],
    ['data/', new Uint8Array()], ['data/nested/source.bin', content],
    ['manifest-sha256.txt', bytes(`${hash(content)}  data/nested/source.bin\n`)],
  ]);
}

for (const algorithm of ['sha256', 'sha512'] as const) test(`BagIt ${algorithm} creation agrees with independent byte digests and preserves opaque payloads`, async () => {
  const source = new Uint8Array([0, 255, 128, 10]), payload = new Map([['data/a%name.bin', source], ['data/empty.bin', new Uint8Array()]]);
  const pending = prepareBagItEntries(payload, new Map([['notes/source.txt', bytes('declared only')]]), algorithm);
  source.fill(7);
  const files = await pending, zip = encodeBagItEntries(files), extracted = unzipSync(zip);
  assert.deepEqual(extracted['data/a%name.bin'], new Uint8Array([0, 255, 128, 10]));
  assert.equal(text(files.get(`manifest-${algorithm}.txt`)!), `${hash(new Uint8Array([0, 255, 128, 10]), algorithm)}  data/a%25name.bin\n${hash(new Uint8Array(), algorithm)}  data/empty.bin\n`);
  assert.equal(text(files.get('bag-info.txt')!), 'Payload-Oxum: 4.2\n');
  const checked = await inspectBagItEntries(readBagItZip(zip));
  assert.equal(checked.review.state, 'valid'); assert.equal(checked.review.complete, true);
  assert.equal(checked.review.verifiedTagFiles, 4); assert.equal(checked.contents.size, 2);
  assert.deepEqual(checked.review.algorithms, [algorithm]);
});

test('independent bag with no tag manifest is valid, without claiming metadata checksums', async () => {
  const inspected = await inspectBagItEntries(fixture());
  assert.equal(inspected.review.state, 'valid'); assert.equal(inspected.review.verifiedTagFiles, 0);
  assert.equal(inspected.review.tagFiles, 2);
  assert.doesNotMatch(JSON.stringify(inspected.review), /source\.bin|original evidence/u);
});

test('creation and review detach Node buffers before asynchronous hashing', async () => {
  const source = Buffer.from([0, 128, 255, 10]);
  const creating = prepareBagItEntries(new Map([['data/source.bin', source]]));
  source.fill(7);
  const created = await creating;
  assert.deepEqual(created.get('data/source.bin'), new Uint8Array([0, 128, 255, 10]));
  const selected = new Map([...fixture()].map(([path, value]) => [path, Buffer.from(value)]));
  const reviewing = inspectBagItEntries(selected);
  for (const value of selected.values()) value.fill(0);
  const checked = await reviewing;
  assert.equal(checked.review.state, 'valid');
  assert.equal(text(checked.contents.get('artifact-1')!), 'original evidence\n');
});

test('empty data directory and empty manifest form a valid zero-payload bag', async () => {
  const files = new Map(await prepareBagItEntries(new Map()));
  assert.equal((await inspectBagItEntries(readBagItZip(encodeBagItEntries(files)))).review.state, 'valid');
  files.delete('data/'); await assert.rejects(inspectBagItEntries(files), /directory/u);
});

test('every payload and tag manifest is checked, including uppercase checksums and mixed line endings', async () => {
  const files = fixture(), payload = files.get('data/nested/source.bin')!;
  files.set('manifest-sha256.txt', bytes(`${hash(payload).toUpperCase()}\tdata/nested/source.bin\r`));
  files.set('manifest-sha512.txt', bytes(`${hash(payload, 'sha512')} data/nested/source.bin\r\n`));
  files.set('tagmanifest-sha256.txt', bytes(['manifest-sha256.txt', 'manifest-sha512.txt', 'bagit.txt'].map(path => `${hash(files.get(path)!)}  ${path}`).join('\n')));
  assert.equal((await inspectBagItEntries(files)).review.state, 'valid');
  files.set('bagit.txt', bytes('BagIt-Version: 1.0\r\nTag-File-Character-Encoding: UTF-8\r\n'));
  const mismatch = await inspectBagItEntries(files);
  assert.equal(mismatch.review.state, 'invalid'); assert.equal(mismatch.contents.size, 0);
});

test('missing payload and tag files remain incomplete; fetch requests are never made or reported', async () => {
  const files = fixture(); files.delete('data/nested/source.bin');
  files.set('fetch.txt', bytes('https://source.example.test/private?selected=1 - data/nested/source.bin\n'));
  const originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Network is forbidden'); };
  try {
    const result = await inspectBagItEntries(files);
    assert.equal(result.review.state, 'incomplete'); assert.equal(result.review.fetchMissing, 1);
    assert.equal(result.review.entries[0]?.state, 'missing'); assert.equal(result.contents.size, 0);
    assert.doesNotMatch(JSON.stringify(result.review), /https|private|source\.example/u); assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
  files.set('tagmanifest-sha256.txt', bytes(`${hash(files.get('manifest-sha256.txt')!)} manifest-sha256.txt\n${'0'.repeat(64)} missing.txt\n`));
  assert.equal((await inspectBagItEntries(files)).review.complete, false);
});

test('a fully present fetch declaration does not make an otherwise valid bag incomplete', async () => {
  const files = fixture(), size = files.get('data/nested/source.bin')!.byteLength;
  files.set('fetch.txt', bytes(`https://source.example.test/file ${size} data/nested/source.bin\n`));
  assert.equal((await inspectBagItEntries(files)).review.state, 'valid');
  files.set('fetch.txt', bytes('https://source.example.test/file 1 data/nested/source.bin\n'));
  assert.equal((await inspectBagItEntries(files)).review.state, 'invalid');
});

test('unknown checksum algorithms never inherit a successful supported check', async () => {
  const files = fixture(); files.set('manifest-md5.txt', bytes(`${'0'.repeat(32)} data/nested/source.bin\n`));
  const result = await inspectBagItEntries(files);
  assert.equal(result.review.state, 'unsupported'); assert.equal(result.review.checksumsVerified, false);
  assert.equal(result.review.unsupportedManifests, 1); assert.equal(result.contents.size, 0);
});

for (const mode of ['corrupt', 'unlisted', 'disagree', 'tag-coverage', 'oxum', 'fetch-membership'] as const) test(`BagIt rejects ${mode} without treating it as evidence absence`, async () => {
  const files = fixture();
  if (mode === 'corrupt') files.set('data/nested/source.bin', bytes('modified'));
  if (mode === 'unlisted') files.set('data/extra.bin', bytes('unlisted'));
  if (mode === 'disagree') files.set('manifest-sha512.txt', bytes(''));
  if (mode === 'tag-coverage') files.set('tagmanifest-sha256.txt', bytes(`${hash(files.get('bagit.txt')!)} bagit.txt\n`));
  if (mode === 'oxum') files.set('bag-info.txt', bytes('Payload-Oxum: 1.1\n'));
  if (mode === 'fetch-membership') files.set('fetch.txt', bytes('https://source.example.test/ - data/other.bin\n'));
  const result = await inspectBagItEntries(files);
  assert.equal(result.review.state, 'invalid'); assert.ok(result.review.issues.length); assert.equal(result.contents.size, 0);
});

for (const declaration of ['BagIt-Version: 2.0\nTag-File-Character-Encoding: UTF-8\n', 'BagIt-Version: 1.0\nTag-File-Character-Encoding: ISO-8859-1\n']) test(`unsupported declaration is explicit: ${declaration.split('\n')[0]}`, async () => {
  const files = fixture(); files.set('bagit.txt', bytes(declaration));
  await assert.rejects(inspectBagItEntries(files), UnsupportedBagItError);
});

for (const [name, value] of [
  ['bagit.txt', '\uFEFFBagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n'],
  ['manifest-sha256.txt', `${'0'.repeat(64)} data/a\n${'0'.repeat(64)} data/a\n`],
  ['manifest-sha256.txt', `${'0'.repeat(64)} data/%2Fhidden\n`],
  ['manifest-sha256.txt', `${'0'.repeat(64)} data/a%0Ab\n`],
  ['manifest-sha256.txt', `${'0'.repeat(64)} ../outside\n`],
  ['tagmanifest-sha256.txt', `${'0'.repeat(64)} tagmanifest-sha512.txt\n`],
  ['tagmanifest-sha256.txt', `${'0'.repeat(64)} data/nested/source.bin\n`],
  ['bag-info.txt', 'Payload-Oxum: 18.1\npayload-oxum: 18.1\n'],
  ['bag-info.txt', ' continuation\n'],
  ['fetch.txt', 'not-a-uri - data/nested/source.bin\n'],
  ['fetch.txt', 'https://source.example.test/ 9999999999999999 data/nested/source.bin\n'],
] as const) test(`malformed ${name} is refused (${value.slice(0, 18)})`, async () => {
  const files = fixture(); files.set(name, bytes(value)); await assert.rejects(inspectBagItEntries(files), TypeError);
});

test('ordinary folded and repeated metadata stays separate from the unique payload size declaration', async () => {
  const files = fixture(); files.set('bag-info.txt', bytes('Description: first\n continuation\nDescription: second\nCustom field: \nPayload-Oxum: 18.1\n'));
  assert.equal((await inspectBagItEntries(files)).review.state, 'valid');
});

test('file and directory paths reject traversal, device aliases, ambiguous spelling and prefix collisions', () => {
  for (const path of ['/absolute', '../a', 'data/../a', 'data\\a', 'data/con.txt', 'data/x:', 'data/a.', 'data/a ', 'data//a', 'data/\u0000', 'data/\ud800']) assert.throws(() => bagItPath(path), TypeError);
  for (const paths of [['data/A', 'data/a'], ['data/a', 'data/a/b'], ['data/a/b', 'data/a'], ['data/é/a', 'data/e\u0301/b'], ['data/A/x', 'data/a/y']]) assert.throws(() => assertBagItSelection(paths.map(path => ({ path, byteLength: 1 }))), TypeError);
  assert.throws(() => bagItPath(`${'a/'.repeat(MAX_BAGIT_DEPTH)}x`), /path/u);
  assert.throws(() => bagItPath('a'.repeat(MAX_BAGIT_PATH_BYTES + 1)), /path/u);
});

test('payload and tag admission accept exact boundaries and refuse overflow before file reads', () => {
  const payload = Array.from({ length: MAX_BAGIT_PAYLOAD_FILES }, (_, index) => ({ path: `data/f${index}`, byteLength: 0 }));
  assert.doesNotThrow(() => assertBagItSelection(payload));
  assert.throws(() => assertBagItSelection([...payload, { path: 'data/extra', byteLength: 1 }]), /limit/u);
  const remaining = MAX_BAGIT_PAYLOAD_BYTES - MAX_BAGIT_FILE_BYTES;
  assert.doesNotThrow(() => assertBagItSelection([{ path: 'data/a', byteLength: MAX_BAGIT_FILE_BYTES }, { path: 'data/b', byteLength: remaining }]));
  assert.throws(() => assertBagItSelection([{ path: 'data/a', byteLength: MAX_BAGIT_FILE_BYTES + 1 }]), /limit/u);
  assert.throws(() => assertBagItSelection([{ path: 'data/a', byteLength: MAX_BAGIT_FILE_BYTES }, { path: 'data/b', byteLength: remaining + 1 }]), /limit/u);
  assert.doesNotThrow(() => assertBagItSelection(Array.from({ length: MAX_BAGIT_TAG_FILES }, (_, index) => ({ path: `tag-${index}`, byteLength: 0 }))));
  assert.throws(() => assertBagItSelection(Array.from({ length: MAX_BAGIT_TAG_FILES + 1 }, (_, index) => ({ path: `tag-${index}`, byteLength: 0 }))), /limit/u);
  const tags = Array.from({ length: MAX_BAGIT_TOTAL_TAG_BYTES / MAX_BAGIT_TAG_BYTES }, (_, index) => ({ path: `tag-${index}`, byteLength: MAX_BAGIT_TAG_BYTES }));
  assert.doesNotThrow(() => assertBagItSelection(tags));
  assert.throws(() => assertBagItSelection([...tags, { path: 'extra', byteLength: 1 }]), /limit/u);
});

test('ZIP CRC, duplicate paths and compressed-size admission use the shared bounded extractor', async () => {
  const files = fixture(), zip = encodeBagItEntries(files);
  assert.equal((await inspectBagItEntries(readBagItZip(zip))).review.state, 'valid');
  const tampered = zip.slice(), marker = Buffer.from(tampered).indexOf('original evidence');
  assert.ok(marker >= 0); tampered[marker] = 0;
  assert.throws(() => readBagItZip(tampered), /CRC/u);
  assert.throws(() => readBagItZip(zipSync({ ...Object.fromEntries(files), 'data/NESTED/source.bin': bytes('other') })), /collid/u);
  assert.throws(() => readBagItZip(zipSync({ 'tag.txt': new Uint8Array(MAX_BAGIT_TAG_BYTES + 1) }, { level: 9 })), /limit/u);
});

test('selected evidence export retains the existing source manifest as a checksummed tag without paths', async () => {
  const built = await buildInvestigationBagIt({ workflow: 'Offline review', configurationDigestSha256: null, artifacts: [{ content: bytes('binary'), mediaType: 'application/octet-stream', source: { identity: 'Declared source', observedAt: null } }] }, '2026-09-13T00:00:00.000Z', '2.4.0');
  const files = readBagItZip(built.bytes), result = await inspectBagItEntries(files);
  assert.equal(result.review.state, 'valid'); assert.equal(result.review.verifiedTagFiles, 4);
  assert.deepEqual(files.get('data/artifact-1'), bytes('binary'));
  const source = JSON.parse(text(files.get('whoisleuth-manifest.json')!));
  assert.equal(source.artifacts[0].source.identity, 'Declared source');
  assert.equal(source.artifacts[0].contentDigestSha256, `sha256:${hash(bytes('binary'))}`);
});

test('ZIP symbolic links and special files cannot be certified as ordinary BagIt payloads', () => {
  for (const mode of [0xa000, 0x1000, 0xc000]) {
    const zip = encodeBagItEntries(fixture()), view = new DataView(zip.buffer);
    const central = Buffer.from(zip).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(central > 0);
    view.setUint16(central + 4, (3 << 8) | 20, true);
    view.setUint32(central + 38, ((mode | 0o600) << 16) >>> 0, true);
    assert.throws(() => readBagItZip(zip), /symbolic links or special files/u);
  }
});

test('the complete payload allowance survives ZIP construction, extraction and checksum verification', async () => {
  const first = new Uint8Array(MAX_BAGIT_FILE_BYTES), second = new Uint8Array(MAX_BAGIT_PAYLOAD_BYTES - MAX_BAGIT_FILE_BYTES);
  first[0] = 255; first[first.length - 1] = 127; second[0] = 128; second[second.length - 1] = 63;
  const payload = new Map([['data/a', first], ['data/b', second], ...Array.from({ length: MAX_BAGIT_PAYLOAD_FILES - 2 }, (_, index) => [`data/empty-${index}`, new Uint8Array()] as const)]);
  const built = await prepareBagItEntries(payload), encoded = encodeBagItEntries(built);
  assert.ok(encoded.byteLength > MAX_BAGIT_PAYLOAD_BYTES);
  const decoded = readBagItZip(encoded), result = await inspectBagItEntries(decoded);
  assert.equal(result.review.state, 'valid'); assert.equal(result.review.payloadBytes, MAX_BAGIT_PAYLOAD_BYTES);
  assert.equal(result.review.entries.length, MAX_BAGIT_PAYLOAD_FILES);
  assert.deepEqual(decoded.get('data/a'), first); assert.deepEqual(decoded.get('data/b'), second);
});

test('unique Unicode normalisation differences do not become missing files or duplicate payload identities', async () => {
  for (const [actual, declared] of [['data/é.bin', 'data/e\u0301.bin'], ['data/e\u0301.bin', 'data/é.bin']]) {
    const files = fixture(), payload = bytes('retained');
    files.delete('data/nested/source.bin'); files.set(actual!, payload);
    files.set('manifest-sha256.txt', bytes(`${hash(payload)} ${declared}\n`));
    assert.equal((await inspectBagItEntries(files)).review.state, 'valid');
    files.set('manifest-sha256.txt', bytes(`${hash(payload)} ${declared}\n${hash(payload)} ${actual}\n`));
    await assert.rejects(inspectBagItEntries(files), /duplicate/u);
  }
});

test('malformed fetch URIs do not receive a conforming BagIt result', async () => {
  for (const uri of ['https://files.example.test/#fragment', 'https://files.example.test/%GG', 'https://files.example.test/é', 'https://']) {
    const files = fixture(); files.set('fetch.txt', bytes(`${uri} - data/nested/source.bin\n`));
    await assert.rejects(inspectBagItEntries(files), /URI/u);
  }
});

test('a ZIP backed by shared mutable memory is refused before extraction', () => {
  const bytes = encodeBagItEntries(fixture()), shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
  assert.throws(() => readBagItZip(shared), /non-shared/u);
});
