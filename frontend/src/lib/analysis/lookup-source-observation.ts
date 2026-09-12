// Source-only admission and minimised projection. The temporary validation
// envelope is never displayed, exported or merged into a collected Lookup.
import { canonicalRegistrableDomain } from '../../../../lib/registrable-domain.mts';
import { MAX_WHOIS_QUERY_HOPS } from '../../../../lib/whois-contracts.mts';
import { addressValue } from '../../../../packages/contracts/ip-address.mts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { lookupObservationHostname, prepareLookupCollectionTarget } from '../../../../packages/evidence/lookup-target.mts';
import { buildLookupCheckpointFacts, MAX_CHECKPOINT_LIMITATIONS, type CheckpointFact } from './case-evidence-checkpoint.ts';
import { LOOKUP_EVIDENCE_SCHEMA, LOOKUP_EVIDENCE_SCHEMA_VERSION } from './evidence-export.ts';
import { isJsonObject, parseLookupHttpResponse, type JsonObject, type LookupHttpResponse } from './lookup-response.ts';
import type { LookupSourceRefreshId } from './lookup-source-refresh.ts';

const record = (value: unknown): JsonObject => isJsonObject(value) ? value : {};
const COMPLETE = new Set(['success', 'complete', 'not_found']);

export function sourceRefreshTarget(id: LookupSourceRefreshId, original: LookupHttpResponse): string {
  if (original.type !== 'domain') {
    if (id === 'availability') throw new TypeError('Domain evidence requires a domain target.');
    const target = prepareLookupCollectionTarget(original.query);
    if (original.type === 'asn') {
      if (!/^(?:AS)?\d{1,10}$/iu.test(target) || Number(target.replace(/^AS/iu, '')) > 0xffff_ffff) throw new TypeError('A valid ASN is required.');
    } else if (addressValue(target)?.family !== (original.type === 'ipv4' ? 4 : 6)) throw new TypeError('The source target type is invalid.');
    return target;
  }
  const domain = canonicalRegistrableDomain(original.registrableDomain ?? original.query);
  if (!domain) throw new TypeError('A valid registration domain is required.');
  if (id !== 'availability') return domain;
  if (original.availability.webObservationMode === 'selected_url') {
    throw new TypeError('To refresh selected-page evidence, select its URL again in a new Deep lookup.');
  }
  const hostname = lookupObservationHostname(original.availability);
  if (!hostname || canonicalRegistrableDomain(hostname) !== domain) throw new TypeError('The earlier website and DNS target is unavailable. Run a new lookup.');
  return hostname;
}

function scopedResponse(id: LookupSourceRefreshId, original: LookupHttpResponse, source: JsonObject, diagnostic: JsonObject): LookupHttpResponse {
  return {
    query: original.query, type: original.type,
    ...(id === 'availability' && typeof source.observationHostname === 'string'
      ? { inputHostname: source.observationHostname }
      : original.inputHostname ? { inputHostname: original.inputHostname } : {}),
    ...(original.registrableDomain ? { registrableDomain: original.registrableDomain } : {}),
    rdap: id === 'rdap' ? source : {}, whois: id === 'whois' ? source : {},
    availability: id === 'availability' ? source : {},
    diagnostics: { [id]: diagnostic },
  };
}

function sourceClock(value: unknown, now: string): string | null {
  const observed = normalizeExplicitIsoTimestamp(value);
  return observed && Date.parse(observed) <= Date.parse(now) ? observed : null;
}

