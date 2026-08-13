import {
  boundedTechnologyText,
  formatDate,
  rec,
  records,
  show,
  statusLabel,
  stringList,
  type JsonRecord,
} from './lookup-display-shared.ts';
import {
  MAX_HTTP_ATTEMPTS,
  MAX_HTTP_EVIDENCE_REDIRECTS,
} from '../../../../lib/http-evidence-bounds.mts';
import {
  MAX_LOOKUP_DNS_RECORDS_PER_TYPE,
  MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS,
  MAX_LOOKUP_TLS_ALT_NAMES,
  MAX_LOOKUP_TLS_CERTIFICATE_POLICIES,
  MAX_LOOKUP_TLS_CHAIN_CERTIFICATES,
  MAX_LOOKUP_TLS_FINDINGS,
  MAX_LOOKUP_TLS_NAME_VALUES,
} from '../../../../lib/lookup-network-evidence-bounds.mts';
import { MAX_OBSERVATION_DIAGNOSTICS } from '../../../../lib/observation.mts';
import { deliveryMetadataDisplay } from './lookup-homepage-metadata-display.ts';

function httpsServiceBindingValue(value: unknown): string {
  const record = rec(value);
  const parameters = rec(record.parameters);
  const mode = record.mode === 'alias' ? 'Alias' : 'Service';
  const target =
    record.serviceUnavailable === true
      ? 'advisory unavailable'
      : record.targetIsOwner === true
        ? 'owner'
        : boundedTechnologyText(record.target, 253) || 'target unavailable';
  return [
    `${mode} priority ${
      Number.isInteger(Number(record.priority)) ? Number(record.priority) : '—'
    } → ${target}`,
    stringList(parameters.alpn).length
      ? `ALPN ${stringList(parameters.alpn)
          .slice(0, 16)
          .map((item) => boundedTechnologyText(item, 132))
          .join(', ')}`
      : '',
    parameters.port !== null &&
    parameters.port !== undefined &&
    Number.isInteger(Number(parameters.port))
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
    Array.isArray(parameters.unsupportedMandatoryKeys) &&
    parameters.unsupportedMandatoryKeys.length
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

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;
}

function tlsName(value: JsonRecord): string {
  const common = stringList(value.commonNames, MAX_LOOKUP_TLS_NAME_VALUES, 256);
  const organizations = stringList(value.organizations, MAX_LOOKUP_TLS_NAME_VALUES, 256);
  return [...common, ...organizations].join(' · ') || '—';
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

function tlsMetadataCount(value: unknown): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 999) : 0;
}

