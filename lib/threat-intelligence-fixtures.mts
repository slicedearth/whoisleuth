import {
  assertCuratedConnectorDefinition,
  createCuratedConnectorResult,
  normalizeCuratedConnectorTarget,
} from './threat-intelligence-runtime.mts';
import type {
  CuratedConnectorDefinition,
  CuratedConnectorResult,
  CuratedConnectorTarget,
} from './threat-intelligence-runtime.mts';

const MAX_CONNECTOR_KEY_LENGTH = 80;
const MAX_CONNECTOR_FIXTURE_BYTES = 512 * 1024;

type CuratedConnectorFixture = Readonly<{
  id: string;
  target: unknown;
  observedAt: string;
  json: string;
}>;

type CuratedConnectorFixtureNormalizer = (
  payload: unknown,
  target: CuratedConnectorTarget,
) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactFixtureKeys(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError('Connector fixture must be an object');
  const allowed = new Set(['id', 'target', 'observedAt', 'json']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Connector fixture has unknown field: ${key}`);
    }
  }
}

function fixtureId(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_CONNECTOR_KEY_LENGTH ||
    !/^[a-z0-9][a-z0-9._-]*$/iu.test(value)
  ) {
    return null;
  }
  return value;
}

function fixtureTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 50) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function runCuratedConnectorFixture(
  connector: CuratedConnectorDefinition,
  fixture: unknown,
  normalizeFixture: CuratedConnectorFixtureNormalizer,
): CuratedConnectorResult {
  assertCuratedConnectorDefinition(connector);
  exactFixtureKeys(fixture);

  const id = fixtureId(fixture.id);
  const observedAt = fixtureTimestamp(fixture.observedAt);
  if (!id || !observedAt) {
    throw new TypeError('Connector fixture identity or timestamp is invalid');
  }
  if (
    typeof fixture.json !== 'string' ||
    Buffer.byteLength(fixture.json, 'utf8') > MAX_CONNECTOR_FIXTURE_BYTES
  ) {
    throw new TypeError(
      `Connector fixture JSON must not exceed ${MAX_CONNECTOR_FIXTURE_BYTES} bytes`,
    );
  }
  if (typeof normalizeFixture !== 'function') {
    throw new TypeError('Connector fixture requires a synchronous normalizer');
  }

  let firstPayload: unknown;
  let secondPayload: unknown;
  try {
    firstPayload = JSON.parse(fixture.json);
    secondPayload = JSON.parse(fixture.json);
  } catch {
    throw new TypeError('Connector fixture JSON is invalid');
  }

  const targetType =
    isRecord(fixture.target) && typeof fixture.target.type === 'string'
      ? fixture.target.type
      : null;
  const declaration = targetType
    ? connector.inputs.find((item) => item.type === targetType)
    : null;
  if (!declaration) {
    throw new TypeError('Connector fixture target is unsupported');
  }
  const normalizedTarget = normalizeCuratedConnectorTarget(
    fixture.target,
    declaration.exposure,
  );

  const normalizeOnce = (payload: unknown): CuratedConnectorResult => {
    const output = normalizeFixture(
      payload,
      Object.freeze({ ...normalizedTarget }),
    );
    if (
      output &&
      (typeof output === 'object' || typeof output === 'function') &&
      typeof (output as { then?: unknown }).then === 'function'
    ) {
      throw new TypeError('Connector fixture normalizers must be synchronous');
    }
    return createCuratedConnectorResult(
      connector,
      fixture.target,
      output,
      observedAt,
    );
  };

  const first = normalizeOnce(firstPayload);
  const second = normalizeOnce(secondPayload);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new TypeError(`Connector fixture ${id} is not deterministic`);
  }
  return first;
}

export { MAX_CONNECTOR_FIXTURE_BYTES };
export type {
  CuratedConnectorFixture,
  CuratedConnectorFixtureNormalizer,
};
