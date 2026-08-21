import { createHash } from 'node:crypto';
import { open, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

import { createCase } from '../packages/cases/case-model.mts';
import { buildCaseSightingStixExport } from '../packages/interchange/case-sighting-stix-export.mts';
import { buildStixIndicatorExport } from '../packages/interchange/stix-indicator-export.mts';

const SCHEMA_REVISION = 'c4f8d589acf2bdb3783655c89e0ffb6e150006ae';
const SCHEMA_TREE_SHA256 = 'fe3b1997ce3ca562aa1ea60298dcc0d126448a9c295d76b8bbe0b81631d4747b';
const VENDOR_ROOT = 'fixtures/stix/oasis-stix-2.1-json-schemas';
const SCHEMA_ROOT = 'fixtures/stix/oasis-stix-2.1-json-schemas/schemas';
const BUNDLE_SCHEMA_ID = 'http://raw.githubusercontent.com/oasis-open/cti-stix2-json-schemas/stix2.1/schemas/common/bundle.json';
const OBJECT_SCHEMA_IDS = Object.freeze({
  identity: 'http://raw.githubusercontent.com/oasis-open/cti-stix2-json-schemas/stix2.1/schemas/sdos/identity.json',
  indicator: 'http://raw.githubusercontent.com/oasis-open/cti-stix2-json-schemas/stix2.1/schemas/sdos/indicator.json',
  'observed-data': 'http://raw.githubusercontent.com/oasis-open/cti-stix2-json-schemas/stix2.1/schemas/sdos/observed-data.json',
  note: 'http://raw.githubusercontent.com/oasis-open/cti-stix2-json-schemas/stix2.1/schemas/sdos/note.json',
  'domain-name': 'http://raw.githubusercontent.com/oasis-open/cti-stix2-json-schemas/stix2.1/schemas/observables/domain-name.json',
  relationship: 'http://raw.githubusercontent.com/oasis-open/cti-stix2-json-schemas/stix2.1/schemas/sros/relationship.json',
});
const MAX_SCHEMA_FILES = 100;
const MAX_VENDOR_FILES = 110;
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_VENDOR_TREE_BYTES = 2 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };

async function readBoundedRegularFile(filename: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(filename, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new TypeError(`${filename} is not a regular STIX schema file.`);
    if (metadata.size > maximumBytes) throw new RangeError(`${filename} exceeds the STIX schema byte limit.`);
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, total, buffer.byteLength - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maximumBytes) throw new RangeError(`${filename} exceeds the STIX schema byte limit.`);
    return Buffer.from(buffer.subarray(0, total));
  } finally {
    await handle.close();
  }
}

async function jsonFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && entry.name.endsWith('.json')) output.push(filename);
      if (output.length > MAX_SCHEMA_FILES) throw new RangeError('The pinned STIX schema set exceeds its file limit.');
    }
  }
  await visit(root);
  return output.sort();
}

async function vendorFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile()) output.push(filename);
      else throw new TypeError('The pinned STIX schema tree contains an unsupported filesystem entry.');
      if (output.length > MAX_VENDOR_FILES) throw new RangeError('The pinned STIX schema tree exceeds its file limit.');
    }
  }
  await visit(root);
  return output.sort();
}

async function schemaTreeSha256(repositoryRoot = process.cwd()): Promise<string> {
  const vendorRoot = resolve(repositoryRoot, VENDOR_ROOT);
  const hash = createHash('sha256');
  let aggregateBytes = 0;
  for (const filename of await vendorFiles(vendorRoot)) {
    const pathname = relative(vendorRoot, filename).split(sep).join('/');
    const pathnameBytes = Buffer.from(pathname, 'utf8');
    const content = await readBoundedRegularFile(filename, MAX_SCHEMA_BYTES);
    aggregateBytes += content.byteLength;
    if (aggregateBytes > MAX_VENDOR_TREE_BYTES) throw new RangeError('The pinned STIX schema tree exceeds its aggregate byte limit.');
    const lengths = Buffer.allocUnsafe(8);
    lengths.writeUInt32BE(pathnameBytes.byteLength, 0);
    lengths.writeUInt32BE(content.byteLength, 4);
    hash.update(lengths).update(pathnameBytes).update(content);
  }
  return hash.digest('hex');
}

async function assertPinnedSchemaTree(repositoryRoot = process.cwd()): Promise<void> {
  if (await schemaTreeSha256(repositoryRoot) !== SCHEMA_TREE_SHA256) {
    throw new Error(`The vendored STIX schema tree does not match reviewed revision ${SCHEMA_REVISION}.`);
  }
}

