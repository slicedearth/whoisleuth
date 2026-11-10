import { parseBoundedJsonObject } from '../analysis/bounded-json.mts';
import {
  MAX_RETAINED_SOURCE_EDITION_BYTES, RETAINED_SOURCE_EDITION_SCHEMA, RETAINED_SOURCE_EDITION_VERSION,
  RETAINED_SOURCE_IDS, type RetainedSourceId,
} from '../contracts/retained-source-edition.mts';
import { sha256ArtifactBytes } from './artifact-integrity.mts';

export const SOURCE_EDITION_DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function isRetainedSourceId(value: unknown): value is RetainedSourceId {
  return RETAINED_SOURCE_IDS.some(id => id === value);
}

async function digestSourceEdition(text: string): Promise<string> {
  if (!text.length || text.length > MAX_RETAINED_SOURCE_EDITION_BYTES) throw new TypeError('Source edition is empty or too large.');
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_RETAINED_SOURCE_EDITION_BYTES) throw new TypeError('Source edition is too large.');
  return sha256ArtifactBytes(bytes);
}

export async function encodeRetainedSourceEdition(source: RetainedSourceId, data: unknown) {
  const text = JSON.stringify({ schema: RETAINED_SOURCE_EDITION_SCHEMA, version: RETAINED_SOURCE_EDITION_VERSION, source, data }) + '\n';
  return Object.freeze({ text, digest: await digestSourceEdition(text) });
}

export async function decodeRetainedSourceEdition(text: string, expectedDigest: string, expectedSource?: RetainedSourceId) {
  if (!SOURCE_EDITION_DIGEST.test(expectedDigest) || await digestSourceEdition(text) !== expectedDigest) {
    throw new TypeError('Source edition does not match the expected SHA-256 digest.');
  }
  const edition = parseBoundedJsonObject(text, { maximumBytes: MAX_RETAINED_SOURCE_EDITION_BYTES, label: 'Source edition' });
  if (edition.schema !== RETAINED_SOURCE_EDITION_SCHEMA || edition.version !== RETAINED_SOURCE_EDITION_VERSION
    || !isRetainedSourceId(edition.source) || (expectedSource !== undefined && edition.source !== expectedSource)
    || Object.keys(edition).length !== 4 || !Object.hasOwn(edition, 'data')) {
    throw new TypeError('Source edition has an unsupported format or source identity.');
  }
  return Object.freeze({ source: edition.source, data: edition.data, digest: expectedDigest });
}
