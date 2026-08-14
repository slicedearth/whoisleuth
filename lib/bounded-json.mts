export const MAX_BOUNDED_JSON_DEPTH = 48;
export const MAX_BOUNDED_JSON_KEYS = 50_000;
export const MAX_BOUNDED_JSON_VALUES = 100_000;
export const MAX_BOUNDED_JSON_CONTAINER_ITEMS = 10_000;
export const UNSAFE_JSON_OBJECT_KEYS = Object.freeze(['__proto__']);

type UnknownRecord = Record<string, unknown>;
type BoundedJsonLimits = Readonly<{
  maximumDepth?: number;
  maximumKeys?: number;
  maximumValues?: number;
  maximumContainerItems?: number;
}>;

type BoundedJsonParseOptions = Readonly<{
  label?: string;
  maximumBytes: number;
  limits?: BoundedJsonLimits;
}>;

function syntaxError(): never {
  throw new TypeError('Artefact input is not valid JSON.');
}

export function isSafeJsonObjectKey(value: string): boolean {
  return !UNSAFE_JSON_OBJECT_KEYS.includes(value);
}

export function assertBoundedJsonStructure(
  value: unknown,
  label = 'JSON value',
  limits: BoundedJsonLimits = {},
): void {
  const maximumDepth = limits.maximumDepth ?? MAX_BOUNDED_JSON_DEPTH;
  const maximumKeys = limits.maximumKeys ?? MAX_BOUNDED_JSON_KEYS;
  const maximumValues = limits.maximumValues ?? MAX_BOUNDED_JSON_VALUES;
  const maximumContainerItems = limits.maximumContainerItems ?? MAX_BOUNDED_JSON_CONTAINER_ITEMS;
  let keys = 0;
  let values = 0;
  const ancestors = new Set<object>();

  const visit = (current: unknown, depth: number): void => {
    values += 1;
    if (values > maximumValues) {
      throw new TypeError(`${label} exceeds the ${maximumValues}-value limit.`);
    }
    if (depth > maximumDepth) {
      throw new TypeError(`${label} exceeds the ${maximumDepth}-level nesting limit.`);
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError(`${label} contains a non-JSON number.`);
      return;
    }
    if (typeof current !== 'object') throw new TypeError(`${label} contains a non-JSON value.`);
    if (ancestors.has(current)) throw new TypeError(`${label} contains a cyclic object reference.`);

    ancestors.add(current);
    if (Array.isArray(current)) {
      if (current.length > maximumContainerItems) {
        throw new TypeError(`${label} contains a container with more than ${maximumContainerItems} items.`);
      }
      for (const item of current) visit(item, depth + 1);
    } else {
      const entries = Object.entries(current as UnknownRecord);
      if (entries.length > maximumContainerItems) {
        throw new TypeError(`${label} contains a container with more than ${maximumContainerItems} items.`);
      }
      keys += entries.length;
      if (keys > maximumKeys) {
        throw new TypeError(`${label} exceeds the ${maximumKeys}-key limit.`);
      }
      for (const [key, item] of entries) {
        if (!isSafeJsonObjectKey(key)) throw new TypeError(`${label} contains an unsafe object key.`);
        visit(item, depth + 1);
      }
    }
    ancestors.delete(current);
  };

  visit(value, 0);
}

export function scanBoundedJson(raw: string, limits: BoundedJsonLimits = {}): void {
  const maximumDepth = limits.maximumDepth ?? MAX_BOUNDED_JSON_DEPTH;
  const maximumKeys = limits.maximumKeys ?? MAX_BOUNDED_JSON_KEYS;
  const maximumValues = limits.maximumValues ?? MAX_BOUNDED_JSON_VALUES;
  const maximumContainerItems = limits.maximumContainerItems ?? MAX_BOUNDED_JSON_CONTAINER_ITEMS;
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
    if (!Number.isFinite(Number(match[0]))) {
      throw new TypeError('Artefact JSON contains a non-finite number.');
    }
    index += match[0].length;
  };
  const value = (depth: number): void => {
    values += 1;
    if (values > maximumValues) {
      throw new TypeError(`Artefact JSON exceeds the ${maximumValues}-value limit.`);
    }
    if (depth > maximumDepth) {
      throw new TypeError(`Artefact JSON exceeds the ${maximumDepth}-level nesting limit.`);
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
        if (seen.size >= maximumContainerItems) {
          throw new TypeError(`Artefact JSON contains a container with more than ${maximumContainerItems} items.`);
        }
        keys += 1;
        if (keys > maximumKeys) {
          throw new TypeError(`Artefact JSON exceeds the ${maximumKeys}-key limit.`);
        }
        if (seen.has(key)) throw new TypeError('Artefact JSON contains a duplicate object key.');
        if (!isSafeJsonObjectKey(key)) throw new TypeError('Artefact JSON contains an unsafe object key.');
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
      let items = 0;
      while (index < raw.length) {
        items += 1;
        if (items > maximumContainerItems) {
          throw new TypeError(`Artefact JSON contains a container with more than ${maximumContainerItems} items.`);
        }
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

export type { BoundedJsonLimits, BoundedJsonParseOptions };

export function parseBoundedJson(
  raw: string,
  options: BoundedJsonParseOptions,
): unknown {
  const label = options.label ?? 'Artefact input';
  if (typeof raw !== 'string') throw new TypeError(`${label} must be UTF-8 JSON text.`);
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes < 1 || bytes > options.maximumBytes) {
    throw new TypeError(`${label} must be between 1 byte and ${options.maximumBytes} bytes.`);
  }
  scanBoundedJson(raw, options.limits);
  try { return JSON.parse(raw) as unknown; } catch { return syntaxError(); }
}

export function parseBoundedJsonObject(
  raw: string,
  options: BoundedJsonParseOptions,
): UnknownRecord {
  const label = options.label ?? 'Artefact input';
  const parsed = parseBoundedJson(raw, options);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${label} must contain one JSON object.`);
  }
  return parsed as UnknownRecord;
}
