import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_BOUNDED_JSON_DEPTH,
  MAX_BOUNDED_JSON_CONTAINER_ITEMS,
  MAX_BOUNDED_JSON_KEYS,
  MAX_BOUNDED_JSON_VALUES,
  assertBoundedJsonStructure,
  parseBoundedJson,
  parseBoundedJsonObject,
  scanBoundedJson,
} from '../lib/bounded-json.mts';

function nested(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
}

function partitionedValues(totalLeaves: number, width = MAX_BOUNDED_JSON_CONTAINER_ITEMS): unknown[] {
  const groups: unknown[] = [];
  let remaining = totalLeaves;
  while (remaining > 0) {
    const count = Math.min(width, remaining);
    groups.push(Array.from({ length: count }, () => null));
    remaining -= count;
  }
  return groups;
}

function partitionedKeys(total: number, width = MAX_BOUNDED_JSON_CONTAINER_ITEMS): Record<string, unknown> {
  const groups: Record<string, unknown> = {};
  let remaining = total;
  let group = 0;
  while (remaining > 0) {
    const count = Math.min(width, remaining);
    groups[`group${group}`] = Object.fromEntries(Array.from({ length: count }, (_, index) => [`key${group}-${index}`, null]));
    remaining -= count;
    group += 1;
  }
  return groups;
}

describe('bounded parsed JSON structure', () => {
  test('accepts exact global depth, key, and value limits', () => {
    assert.doesNotThrow(() => assertBoundedJsonStructure(nested(MAX_BOUNDED_JSON_DEPTH)));
    assert.doesNotThrow(() => assertBoundedJsonStructure(
      partitionedKeys(MAX_BOUNDED_JSON_KEYS - 5),
    ));
    assert.doesNotThrow(() => assertBoundedJsonStructure(
      partitionedValues(MAX_BOUNDED_JSON_VALUES - 11),
    ));
  });

  test('rejects structures beyond each global budget with stable typed errors', () => {
    assert.throws(
      () => assertBoundedJsonStructure(nested(MAX_BOUNDED_JSON_DEPTH + 1), 'Fixture JSON'),
      /Fixture JSON exceeds the 48-level nesting limit/u,
    );
    assert.throws(
      () => assertBoundedJsonStructure(
        partitionedKeys(MAX_BOUNDED_JSON_KEYS),
        'Fixture JSON',
      ),
      /Fixture JSON exceeds the 50000-key limit/u,
    );
    assert.throws(
      () => assertBoundedJsonStructure(partitionedValues(MAX_BOUNDED_JSON_VALUES), 'Fixture JSON'),
      /Fixture JSON exceeds the 100000-value limit/u,
    );
  });

  test('rejects cycles and non-JSON scalar values without recursing indefinitely', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => assertBoundedJsonStructure(cyclic), /cyclic object reference/u);
    assert.throws(() => assertBoundedJsonStructure(Number.NaN), /non-JSON number/u);
    assert.throws(() => assertBoundedJsonStructure(undefined), /non-JSON value/u);
  });

  test('rejects prototype-sensitive keys before or after JSON parsing', () => {
    for (const key of ['__proto__']) {
      const raw = `{"nested":{"${key}":{"domain":"forged.example.test"}}}`;
      assert.throws(() => scanBoundedJson(raw), /unsafe object key/u, key);
      assert.throws(() => assertBoundedJsonStructure(JSON.parse(raw)), /unsafe object key/u, key);
    }
    for (const key of ['constructor', 'prototype']) {
      const raw = `{"nested":{"${key}":"ordinary additive value"}}`;
      assert.doesNotThrow(() => scanBoundedJson(raw), key);
      assert.doesNotThrow(() => assertBoundedJsonStructure(JSON.parse(raw)), key);
    }
  });

  test('rejects non-finite numeric tokens while retaining the largest finite exponent', () => {
    assert.throws(() => scanBoundedJson('{"value":1e400}'), /contains a non-finite number/u);
    assert.throws(() => scanBoundedJson('{"value":-1e400}'), /contains a non-finite number/u);
    assert.doesNotThrow(() => scanBoundedJson('{"value":1.7976931348623157e308}'));
    assert.throws(
      () => parseBoundedJsonObject('{"value":1e400}', { maximumBytes: 64 }),
      /contains a non-finite number/u,
    );
  });

  test('parses any bounded JSON value without collapsing duplicate keys', () => {
    assert.deepEqual(parseBoundedJson('[true, null]', { maximumBytes: 64 }), [true, null]);
    assert.throws(
      () => parseBoundedJson('{"mode":"safe","mode":"unsafe"}', { maximumBytes: 64 }),
      /duplicate object key/u,
    );
    assert.throws(
      () => parseBoundedJson('[]', { maximumBytes: 1 }),
      /between 1 byte and 1 bytes/u,
    );
  });

  test('supports explicit wrapper budgets without changing the shared defaults', () => {
    assert.doesNotThrow(() => scanBoundedJson('{"wrapped":{"value":true}}', {
      maximumDepth: 2,
      maximumKeys: 3,
      maximumValues: 3,
    }));
    assert.throws(
      () => scanBoundedJson('{"wrapped":{"value":true}}', { maximumDepth: 1 }),
      /1-level nesting limit/u,
    );
  });

  test('rejects over-bound arrays and objects before traversing their values', () => {
    const array = Array.from({ length: MAX_BOUNDED_JSON_CONTAINER_ITEMS + 1 }, () => null);
    const object = Object.fromEntries(array.map((_, index) => [`key${index}`, null]));
    assert.throws(() => scanBoundedJson(JSON.stringify(array)), /container with more than 10000 items/u);
    assert.throws(() => assertBoundedJsonStructure(array), /container with more than 10000 items/u);
    assert.throws(() => scanBoundedJson(JSON.stringify(object)), /container with more than 10000 items/u);
    assert.throws(() => assertBoundedJsonStructure(object), /container with more than 10000 items/u);
    assert.doesNotThrow(() => scanBoundedJson(JSON.stringify(array.slice(0, -1))));
  });
});