async function buildValidators(repositoryRoot = process.cwd()): Promise<Map<string, ValidateFunction>> {
  await assertPinnedSchemaTree(repositoryRoot);
  // The pinned schemas include a legacy escaped hyphen accepted by the
  // original validator but rejected under JavaScript's Unicode regexp mode.
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false, unicodeRegExp: false });
  for (const filename of await jsonFiles(resolve(repositoryRoot, SCHEMA_ROOT))) {
    const text = (await readBoundedRegularFile(filename, MAX_SCHEMA_BYTES)).toString('utf8');
    ajv.addSchema(JSON.parse(text));
  }
  const validators = new Map<string, ValidateFunction>();
  for (const [type, schemaId] of Object.entries(OBJECT_SCHEMA_IDS)) {
    const validator = ajv.getSchema(schemaId);
    if (!validator) throw new Error(`The pinned STIX ${type} schema was not loaded.`);
    validators.set(type, validator);
  }
  return validators;
}

function parseBundle(content: string): UnknownRecord {
  if (Buffer.byteLength(content, 'utf8') > MAX_BUNDLE_BYTES) throw new RangeError('The STIX bundle exceeds the conformance byte limit.');
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('The STIX bundle must be an object.');
  return value as UnknownRecord;
}

function errorSummary(validator: ValidateFunction): string {
  return (validator.errors ?? []).slice(0, 20).map((error) => `${error.instancePath || '/'} ${error.message || 'is invalid'}`).join('; ');
}

async function validateStixBundle(content: string, repositoryRoot = process.cwd()): Promise<void> {
  const bundle = parseBundle(content);
  if (bundle.type !== 'bundle' || typeof bundle.id !== 'string' || !bundle.id.startsWith('bundle--') || !Array.isArray(bundle.objects)) {
    throw new Error('STIX 2.1 schema validation failed: invalid bundle envelope.');
  }
  const validators = await buildValidators(repositoryRoot);
  for (const [index, value] of bundle.objects.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`STIX 2.1 schema validation failed: /objects/${index} must be an object.`);
    const object = value as UnknownRecord;
    const validator = typeof object.type === 'string' ? validators.get(object.type) : undefined;
    if (!validator) throw new Error(`STIX 2.1 schema validation failed: /objects/${index}/type is unsupported by this export gate.`);
    if (!validator(object)) throw new Error(`STIX 2.1 schema validation failed at /objects/${index}: ${errorSummary(validator)}`);
  }
}

function idFactory() {
  let counter = 0;
  return (type: string) => `${type}--00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}

function conformanceBundles(): string[] {
  const generatedAt = '2026-08-01T00:00:00.000Z';
  const indicators = buildStixIndicatorExport([{
    domain: 'candidate.example', availability: 'registered', risk: 80, status: 'complete',
    saved: { scanDepth: 'deep', riskModelVersion: 7, observedAt: generatedAt },
  }], { generatedAt, idFactory: idFactory() }).content;
  const caseRecord = createCase({
    domain: 'candidate.example',
    sighting: {
      state: 'observed_by_deployment', category: 'website', source: 'Deep lookup',
      observedAt: generatedAt, completeness: 'partial', limitations: ['Static fixture.'],
    },
  }, generatedAt);
  const sightings = buildCaseSightingStixExport(caseRecord, { generatedAt, idFactory: idFactory() }).content;
  return [indicators, sightings];
}

async function main(options: { repositoryRoot?: string; stdout?: WritableLike; stderr?: WritableLike } = {}): Promise<number> {
  const repositoryRoot = resolve(options.repositoryRoot || process.cwd());
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    for (const content of conformanceBundles()) await validateStixBundle(content, repositoryRoot);
    stdout.write(`STIX 2.1 schema conformance: pass (2 bundles; schemas ${SCHEMA_REVISION.slice(0, 12)})\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'STIX conformance validation failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();

export {
  BUNDLE_SCHEMA_ID,
  MAX_BUNDLE_BYTES,
  MAX_SCHEMA_BYTES,
  MAX_VENDOR_TREE_BYTES,
  SCHEMA_REVISION,
  SCHEMA_TREE_SHA256,
  SCHEMA_ROOT,
  buildValidators,
  conformanceBundles,
  main,
  parseBundle,
  schemaTreeSha256,
  validateStixBundle,
};
