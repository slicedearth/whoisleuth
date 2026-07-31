// Canonical, exposure-aware target normalization shared by provider results
// and curated connectors. These helpers never perform network requests.

import { classifyQuery } from './classify.mts';
import {
  enumValue,
  exactKeys,
  strictBoundedString,
} from './bounded-contract-normalizers.mts';
import type {
  CuratedConnectorEntityType,
  CuratedConnectorTarget,
  CuratedConnectorTargetExposure,
  ThreatIntelligenceTarget,
  ThreatIntelligenceTargetExposure,
  ThreatIntelligenceTargetType,
} from './threat-intelligence-types.mts';

export const MAX_THREAT_INTELLIGENCE_URL_LENGTH = 2048;

const TARGET_EXPOSURES: Readonly<
  Record<
    ThreatIntelligenceTargetType,
    ReadonlySet<ThreatIntelligenceTargetExposure>
  >
> = Object.freeze({
  domain: new Set<ThreatIntelligenceTargetExposure>(['registrable_domain']),
  url: new Set<ThreatIntelligenceTargetExposure>([
    'registrable_domain',
    'hostname',
    'origin',
    'full_url',
  ]),
});

export const CURATED_CONNECTOR_ENTITY_TYPES =
  new Set<CuratedConnectorEntityType>([
    'domain',
    'hostname',
    'url',
    'ipv4',
    'ipv6',
    'asn',
    'certificate',
  ]);

const CONNECTOR_TARGET_EXPOSURES: Readonly<
  Record<
    CuratedConnectorEntityType,
    ReadonlySet<CuratedConnectorTargetExposure>
  >
> = Object.freeze({
  domain: new Set<CuratedConnectorTargetExposure>(['registrable_domain']),
  hostname: new Set<CuratedConnectorTargetExposure>(['hostname']),
  url: new Set<CuratedConnectorTargetExposure>([
    'registrable_domain',
    'hostname',
    'origin',
    'full_url',
  ]),
  ipv4: new Set<CuratedConnectorTargetExposure>(['ip_address']),
  ipv6: new Set<CuratedConnectorTargetExposure>(['ip_address']),
  asn: new Set<CuratedConnectorTargetExposure>(['asn']),
  certificate: new Set<CuratedConnectorTargetExposure>([
    'certificate_fingerprint',
  ]),
});

function normalizeCertificateFingerprint(value: unknown): string | null {
  const raw = strictBoundedString(value, 128);
  if (!raw || !/^[0-9a-f:]+$/iu.test(raw)) return null;
  const canonical = raw.replace(/:/gu, '').toLowerCase();
  return /^[0-9a-f]{64}$/u.test(canonical) ? canonical : null;
}

export function normalizeThreatIntelligenceTarget(
  input: unknown,
  exposure: unknown,
): ThreatIntelligenceTarget {
  exactKeys(
    input,
    new Set(['type', 'value']),
    'Threat-intelligence target',
  );
  const type = input.type;
  if (
    (type !== 'domain' && type !== 'url')
    || typeof exposure !== 'string'
    || !TARGET_EXPOSURES[type].has(
      exposure as ThreatIntelligenceTargetExposure,
    )
  ) {
    throw new TypeError('Threat-intelligence target exposure is invalid');
  }
  if (type === 'domain') {
    const classified = classifyQuery(String(input.value ?? ''));
    if (classified.type !== 'domain') {
      throw new TypeError('Threat-intelligence domain target is invalid');
    }
    return Object.freeze({
      type: 'domain',
      value: classified.registrableDomain,
      exposure: exposure as ThreatIntelligenceTargetExposure,
    });
  }

  const raw = strictBoundedString(
    input.value,
    MAX_THREAT_INTELLIGENCE_URL_LENGTH,
  );
  let parsed: URL | null;
  try {
    parsed = raw ? new URL(raw) : null;
  } catch {
    parsed = null;
  }
  if (
    !parsed
    || !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
  ) {
    throw new TypeError('Threat-intelligence URL target is invalid');
  }
  const classified = classifyQuery(parsed.hostname);
  if (classified.type !== 'domain') {
    throw new TypeError(
      'Threat-intelligence URL target must use a registrable domain',
    );
  }
  const registrableDomain =
    classified.registrableDomain || classified.value;
  const inputHostname =
    classified.inputHostname || parsed.hostname.toLowerCase();
  parsed.hash = '';
  let value = parsed.toString();
  if (exposure === 'registrable_domain') value = registrableDomain;
  else if (exposure === 'hostname') value = inputHostname;
  else if (exposure === 'origin') value = parsed.origin;
  if (value.length > MAX_THREAT_INTELLIGENCE_URL_LENGTH) {
    throw new TypeError(
      'Threat-intelligence URL target exceeds the canonical length limit',
    );
  }
  return Object.freeze({
    type: 'url',
    value,
    exposure: exposure as ThreatIntelligenceTargetExposure,
  });
}

export function normalizeCuratedConnectorTarget(
  input: unknown,
  exposure: unknown,
): CuratedConnectorTarget {
  exactKeys(input, new Set(['type', 'value']), 'Connector target');
  const type = enumValue(
    input.type,
    CURATED_CONNECTOR_ENTITY_TYPES,
    'Connector target type',
  );
  const normalizedExposure = enumValue(
    exposure,
    CONNECTOR_TARGET_EXPOSURES[type],
    'Connector target exposure',
  );

  if (type === 'url') {
    const normalized = normalizeThreatIntelligenceTarget(
      { type: 'url', value: input.value },
      normalizedExposure,
    );
    return Object.freeze({
      type,
      value: normalized.value,
      exposure: normalizedExposure,
    });
  }
  if (type === 'certificate') {
    const value = normalizeCertificateFingerprint(input.value);
    if (!value) {
      throw new TypeError('Connector certificate target is invalid');
    }
    return Object.freeze({
      type,
      value,
      exposure: normalizedExposure,
    });
  }

  const raw = strictBoundedString(
    input.value,
    MAX_THREAT_INTELLIGENCE_URL_LENGTH,
  );
  if (!raw) throw new TypeError('Connector target value is invalid');
  let classified;
  try {
    classified = classifyQuery(raw);
  } catch {
    classified = null;
  }
  if (!classified) throw new TypeError('Connector target value is invalid');
  if (type === 'domain' && classified.type === 'domain') {
    return Object.freeze({
      type,
      value: classified.registrableDomain,
      exposure: normalizedExposure,
    });
  }
  if (type === 'hostname' && classified.type === 'domain') {
    return Object.freeze({
      type,
      value: classified.inputHostname,
      exposure: normalizedExposure,
    });
  }
  if (
    (type === 'ipv4' || type === 'ipv6')
    && classified.type === type
  ) {
    return Object.freeze({
      type,
      value: classified.value,
      exposure: normalizedExposure,
    });
  }
  if (type === 'asn' && classified.type === 'asn') {
    return Object.freeze({
      type,
      value: classified.value,
      exposure: normalizedExposure,
    });
  }
  throw new TypeError('Connector target type and value are incompatible');
}
