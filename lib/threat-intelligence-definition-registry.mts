const PROVIDER_DEFINITIONS = new WeakSet<object>();
const CURATED_CONNECTOR_DEFINITIONS = new WeakSet<object>();

export function registerThreatIntelligenceProvider<T extends object>(
  definition: T,
): T {
  PROVIDER_DEFINITIONS.add(definition);
  return definition;
}

export function assertThreatIntelligenceProvider(
  provider: unknown,
): asserts provider is object {
  if (
    !provider ||
    typeof provider !== 'object' ||
    !PROVIDER_DEFINITIONS.has(provider)
  ) {
    throw new TypeError(
      'A versioned threat-intelligence provider definition is required',
    );
  }
}

export function isThreatIntelligenceProvider(provider: unknown): boolean {
  return Boolean(
    provider &&
      typeof provider === 'object' &&
      PROVIDER_DEFINITIONS.has(provider),
  );
}

export function registerCuratedConnector<T extends object>(
  definition: T,
): T {
  CURATED_CONNECTOR_DEFINITIONS.add(definition);
  return definition;
}

export function assertCuratedConnectorDefinition(
  connector: unknown,
): asserts connector is object {
  if (
    !connector ||
    typeof connector !== 'object' ||
    !CURATED_CONNECTOR_DEFINITIONS.has(connector)
  ) {
    throw new TypeError('A versioned curated connector definition is required');
  }
}

export function isCuratedConnectorDefinition(connector: unknown): boolean {
  return Boolean(
    connector &&
      typeof connector === 'object' &&
      CURATED_CONNECTOR_DEFINITIONS.has(connector),
  );
}
