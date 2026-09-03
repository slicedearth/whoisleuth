import {
  boundedTechnologyText,
  rec,
  records,
  show,
  statusLabel,
  stringList,
  type JsonRecord,
} from './lookup-display-shared.ts';
import { MAX_LOOKUP_DNS_RECORDS_PER_TYPE, MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS } from '../../../../lib/lookup-network-evidence-bounds.mts';
import { MAX_OBSERVATION_DIAGNOSTICS } from '../../../../packages/evidence/observation.mts';

function httpsServiceBindingValue(value: unknown): string {
  const record = rec(value);
  const priority = Number(record.priority);
  if (!['alias', 'service'].includes(String(record.mode))
    || !Number.isSafeInteger(priority)
    || priority < 0
    || priority > 0xffff) return '';
  const parameters = rec(record.parameters);
  const mode = record.mode === 'alias' ? 'Alias' : 'Service';
  const target = record.serviceUnavailable === true
    ? 'advisory unavailable'
    : record.targetIsOwner === true
      ? 'owner'
      : boundedTechnologyText(record.target, 253) || 'target unavailable';
  return [
    `${mode} priority ${priority} → ${target}`,
    stringList(parameters.alpn).length
      ? `ALPN ${stringList(parameters.alpn)
          .slice(0, 16)
          .map((item) => boundedTechnologyText(item, 132))
          .join(', ')}`
      : '',
    parameters.port !== null
    && parameters.port !== undefined
    && Number.isInteger(Number(parameters.port))
      ? `port ${Number(parameters.port)}`
      : '',
    stringList(parameters.ipv4hint).length
      ? `IPv4 hints ${stringList(parameters.ipv4hint)
          .slice(0, 8)
          .map((item) => boundedTechnologyText(item, 64))
          .join(', ')}`
      : '',
    stringList(parameters.ipv6hint).length
      ? `IPv6 hints ${stringList(parameters.ipv6hint)
          .slice(0, 8)
          .map((item) => boundedTechnologyText(item, 64))
          .join(', ')}`
      : '',
    records(parameters.opaque).length
      ? `Published ${records(parameters.opaque)
          .slice(0, 24)
          .map((item) => boundedTechnologyText(item.name || `key ${item.key}`, 63))
          .filter(Boolean)
          .join(', ')}`
      : '',
    Array.isArray(parameters.unsupportedMandatoryKeys)
    && parameters.unsupportedMandatoryKeys.length
      ? `unsupported mandatory keys ${parameters.unsupportedMandatoryKeys
          .slice(0, 24)
          .map(Number)
          .join(', ')}`
      : '',
    record.compatible === false ? 'not compatible with this parser' : '',
    Number.isInteger(Number(record.ttl)) ? `TTL ${Number(record.ttl)}s` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function boundedDnsRecordValue(name: string, value: unknown): string {
  if (typeof value === 'string') return boundedTechnologyText(value, 1024);
  const record = rec(value);
  if (name === 'mx') {
    const priority = Number(record.priority);
    const exchange = boundedTechnologyText(record.exchange, 253);
    return Number.isSafeInteger(priority) && priority >= 0 && priority <= 0xffff && exchange
      ? `${priority} ${exchange}`
      : '';
  }
  if (name === 'caa') {
    const critical = Number(record.critical);
    const tag = boundedTechnologyText(record.tag, 15);
    const policy = boundedTechnologyText(record.value, 1024);
    return Number.isSafeInteger(critical) && critical >= 0 && critical <= 0xff && tag && policy
      ? `${critical} ${tag} ${policy}`
      : '';
  }
  if (name === 'soa') {
    const nsname = boundedTechnologyText(record.nsname, 253);
    const hostmaster = boundedTechnologyText(record.hostmaster, 253);
    const fields = ['serial', 'refresh', 'retry', 'expire', 'minttl'] as const;
    const numbers = fields.map((field) => Number(record[field]));
    if (!nsname || !hostmaster || numbers.some((field) => (
      !Number.isSafeInteger(field) || field < 0 || field > 0xffff_ffff
    ))) return '';
    const [serial, refresh, retry, expire, minttl] = numbers;
    return `${nsname} · hostmaster ${hostmaster} · serial ${serial} · refresh ${refresh}s · retry ${retry}s · expire ${expire}s · minimum TTL ${minttl}s`;
  }
  return name === 'https' ? httpsServiceBindingValue(record) : '';
}

function missingReverseDnsValue(reverseDns: JsonRecord): string {
  const diagnostic = rec(rec(reverseDns.diagnostics).ptr);
  if (reverseDns.status === 'skipped' || diagnostic.status === 'skipped') return 'Not evaluated';
  if (diagnostic.status === 'success' || diagnostic.status === 'not_found') return 'Not observed';
  if (['partial', 'error', 'unsupported'].includes(String(reverseDns.status))
    || ['partial', 'error', 'unsupported'].includes(String(diagnostic.status))) {
    return 'Not established (source unavailable or incomplete)';
  }
  return 'Not observed';
}

function boundedOwnEntries(value: JsonRecord, maximum: number): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    entries.push([key, value[key]]);
    if (entries.length >= maximum) break;
  }
  return entries;
}

