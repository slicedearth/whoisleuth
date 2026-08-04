import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

import { createCase } from '../frontend/src/lib/analysis/case-model.ts';
import { buildCaseSightingStixExport } from '../frontend/src/lib/analysis/case-sighting-stix-export.ts';
import { buildStixIndicatorExport } from '../frontend/src/lib/analysis/stix-indicator-export.ts';

const SCHEMA_REVISION = 'c4f8d589acf2bdb3783655c89e0ffb6e150006ae';
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
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };

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

async function buildValidators(repositoryRoot = process.cwd()): Promise<Map<string, ValidateFunction>> {
  // The pinned schemas include a legacy escaped hyphen accepted by the
  // original validator but rejected under JavaScript's Unicode regexp mode.
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false, unicodeRegExp: false });
  for (const filename of await jsonFiles(resolve(repositoryRoot, SCHEMA_ROOT))) {
    const text = await readFile(filename, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_SCHEMA_BYTES) throw new RangeError(`${filename} exceeds the STIX schema byte limit.`);
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
  SCHEMA_REVISION,
  SCHEMA_ROOT,
  buildValidators,
  conformanceBundles,
  main,
  parseBundle,
  validateStixBundle,
};
