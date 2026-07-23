import { Buffer } from 'node:buffer';
import { CliUsageError } from './arguments.mts';

const DEFAULT_DISCOVERY_TLDS = Object.freeze(['com', 'net', 'org']);
const MAX_DISCOVERY_TLD_TEXT_LENGTH = 1024;
const MAX_DISCOVERY_TLD_TOKENS_INSPECTED = 80;
const MAX_DISCOVERY_DICTIONARY_BYTES = 4_096;

type DictionaryTextStream = {
  isTTY?: boolean;
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

async function readDiscoveryDictionaryBounded(
  stream: DictionaryTextStream | null | undefined,
  limit = MAX_DISCOVERY_DICTIONARY_BYTES,
): Promise<string> {
  if (!stream || stream.isTTY) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Discovery dictionary input is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeDiscoveryTlds(raw: unknown, maximum: unknown): string[] {
  if (!Number.isSafeInteger(maximum) || (maximum as number) < 1) {
    throw new TypeError('A valid discovery TLD limit is required.');
  }
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_DISCOVERY_TLD_TEXT_LENGTH) {
    throw new CliUsageError(`--tlds must contain at most ${MAX_DISCOVERY_TLD_TEXT_LENGTH} characters.`);
  }
  const tokens = raw.split(/[;,\s]+/).filter(Boolean);
  if (!tokens.length) throw new CliUsageError('--tlds did not contain any values.');
  if (tokens.length > MAX_DISCOVERY_TLD_TOKENS_INSPECTED) {
    throw new CliUsageError(`--tlds may inspect at most ${MAX_DISCOVERY_TLD_TOKENS_INSPECTED} values.`);
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const value = token.toLowerCase().replace(/^\./, '');
    if (!/^[a-z]{2,63}$/.test(value)) throw new CliUsageError(`Invalid TLD "${token}".`);
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length > (maximum as number)) {
      throw new CliUsageError(`At most ${maximum} unique TLDs are supported.`);
    }
  }
  return values;
}

export {
  DEFAULT_DISCOVERY_TLDS,
  MAX_DISCOVERY_DICTIONARY_BYTES,
  MAX_DISCOVERY_TLD_TEXT_LENGTH,
  MAX_DISCOVERY_TLD_TOKENS_INSPECTED,
  normalizeDiscoveryTlds,
  readDiscoveryDictionaryBounded,
};