function projectFacts(id: LookupSourceRefreshId, response: LookupHttpResponse, depth: 'deep' | 'fast', now: string): CheckpointFact[] {
  const facts = buildLookupCheckpointFacts(response, { collectionDepth: depth })
    .filter(fact => id === 'availability'
      ? ['dns', 'http', 'page_identity', 'tls'].includes(fact.category)
      : fact.category === 'registration');
  // An IP/ASN source has no domain Case destination, but its bounded published
  // identifiers can still be inspected and compared in this review session.
  if (response.type !== 'domain') {
    const publication = record(response[id]);
    const parsed = record(publication.parsed);
    const diagnostic = record(response.diagnostics[id]);
    const source = id === 'rdap' ? 'Registry RDAP' : 'WHOIS';
    const observedAt = sourceClock(publication.fetchedAt ?? diagnostic.queriedAt, now);
    for (const [field, label] of [
      ['handle', 'Registration handle'], ['name', 'Network name'], ['country', 'Published country'],
      ['startAddress', 'Range start'], ['endAddress', 'Range end'],
      ['startAutnum', 'ASN range start'], ['endAutnum', 'ASN range end'],
      ['netname', 'WHOIS network name'], ['inetnum', 'WHOIS network range'], ['origin', 'WHOIS origin ASN'],
    ] as const) {
      const value = parsed[field];
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const text = String(value);
      if (!text || text.length > 1_000 || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) continue;
      facts.push({ version: 1, field: `network.${field}`, category: 'network', label, value: text, source,
        sourceState: String(diagnostic.status ?? 'unknown'), observedAt, collectionDepth: depth,
        completeness: observedAt && diagnostic.complete === true ? 'complete' : 'partial',
        truncated: diagnostic.truncated === true, limitations: [],
        sourceSchema: { collection: 'lookup_result', schema: LOOKUP_EVIDENCE_SCHEMA, version: LOOKUP_EVIDENCE_SCHEMA_VERSION },
      });
    }
  }
  return facts.map<CheckpointFact>(fact => {
    const observedAt = sourceClock(fact.observedAt, now);
    return { ...fact, observedAt,
      completeness: observedAt ? fact.completeness : 'unknown',
      limitations: observedAt ? fact.limitations : [...new Set([
        'The source observation time is unavailable or invalid; this value cannot form a dated checkpoint.',
        ...fact.limitations,
      ])].slice(0, MAX_CHECKPOINT_LIMITATIONS),
    };
  });
}

export function originalSourceRefreshFacts(id: LookupSourceRefreshId, original: LookupHttpResponse, depth: 'deep' | 'fast', now = new Date().toISOString()): CheckpointFact[] {
  return projectFacts(id, scopedResponse(id, original, original[id], record(original.diagnostics[id])), depth, now);
}

