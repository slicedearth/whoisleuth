'use strict';

const MAX_HTTP_CLI_DETAIL_LENGTH = 300;
const PROBE_STATUSES = new Set(['fetched', 'responded', 'inconclusive']);

function boundedDetail(value) {
  return String(value || '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_HTTP_CLI_DETAIL_LENGTH) || null;
}

function buildHttpProbeResult(domain, probe) {
  const probeStatus = PROBE_STATUSES.has(probe?.status) ? probe.status : 'inconclusive';
  return {
    domain,
    probeStatus,
    activityStatus: probeStatus === 'fetched' || probeStatus === 'responded' ? 'active' : 'unreachable',
    detail: boundedDetail(probe?.detail),
    http: probe?.http && typeof probe.http === 'object' && !Array.isArray(probe.http) ? probe.http : null,
  };
}

module.exports = { MAX_HTTP_CLI_DETAIL_LENGTH, buildHttpProbeResult };
