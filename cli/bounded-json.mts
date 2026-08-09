import { Buffer } from 'node:buffer';

export const MAX_BOUNDED_JSON_DEPTH = 48;
export const MAX_BOUNDED_JSON_KEYS = 50_000;
export const MAX_BOUNDED_JSON_VALUES = 100_000;

type UnknownRecord = Record<string, unknown>;

function syntaxError(): never {
  throw new TypeError('Artefact input is not valid JSON.');
}

export function scanBoundedJson(raw: string): void {
  let index = 0;
  let keys = 0;
  let values = 0;

  const whitespace = () => {
    while (index < raw.length && /[\t\n\r ]/u.test(raw[index]!)) index += 1;
  };
  const stringToken = (): string => {
    const start = index;
    index += 1;
    while (index < raw.length) {
      const character = raw[index]!;
      if (character === '"') {
        index += 1;
        try { return JSON.parse(raw.slice(start, index)) as string; } catch { syntaxError(); }
      }
      if (character === '\\') {
        index += 1;
        if (index >= raw.length) syntaxError();
        if (raw[index] === 'u') {
          if (!/^[a-fA-F0-9]{4}$/u.test(raw.slice(index + 1, index + 5))) syntaxError();
          index += 5;
        } else {
          if (!/["\\/bfnrt]/u.test(raw[index]!)) syntaxError();
          index += 1;
        }
        continue;
      }
      if (character.charCodeAt(0) <= 0x1f) syntaxError();
      index += 1;
    }
    return syntaxError();
  };
  const literal = (token: string) => {
    if (raw.slice(index, index + token.length) !== token) syntaxError();
    index += token.length;
  };
  const number = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(raw.slice(index));
    if (!match) syntaxError();
    index += match[0].length;
  };
  const value = (depth: number): void => {
    values += 1;
    if (values > MAX_BOUNDED_JSON_VALUES) {
      throw new TypeError(`Artefact JSON exceeds the ${MAX_BOUNDED_JSON_VALUES}-value limit.`);
    }
    if (depth > MAX_BOUNDED_JSON_DEPTH) {
      throw new TypeError(`Artefact JSON exceeds the ${MAX_BOUNDED_JSON_DEPTH}-level nesting limit.`);
    }
    whitespace();
    const character = raw[index];
    if (character === '"') { stringToken(); return; }
    if (character === '{') {
      index += 1;
      whitespace();
      const seen = new Set<string>();
      if (raw[index] === '}') { index += 1; return; }
      while (index < raw.length) {
        if (raw[index] !== '"') syntaxError();
        const key = stringToken();
        keys += 1;
        if (keys > MAX_BOUNDED_JSON_KEYS) {
          throw new TypeError(`Artefact JSON exceeds the ${MAX_BOUNDED_JSON_KEYS}-key limit.`);
        }
        if (seen.has(key)) throw new TypeError('Artefact JSON contains a duplicate object key.');
        seen.add(key);
        whitespace();
        if (raw[index] !== ':') syntaxError();
        index += 1;
        value(depth + 1);
        whitespace();
        if (raw[index] === '}') { index += 1; return; }
        if (raw[index] !== ',') syntaxError();
        index += 1;
        whitespace();
      }
      syntaxError();
    }
    if (character === '[') {
      index += 1;
      whitespace();
      if (raw[index] === ']') { index += 1; return; }
      while (index < raw.length) {
        value(depth + 1);
        whitespace();
        if (raw[index] === ']') { index += 1; return; }
        if (raw[index] !== ',') syntaxError();
        index += 1;
        whitespace();
      }
      syntaxError();
    }
    if (character === 't') { literal('true'); return; }
    if (character === 'f') { literal('false'); return; }
    if (character === 'n') { literal('null'); return; }
    number();
  };

  whitespace();
  value(0);
  whitespace();
  if (index !== raw.length) syntaxError();
}

export function parseBoundedJsonObject(
  raw: string,
  options: Readonly<{ label?: string; maximumBytes: number }>,
): UnknownRecord {
  const label = options.label ?? 'Artefact input';
  if (typeof raw !== 'string') throw new TypeError(`${label} must be UTF-8 JSON text.`);
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes < 1 || bytes > options.maximumBytes) {
    throw new TypeError(`${label} must be between 1 byte and ${options.maximumBytes} bytes.`);
  }
  scanBoundedJson(raw);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { syntaxError(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${label} must contain one JSON object.`);
  }
  return parsed as UnknownRecord;
}
