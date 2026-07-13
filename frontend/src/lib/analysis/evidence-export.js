import { compareRegistrySources } from './registry-comparison.js';

export const LOOKUP_EVIDENCE_SCHEMA = 'whoisleuth.lookup-evidence';
export const LOOKUP_EVIDENCE_SCHEMA_VERSION = 11;

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function rdapSource(rdap) {
  const source = rdap || {};
  if (source.error) return {
    status: 'error',
    error: String(source.error),
    attempts: cloneJson(source.attempts || []),
  };
  return {
    status: source.upstreamStatus === 404 ? 'not_found' : 'success',
    endpoint: source.rdapServer || null,
    transportSecurity: source.transportSecurity || null,
    httpStatus: source.upstreamStatus ?? null,
    fetchedAt: source.fetchedAt || null,
    attempts: cloneJson(source.attempts || []),
    parsed: cloneJson(source.parsed),
    raw: cloneJson(source.data),
  };
}

function whoisSource(whois) {
  const source = whois || {};
  if (source.error) return { status: 'error', error: String(source.error) };
  const parsed = source.parsed || null;
  return {
    status: parsed && parsed.chainStatus ? parsed.chainStatus : 'unknown',
    queriedAt: source.chain && source.chain[0] ? source.chain[0].queriedAt || null : null,
    authoritativeHop: parsed ? parsed.authoritativeHop || null : null,
    failedHop: parsed ? parsed.failedHop || null : null,
    conflictingHop: parsed ? parsed.conflictingHop || null : null,
    parsed: cloneJson(parsed),
    chain: cloneJson(source.chain || []),
  };
}

/**
 * @param {any} response
 * @param {{ generatedAt?: string, idnAnalysis?: any }} [options]
 */
export function buildLookupEvidence(response, options = {}) {
  const { generatedAt = new Date().toISOString(), idnAnalysis = null } = options;
  const body = response || {};
  const rdapParsed = body.rdap && !body.rdap.error ? body.rdap.parsed : null;
  const whoisParsed = body.whois && !body.whois.error ? body.whois.parsed : null;
  return {
    schema: LOOKUP_EVIDENCE_SCHEMA,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    application: { name: 'WHOISleuth' },
    query: {
      submitted: body.query || null,
      type: body.type || null,
      inputHostname: body.inputHostname || null,
      registrableDomain: body.registrableDomain || null,
      isSubdomain: body.isSubdomain === true,
    },
    diagnostics: cloneJson(body.diagnostics),
    sources: {
      rdap: rdapSource(body.rdap),
      whois: whoisSource(body.whois),
    },
    analysis: {
      availability: cloneJson(body.availability),
      idn: cloneJson(idnAnalysis),
      registryComparison: compareRegistrySources(rdapParsed, whoisParsed, {
        rdapStatus: body.diagnostics?.rdap?.status,
        whoisStatus: body.diagnostics?.whois?.status,
      }),
    },
  };
}

export function evidenceFilename(response, now = Date.now()) {
  const rawTarget = response?.registrableDomain || response?.inputHostname || response?.query || 'lookup';
  const target = String(rawTarget)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'lookup';
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `whoisleuth-evidence-${target}-${timestamp}.json`;
}
