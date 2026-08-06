type HttpProbeInput = unknown;

type HttpProbeResult = {
  domain: string;
  probeStatus: 'fetched' | 'responded' | 'inconclusive';
  assessment: 'active' | 'inconclusive';
  // Retained for schema-version migration compatibility. Consumers should use
  // assessment, which does not imply that an inconclusive target is unreachable.
  activityStatus: 'active' | null;
  detail: string | null;
  http: Record<string, unknown> | null;
};

const MAX_HTTP_CLI_DETAIL_LENGTH = 300;
const PROBE_STATUSES = new Set<HttpProbeResult['probeStatus']>(['fetched', 'responded', 'inconclusive']);

function boundedDetail(value: unknown): string | null {
  return String(value || '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_HTTP_CLI_DETAIL_LENGTH) || null;
}

function buildHttpProbeResult(
  domain: string,
  probe: HttpProbeInput,
): HttpProbeResult {
  const input = probe && typeof probe === 'object' && !Array.isArray(probe)
    ? probe as Record<string, unknown>
    : {};
  const status = typeof input.status === 'string' && PROBE_STATUSES.has(input.status as HttpProbeResult['probeStatus'])
    ? input.status as HttpProbeResult['probeStatus']
    : 'inconclusive';
  return {
    domain,
    probeStatus: status,
    assessment: status === 'fetched' || status === 'responded' ? 'active' : 'inconclusive',
    activityStatus: status === 'fetched' || status === 'responded' ? 'active' : null,
    detail: boundedDetail(input.detail),
    http: input.http && typeof input.http === 'object' && !Array.isArray(input.http)
      ? input.http as Record<string, unknown>
      : null,
  };
}

export { MAX_HTTP_CLI_DETAIL_LENGTH, buildHttpProbeResult };
export type { HttpProbeInput, HttpProbeResult };