export function readSourceRefreshObservation(
  id: LookupSourceRefreshId, body: unknown, original: LookupHttpResponse, depth: 'deep' | 'fast', now: string,
): Readonly<{ facts: readonly CheckpointFact[]; state: 'complete' | 'limited'; observedAt: string | null; detail: string }> {
  if (!isJsonObject(body)) throw new TypeError('Invalid source response.');
  if (['complete', 'truncated'].some(key => body[key] !== undefined && typeof body[key] !== 'boolean')) throw new TypeError('Invalid source completeness.');
  const target = sourceRefreshTarget(id, original);
  const parsed = record(body.parsed);
  let diagnostic: JsonObject;
  let detail: string;
  if (id === 'availability') {
    if (body.applicable !== true || body.domain !== canonicalRegistrableDomain(target)
      || lookupObservationHostname(body) !== target || body.webObservationMode !== undefined) throw new TypeError('Source target mismatch.');
    diagnostic = { status: 'partial' };
    detail = 'DNS, HTTP and TLS observations remain separately attributed.';
  } else {
    if (body.query !== target || body.type !== original.type) throw new TypeError('Source target mismatch.');
    if (original.type === 'domain' && (id === 'rdap' ? body.upstreamStatus === 200 : parsed.domainName !== undefined)
      && prepareLookupCollectionTarget(String(id === 'rdap' ? parsed.domain : parsed.domainName)) !== target) {
      throw new TypeError('Published registration target mismatch.');
    }
    if (id === 'rdap') {
      const expectedClass = original.type === 'domain' ? 'domain' : original.type === 'asn' ? 'autnum' : 'ip network';
      if (parsed.objectClassName !== undefined && parsed.objectClassName !== expectedClass
        || parsed.serverTruncated !== undefined && typeof parsed.serverTruncated !== 'boolean') throw new TypeError('Invalid registry object.');
      if (!Number.isInteger(body.upstreamStatus) || ![200, 404].includes(Number(body.upstreamStatus))
        || body.upstreamStatus === 200 && !isJsonObject(body.parsed)
        || body.upstreamStatus === 404 && body.parsed != null) throw new TypeError('Invalid registry response.');
      if (body.upstreamStatus === 200 && original.type === 'asn') {
        const asn = Number(target.replace(/^AS/iu, ''));
        if (!Number.isSafeInteger(parsed.startAutnum) || !Number.isSafeInteger(parsed.endAutnum)
          || Number(parsed.startAutnum) < 0 || Number(parsed.endAutnum) > 0xffff_ffff
          || asn < Number(parsed.startAutnum) || asn > Number(parsed.endAutnum)) throw new TypeError('Registry ASN range mismatch.');
      } else if (body.upstreamStatus === 200 && ['ipv4', 'ipv6'].includes(original.type)) {
        const address = addressValue(target), start = addressValue(parsed.startAddress), end = addressValue(parsed.endAddress);
        if (!address || !start || !end || address.family !== start.family || address.family !== end.family
          || address.value < start.value || address.value > end.value) throw new TypeError('Registry address range mismatch.');
      }
      const truncated = body.truncated === true || parsed.serverTruncated === true;
      const observedAt = sourceClock(body.fetchedAt, now);
      diagnostic = { status: truncated ? 'partial' : body.upstreamStatus === 404 ? 'not_found' : 'success',
        complete: !truncated && body.complete !== false && observedAt !== null, truncated, fetchedAt: observedAt };
      detail = body.upstreamStatus === 404 ? 'Registry RDAP returned no matching object; other sources are unchanged.'
        : truncated ? 'Registry RDAP returned a truncated record.' : 'Registry RDAP returned structured registration facts.';
    } else {
      if (!Array.isArray(body.chain) || !body.chain.length || body.chain.length > MAX_WHOIS_QUERY_HOPS + 1
        || !body.chain.every(isJsonObject) || !['complete', 'partial'].includes(String(parsed.chainStatus))) throw new TypeError('Invalid WHOIS chain.');
      const hops = body.chain.map(record);
      const clocks = hops.filter(hop => typeof hop.response === 'string' && hop.response.length).map(hop => sourceClock(hop.queriedAt, now));
      const observedAt = clocks.length && clocks.every(Boolean) ? clocks.filter((time): time is string => time !== null).sort()[0]! : null;
      const truncated = body.truncated === true || Array.isArray(parsed.fieldsTruncated) && parsed.fieldsTruncated.length > 0;
      const complete = body.complete !== false && parsed.chainStatus === 'complete' && hops.every(hop => !hop.error)
        && clocks.length > 0 && observedAt !== null && !truncated
        && (parsed.registrationStatus === 'not_found'
          || parsed.registrationStatus === 'registered' && (original.type !== 'domain' || typeof parsed.domainName === 'string'));
      diagnostic = { status: complete ? 'complete' : 'partial', complete, truncated, queriedAt: observedAt };
      detail = `WHOIS returned ${hops.length} referral-chain hop${hops.length === 1 ? '' : 's'}${complete ? '.' : '; the record remains limited.'}`;
    }
  }
  const admitted = parseLookupHttpResponse(scopedResponse(id, original, body, diagnostic));
  if (!admitted.ok) throw new TypeError('Source response failed its evidence contract.');
  const facts = projectFacts(id, admitted.value, depth, now).map(fact => ({ ...fact,
    limitations: ['Collected in a separate source refresh; not part of the original Lookup.', ...fact.limitations].slice(0, MAX_CHECKPOINT_LIMITATIONS),
  }));
  const sourceRecords = id === 'availability'
    ? (depth === 'fast' ? [] : ['dns', 'http', 'tls']).map(key => record(body[key])) : [diagnostic];
  const complete = body.complete !== false && body.truncated !== true
    && sourceRecords.length > 0 && sourceRecords.every(source => COMPLETE.has(String(source.status))
    && source.complete !== false && source.truncated !== true
    && record(source.response).bodyTruncated !== true
    && sourceClock(source.observedAt ?? source.fetchedAt ?? source.queriedAt, now) !== null);
  const clocks = new Set(facts.filter(fact => fact.value !== null).map(fact => fact.observedAt));
  const observedAt = id === 'availability' ? clocks.size === 1 ? [...clocks][0] ?? null : null
    : sourceClock(diagnostic.fetchedAt ?? diagnostic.queriedAt, now);
  return { facts, state: complete ? 'complete' : 'limited', observedAt, detail };
}
