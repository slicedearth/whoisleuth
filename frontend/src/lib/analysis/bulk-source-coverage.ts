// Authority-aware interpretation for compact Bulk source observations. Raw
// source states remain unchanged; this layer only decides whether an observed
// limitation was unexpected for the registry's published service paths.

import { registryCapabilityFor } from '../../../../lib/registry-capabilities.mts';

const MAX_SOURCE_OBSERVATIONS = 32;
const MAX_SOURCE_TEXT_LENGTH = 40;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const LIMITED_SOURCE_STATES = new Set([
  'error',
  'failed',
  'inconclusive',
  'partial',
  'rate_limited',
  'unavailable',
  'unsupported',
]);

export type BulkSourceCoverageObservation = Readonly<{
  source: string;
  state: string;
}>;

export type BulkSourceCoverageClass = 'complete' | 'limited' | 'unrecorded';

type NormalizedObservation = Readonly<{
  source: string;
  state: string;
}>;

function text(value: unknown): string {
  return typeof value === 'string'
    && value.length <= MAX_SOURCE_TEXT_LENGTH
    && !CONTROL_RE.test(value)
    ? value.trim().toLowerCase()
    : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function observations(value: unknown): NormalizedObservation[] {
  return Array.isArray(value)
    ? value.slice(0, MAX_SOURCE_OBSERVATIONS).flatMap((entry) => {
      const item = record(entry);
      const source = text(item?.source);
      const state = text(item?.state);
      return source && state ? [{ source, state }] : [];
    })
    : [];
}

function expectedUnsupportedSources(domain: unknown): ReadonlySet<string> {
  const capability = registryCapabilityFor(domain);
  if (!capability) return new Set();
  const expected = new Set<string>();
  if (capability.rdapAccessProfile === 'no-iana-service') expected.add('rdap');
  if (capability.whoisAccessProfile === 'no-iana-service') expected.add('whois');
  return expected;
}

export function isExpectedUnsupportedBulkSource(
  domain: unknown,
  observation: BulkSourceCoverageObservation,
): boolean {
  const source = text(observation.source);
  const state = text(observation.state);
  return state === 'unsupported' && expectedUnsupportedSources(domain).has(source);
}

export function limitedBulkSources(
  domain: unknown,
  coverage: unknown,
  options: Readonly<{ includeSkipped?: boolean }> = {},
): string[] {
  const expectedUnsupported = expectedUnsupportedSources(domain);
  return observations(coverage)
    .filter(({ source, state }) => (
      (LIMITED_SOURCE_STATES.has(state) || (options.includeSkipped === true && state === 'skipped'))
      && !(state === 'unsupported' && expectedUnsupported.has(source))
    ))
    .map(({ source }) => source);
}

export function classifyBulkSourceCoverage(
  domain: unknown,
  coverage: unknown,
): BulkSourceCoverageClass {
  const retained = observations(coverage);
  if (!retained.length) return 'unrecorded';
  return limitedBulkSources(domain, retained).length ? 'limited' : 'complete';
}

export function describeBulkSourceCoverage(
  domain: unknown,
  observation: BulkSourceCoverageObservation,
): string {
  const source = text(observation.source);
  const state = text(observation.state);
  if (!source || !state) return 'unrecorded source';
  return isExpectedUnsupportedBulkSource(domain, observation)
    ? `${source}: unsupported (no IANA-published service)`
    : `${source}: ${state}`;
}