export function buildLookupDnsDisplay(input: {
  availability: JsonRecord;
  reverseDns: JsonRecord;
  reverseDnsRecords: JsonRecord;
  dnsEvidence: JsonRecord;
  dnsRecords: JsonRecord;
}) {
  const { availability, reverseDns, reverseDnsRecords, dnsEvidence, dnsRecords } = input;
  const dnsProjection = (name: string) => {
    const source = dnsRecords[name];
    const values = Array.isArray(source)
      ? source.slice(0, MAX_LOOKUP_DNS_RECORDS_PER_TYPE)
      : [];
    const projected = values
      .map((value) => boundedDnsRecordValue(name, value))
      .filter(Boolean);
    return {
      value: projected.join(' | '),
      malformed: (source !== undefined && !Array.isArray(source))
        || (Array.isArray(source) && (source.length > values.length || projected.length !== values.length)),
    };
  };
  const dnsDisplay = (name: string) => {
    const projection = dnsProjection(name);
    if (projection.value) {
      return projection.malformed
        ? `${projection.value} · additional malformed or excess values withheld`
        : projection.value;
    }
    if (projection.malformed) return 'Not established (malformed evidence)';
    const diagnostic = rec(rec(dnsEvidence.diagnostics)[name]);
    if (dnsEvidence.status === 'skipped' || diagnostic.status === 'skipped') return 'Not evaluated';
    if (diagnostic.status === 'success' || diagnostic.status === 'not_found') return 'Not observed';
    if (diagnostic.status === 'error' || diagnostic.status === 'partial'
      || diagnostic.truncated === true || dnsEvidence.status === 'partial') {
      return 'Not established (partial source)';
    }
    return dnsEvidence.status === 'error' ? 'Unavailable' : 'Not observed';
  };
  const dnsRows: Array<{ label: string; value: string }> = [
    { label: 'DNSSEC', value: show(availability.dnssec) },
  ];
  for (const [label, name] of [
    ['A', 'a'],
    ['AAAA', 'aaaa'],
    ['CNAME', 'cname'],
    ['Nameservers', 'ns'],
    ['MX', 'mx'],
    ['SPF', 'spf'],
    ['DMARC', 'dmarc'],
    ['CAA', 'caa'],
  ] as const) {
    dnsRows.push({ label, value: dnsDisplay(name) });
  }
  if (Array.isArray(dnsRecords.soa) || rec(dnsEvidence.diagnostics).soa) {
    dnsRows.push({ label: 'SOA', value: dnsDisplay('soa') });
  }
  if (Array.isArray(dnsRecords.https) || rec(dnsEvidence.diagnostics).https) {
    dnsRows.push({ label: 'HTTPS service binding', value: dnsDisplay('https') });
  }
  const caaPolicy = rec(dnsEvidence.caaPolicy);
  if (caaPolicy.policyVersion === 1) {
    const effectiveRecords = records(caaPolicy.records)
      .slice(0, 16)
      .map((item) => `${show(item.critical)} ${show(item.tag)} ${show(item.value)}`)
      .join(' | ');
    dnsRows.push(
      {
        label: 'Effective CAA owner',
        value: caaPolicy.effectiveOwner
          ? `${boundedTechnologyText(caaPolicy.effectiveOwner, 253)}${caaPolicy.inherited === true ? ' · inherited' : ' · exact hostname'}`
          : caaPolicy.status === 'not_found'
            ? 'No applicable policy observed'
            : 'Unavailable',
      },
      {
        label: 'Effective CAA policy',
        value: effectiveRecords || (caaPolicy.status === 'not_found' ? 'Not observed' : 'Unavailable'),
      },
    );
  }
  const delegation = rec(dnsEvidence.delegation);
  const delegationFindings = records(delegation.findings).slice(0, 8).map((item) => ({
    id: boundedTechnologyText(item.id, 80),
    label: boundedTechnologyText(item.label, 120),
    state: ['healthy', 'warning', 'danger', 'unknown'].includes(String(item.state))
      ? String(item.state)
      : 'unknown',
    summary: boundedTechnologyText(item.summary, 240),
    detail: boundedTechnologyText(item.detail, 800),
    remediation: boundedTechnologyText(item.remediation, 400),
  }));
  const delegationAuthorities = records(delegation.authorities).slice(0, 4).map((item) => ({
    nameserver: boundedTechnologyText(item.nameserver, 253),
    state: ['success', 'partial', 'lame', 'unreachable'].includes(String(item.state))
      ? String(item.state)
      : 'unreachable',
    addressSource: item.addressSource === 'registry_glue' ? 'Registry glue' : 'Recursive address',
    addresses: stringList(item.addresses).slice(0, 2),
    nameservers: stringList(item.nameservers).slice(0, 16),
    soaPrimary: boundedTechnologyText(item.soaPrimary, 253),
    soa: (() => {
      const value = rec(item.soa);
      const number = (field: unknown) => (
        typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 && field <= 0xffff_ffff
          ? field
          : null
      );
      const projection = {
        nsname: boundedTechnologyText(value.nsname, 253) || null,
        hostmaster: boundedTechnologyText(value.hostmaster, 253) || null,
        serial: number(value.serial),
        refresh: number(value.refresh),
        retry: number(value.retry),
        expire: number(value.expire),
        minttl: number(value.minttl),
      };
      return Object.values(projection).every((field) => field === null) ? null : projection;
    })(),
  }));
  const delegationRecordMatrix = records(delegation.recordMatrix).slice(0, 4).map((item) => ({
    type: boundedTechnologyText(item.type, 16),
    state: ['aligned', 'different', 'partial', 'insufficient'].includes(String(item.state))
      ? String(item.state)
      : 'insufficient',
    observations: records(item.observations).slice(0, 4).map((observation) => {
      const suppliedValues = stringList(observation.values).slice(0, 32);
      const values = suppliedValues
        .map((value) => boundedTechnologyText(value, 500))
        .filter(Boolean)
        .slice(0, 16);
      const discarded = Number(observation.discarded);
      return {
        nameserver: boundedTechnologyText(observation.nameserver, 253),
        state: ['success', 'not_found', 'partial', 'error', 'not_collected'].includes(String(observation.state))
          ? String(observation.state)
          : 'not_collected',
        values,
        error: boundedTechnologyText(observation.error, 180),
        truncated: observation.truncated === true || suppliedValues.length > 16,
        discarded: Number.isSafeInteger(discarded) && discarded > 0 ? Math.min(discarded, 10_000) : 0,
      };
    }),
  }));
  const dnsDelegation = delegation.delegationHealthVersion === 1
    ? {
        status: statusLabel(show(delegation.status)),
        complete: delegation.complete === true,
        detail: boundedTechnologyText(delegation.detail, 300),
        parentNameservers: stringList(rec(delegation.parent).nameservers).slice(0, 16),
        registryNameservers: stringList(rec(delegation.registry).nameservers).slice(0, 16),
        findings: delegationFindings,
        authorities: delegationAuthorities,
        recordMatrix: delegationRecordMatrix,
        limitations: stringList(delegation.limitations).slice(0, 8),
      }
    : null;

  return {
    dnsRows,
    dnsDelegation,
    dnsQueryFailures: [
      ...boundedOwnEntries(rec(dnsEvidence.diagnostics), MAX_OBSERVATION_DIAGNOSTICS)
        .filter(([, item]) => rec(item).status === 'error')
        .map(([name, item]) => `${name.toUpperCase()}: ${boundedTechnologyText(rec(item).error, 240) || 'query failed'}`),
      ...(() => {
        const policyDiagnostic = rec(rec(caaPolicy.diagnostics).tree);
        return policyDiagnostic.error
          ? [`CAA inheritance: ${boundedTechnologyText(policyDiagnostic.error, 180)}`]
          : [];
      })(),
    ].join(' · '),
    reverseDnsRows: [
      {
        label: 'PTR names',
        value: stringList(reverseDnsRecords.ptr, MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS, 253).join(' · ')
          || missingReverseDnsValue(reverseDns),
      },
    ],
    reverseDnsFailure: (() => {
      const diagnostic = rec(rec(reverseDns.diagnostics).ptr);
      return diagnostic.status === 'error'
        ? boundedTechnologyText(diagnostic.error, 240) || 'query failed'
        : '';
    })(),
  };
}