function tlsCountSummary(value: unknown, labels: Array<[string, string]>): string {
  const source = rec(value);
  return labels
    .map(([key, label]) => [label, tlsMetadataCount(source[key])] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ');
}

export function buildLookupNetworkDisplay(input: {
  availability: JsonRecord;
  reverseDns: JsonRecord;
  reverseDnsRecords: JsonRecord;
  dnsEvidence: JsonRecord;
  dnsRecords: JsonRecord;
  httpEvidence: JsonRecord;
  httpResponse: JsonRecord;
  httpSecurityHeaders: JsonRecord;
  httpDeliveryMetadata?: JsonRecord;
  tlsEvidence: JsonRecord;
  tlsCertificate: JsonRecord;
  tlsSubject: JsonRecord;
  tlsIssuer: JsonRecord;
  tlsAltNames: JsonRecord;
  tlsPublicKey: JsonRecord;
  tlsCipher: JsonRecord;
  tlsAuthorization: JsonRecord;
  tlsHostname: JsonRecord;
  tlsValidity: JsonRecord;
  tlsDiagnostics: JsonRecord;
}) {
  const {
    availability,
    reverseDns,
    reverseDnsRecords,
    dnsEvidence,
    dnsRecords,
    httpEvidence,
    httpResponse,
    httpSecurityHeaders,
    httpDeliveryMetadata = {},
    tlsEvidence,
    tlsCertificate,
    tlsSubject,
    tlsIssuer,
    tlsAltNames,
    tlsPublicKey,
    tlsCipher,
    tlsAuthorization,
    tlsHostname,
    tlsValidity,
    tlsDiagnostics,
  } = input;
  const dnsValues = (name: string) => {
    const values = Array.isArray(dnsRecords[name])
      ? dnsRecords[name].slice(0, MAX_LOOKUP_DNS_RECORDS_PER_TYPE)
      : [];
    return values
      .map((value) => {
        if (typeof value === 'string') return boundedTechnologyText(value, 1024);
        const record = rec(value);
        if (name === 'mx') return `${record.priority} ${record.exchange || '.'}`;
        if (name === 'caa') return `${record.critical} ${record.tag} ${record.value}`;
        if (name === 'soa') {
          return `${record.nsname} · hostmaster ${record.hostmaster} · serial ${record.serial} · refresh ${record.refresh}s · retry ${record.retry}s · expire ${record.expire}s · minimum TTL ${record.minttl}s`;
        }
        return name === 'https' ? httpsServiceBindingValue(record) : String(value);
      })
      .filter(Boolean)
      .join(' | ');
  };
  const dnsDisplay = (name: string) =>
    dnsEvidence.status === 'skipped' ? 'Not evaluated' : dnsValues(name) || 'Not observed';
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
  const httpSecurityRows: Array<[string, unknown]> = [
    ['HSTS', httpSecurityHeaders.strictTransportSecurity],
    ['Content Security Policy', httpSecurityHeaders.contentSecurityPolicy],
    ['Frame protection', httpSecurityHeaders.xFrameOptions],
    ['Content-type protection', httpSecurityHeaders.xContentTypeOptions],
    ['Referrer policy', httpSecurityHeaders.referrerPolicy],
  ];
  const httpMetadata: Array<{ label: string; value: string; hash?: boolean }> = [];
  if (httpResponse.status) {
    httpMetadata.push(
      ...httpSecurityRows.map(([label, value]) => ({
        label,
        value: value === 'observed' ? 'Observed' : show(value),
      })),
      { label: 'Server', value: show(httpResponse.server) },
      { label: 'Content language', value: show(httpResponse.contentLanguage) },
      {
        label: 'Declared length',
        value:
          httpResponse.declaredContentLength === null ||
          httpResponse.declaredContentLength === undefined
            ? '—'
            : formatBytes(httpResponse.declaredContentLength),
      },
    );
    const bodyHash = rec(httpResponse.bodyHash);
    if (bodyHash.value) {
      httpMetadata.push(
        { label: 'Body SHA-256', value: show(bodyHash.value), hash: true },
        {
          label: 'Hash scope',
          value:
            bodyHash.scope === 'captured-prefix'
              ? `Captured prefix (${formatBytes(bodyHash.bytes)})`
              : `Complete captured body (${formatBytes(bodyHash.bytes)})`,
        },
      );
    }
  }
  const leafCertificate: Array<{ label: string; value: string; hash?: boolean }> = [];
  if (tlsCertificate.fingerprintSha256) {
    leafCertificate.push(
      { label: 'Subject', value: tlsName(tlsSubject) },
      { label: 'Issuer', value: tlsName(tlsIssuer) },
      { label: 'Serial number', value: show(tlsCertificate.serialNumber), hash: true },
      { label: 'Valid from', value: formatDate(tlsCertificate.validFrom) },
      { label: 'Valid to', value: formatDate(tlsCertificate.validTo) },
      {
        label: 'Certificate SHA-256',
        value: show(tlsCertificate.fingerprintSha256),
        hash: true,
      },
      {
        label: 'Public key',
        value: `${show(tlsPublicKey.type)}${
          tlsPublicKey.bits ? ` · ${tlsPublicKey.bits} bits` : ''
        }${tlsPublicKey.curve ? ` · ${tlsPublicKey.curve}` : ''}`,
      },
    );
    if (tlsPublicKey.fingerprintSha256) {
      leafCertificate.push({
        label: 'Public-key SHA-256',
        value: show(tlsPublicKey.fingerprintSha256),
        hash: true,
      });
    }
    const signature = rec(tlsCertificate.signature);
    if (signature.algorithm || signature.oid) {
      leafCertificate.push({
        label: 'Signature',
        value: [signature.algorithm, signature.oid ? `(${signature.oid})` : null]
          .filter(Boolean)
          .join(' '),
      });
    }
    const purposes = rec(tlsCertificate.extendedKeyUsage);
    if (Array.isArray(purposes.values) || purposes.truncated === true) {
      const values = records(purposes.values)
        .slice(0, 8)
        .map((purpose) => `${show(purpose.name)} (${show(purpose.oid)})`);
      const omitted = Array.isArray(purposes.values)
        ? Math.max(0, purposes.values.length - values.length)
        : 0;
      leafCertificate.push({
        label: 'Certificate purposes',
        value: `${values.join(' · ') || 'None declared'}${
          omitted ? ` · +${omitted} more` : ''
        }${purposes.truncated ? ' · source truncated' : ''}`,
      });
    }
    const sanClasses = tlsCountSummary(tlsAltNames.classes, [
      ['dns', 'DNS'],
      ['ip', 'IP'],
      ['email', 'email'],
      ['uri', 'URI'],
      ['directoryName', 'directory name'],
      ['registeredId', 'registered ID'],
      ['otherName', 'other name'],
      ['unclassified', 'other'],
    ]);
    if (sanClasses || tlsAltNames.truncated === true) {
      leafCertificate.push({
        label: 'SAN classes',
        value: `${sanClasses || 'None observed'}${tlsAltNames.truncated ? ' · truncated' : ''}`,
      });
    }
    const aia = rec(tlsCertificate.authorityInformationAccess);
    if (aia.ocsp !== undefined || aia.caIssuers !== undefined || aia.unknownMethods !== undefined || aia.truncated === true) {
      const ocsp = rec(aia.ocsp);
      const issuers = rec(aia.caIssuers);
      const values = [
        tlsMetadataCount(ocsp.total)
          ? `OCSP ${tlsMetadataCount(ocsp.total)} (${tlsMetadataCount(
              ocsp.https,
            )} HTTPS, ${tlsMetadataCount(ocsp.http)} HTTP, ${tlsMetadataCount(ocsp.other)} other)`
          : null,
        tlsMetadataCount(issuers.total)
          ? `CA issuers ${tlsMetadataCount(issuers.total)} (${tlsMetadataCount(
              issuers.https,
            )} HTTPS, ${tlsMetadataCount(issuers.http)} HTTP, ${tlsMetadataCount(
              issuers.other,
            )} other)`
          : null,
        tlsMetadataCount(aia.unknownMethods)
          ? `Unknown methods ${tlsMetadataCount(aia.unknownMethods)}`
          : null,
      ].filter(Boolean);
      leafCertificate.push({
        label: 'AIA presence',
        value: `${values.join(' · ') || 'None declared'}${aia.truncated ? ' · truncated' : ''}`,
      });
    }
    const extensionProfile = rec(tlsCertificate.extensionProfile);
    const policies = rec(extensionProfile.certificatePolicies);
    if (Array.isArray(policies.oids)) {
      const oids = stringList(policies.oids, MAX_LOOKUP_TLS_CERTIFICATE_POLICIES, 128);
      leafCertificate.push({
        label: 'Certificate policies',
        value: `${oids.join(' · ') || 'None declared'}${policies.truncated ? ' · truncated' : ''}`,
      });
    }
    const crl = rec(extensionProfile.crlDistributionPoints);
    if (crl.total !== undefined || crl.https !== undefined || crl.http !== undefined || crl.ldap !== undefined || crl.other !== undefined || crl.truncated === true) {
      leafCertificate.push({
        label: 'CRL distribution presence',
        value: `${tlsMetadataCount(crl.total)} declared (${tlsMetadataCount(crl.https)} HTTPS, ${tlsMetadataCount(crl.http)} HTTP, ${tlsMetadataCount(crl.ldap)} LDAP, ${tlsMetadataCount(crl.other)} other)${crl.truncated ? ' · truncated' : ''}`,
      });
    }
  }

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
        value:
          stringList(reverseDnsRecords.ptr, MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS, 253).join(
            ' · ',
          ) || 'Not observed',
      },
    ],
    reverseDnsFailure: (() => {
      const diagnostic = rec(rec(reverseDns.diagnostics).ptr);
      return diagnostic.status === 'error'
        ? boundedTechnologyText(diagnostic.error, 240) || 'query failed'
        : '';
    })(),
    httpRows: [
      { label: 'Final URL', value: show(httpEvidence.finalUrl || httpEvidence.requestUrl) },
      {
        label: 'Response',
        value: httpResponse.status ? `HTTP ${httpResponse.status}` : 'Not observed',
      },
      {
        label: 'Transport',
        value:
          httpEvidence.transportSecurity === 'https'
            ? 'HTTPS'
            : httpEvidence.transportSecurity === 'http'
              ? 'Cleartext HTTP'
              : 'Not observed',
      },
      { label: 'Redirects', value: show(httpEvidence.redirectCount) },
      { label: 'Content type', value: show(httpResponse.contentType) },
      {
        label: 'Body captured',
        value: `${formatBytes(httpResponse.capturedBodyBytes)}${
          httpResponse.bodyTruncated ? ' · capped' : ''
        }`,
      },
    ],
    httpRedirects: records(httpEvidence.redirects).slice(0, MAX_HTTP_EVIDENCE_REDIRECTS).map((redirect) => ({
      status: show(redirect.status),
      from: show(redirect.from),
      to: show(redirect.to),
      queryOmitted: Boolean(redirect.queryOmitted),
    })),
    httpAttempts: (() => {
      const attempts = records(httpEvidence.attempts).slice(0, MAX_HTTP_ATTEMPTS);
      return attempts.some((attempt) => attempt.error)
        ? attempts.map((attempt) => ({
            url: show(attempt.url),
            detail: attempt.error ? String(attempt.error) : `HTTP ${show(attempt.httpStatus)}`,
          }))
        : [];
    })(),
    httpMetadata,
    httpDeliveryMetadata: deliveryMetadataDisplay(
      Object.keys(httpDeliveryMetadata).length ? httpDeliveryMetadata : null,
    ),
    tlsRows: [
      { label: 'Connected address', value: show(tlsEvidence.connectedAddress) },
      { label: 'SNI hostname', value: show(tlsEvidence.sniHost) },
      { label: 'Protocol', value: show(tlsEvidence.protocol) },
      { label: 'Cipher', value: show(tlsCipher.standardName || tlsCipher.name) },
      { label: 'ALPN', value: show(tlsEvidence.alpnProtocol) },
      {
        label: 'Chain trust',
        value:
          tlsAuthorization.authorized === true
            ? 'Authorised'
            : tlsAuthorization.authorized === false
              ? 'Not authorised'
              : 'Not observed',
        danger: tlsAuthorization.authorized === false,
      },
      {
        label: 'Hostname',
        value:
          tlsHostname.matches === true
            ? 'Matches SNI'
            : tlsHostname.matches === false
              ? 'Mismatch'
              : 'Not observed',
        danger: tlsHostname.matches === false,
      },
      {
        label: 'Validity',
        value:
          tlsValidity.status === 'valid'
            ? 'Valid now'
            : tlsValidity.status === 'expired'
              ? 'Expired'
              : tlsValidity.status === 'not_yet_valid'
                ? 'Not yet valid'
                : 'Unknown',
        danger:
          tlsValidity.status === 'expired' || tlsValidity.status === 'not_yet_valid',
      },
    ],
    tlsFindings: records(tlsEvidence.findings, MAX_LOOKUP_TLS_FINDINGS).map((finding) => ({
      label: boundedTechnologyText(finding.label, 160) || 'TLS finding',
      detail: boundedTechnologyText(finding.detail, 500),
      tone: boundedTechnologyText(finding.tone, 32),
    })),
    leafCertificate,
    alternativeNames: [
      ...stringList(tlsAltNames.dnsNames, MAX_LOOKUP_TLS_ALT_NAMES, 253)
        .map((value) => ({ type: 'DNS', value: show(value) })),
      ...stringList(
        tlsAltNames.ipAddresses,
        Math.max(0, MAX_LOOKUP_TLS_ALT_NAMES - stringList(tlsAltNames.dnsNames, MAX_LOOKUP_TLS_ALT_NAMES, 253).length),
        64,
      ).map((value) => ({
            type: 'IP address',
            value: show(value),
          })),
    ],
    tlsChain: records(tlsEvidence.chain, MAX_LOOKUP_TLS_CHAIN_CERTIFICATES).map((certificate, index) => ({
      label: index === 0 ? 'Leaf certificate' : `Chain certificate ${index + 1}`,
      subject: tlsName(rec(certificate.subject)),
      fingerprint: show(certificate.fingerprintSha256),
    })),
    tlsValidation: [
      ...(tlsDiagnostics.error
        ? [{ label: 'Collection', value: boundedTechnologyText(tlsDiagnostics.error, 240) }]
        : []),
      ...(tlsAuthorization.error
        ? [{ label: 'Authorisation', value: boundedTechnologyText(tlsAuthorization.error, 240) }]
        : []),
      ...(tlsHostname.error
        ? [{ label: 'Hostname', value: boundedTechnologyText(tlsHostname.error, 240) }]
        : []),
    ],
  };
}
