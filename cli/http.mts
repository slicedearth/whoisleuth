type HttpProbeInput = Readonly<{
  status?: unknown;
  detail?: unknown;
  http?: unknown;
}>;

type HttpProbeResult = {
  domain: string;
  probeStatus: 'fetched' | 'responded' | 'inconclusive';
  activityStatus: 'active' | 'unreachable';
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
  probe: HttpProbeInput | null | undefined,
): HttpProbeResult {
  const status = typeof probe?.status === 'string' && PROBE_STATUSES.has(probe.status as HttpProbeResult['probeStatus'])
    ? probe.status as HttpProbeResult['probeStatus']
    : 'inconclusive';
  return {
    domain,
    probeStatus: status,
    activityStatus: status === 'fetched' || status === 'responded' ? 'active' : 'unreachable',
    detail: boundedDetail(probe?.detail),
    http: probe?.http && typeof probe.http === 'object' && !Array.isArray(probe.http)
      ? probe.http as Record<string, unknown>
      : null,
  };
}

export { MAX_HTTP_CLI_DETAIL_LENGTH, buildHttpProbeResult };
export type { HttpProbeInput, HttpProbeResult };
