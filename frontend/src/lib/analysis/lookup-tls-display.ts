import {
  boundedTechnologyText,
  formatDate,
  rec,
  records,
  show,
  stringList,
  type JsonRecord,
} from './lookup-display-shared.ts';
import {
  MAX_LOOKUP_TLS_ALT_NAMES,
  MAX_LOOKUP_TLS_CERTIFICATE_POLICIES,
  MAX_LOOKUP_TLS_CHAIN_CERTIFICATES,
  MAX_LOOKUP_TLS_FINDINGS,
  MAX_LOOKUP_TLS_NAME_VALUES,
} from '../../../../lib/lookup-network-evidence-bounds.mts';

function tlsName(value: JsonRecord): string {
  const common = stringList(value.commonNames, MAX_LOOKUP_TLS_NAME_VALUES, 256);
  const organizations = stringList(value.organizations, MAX_LOOKUP_TLS_NAME_VALUES, 256);
  return [...common, ...organizations].join(' · ') || '—';
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

export function buildLookupTlsDisplay(input: {
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

  const dnsNames = stringList(tlsAltNames.dnsNames, MAX_LOOKUP_TLS_ALT_NAMES, 253);
  return {
    tlsRows: [
      { label: 'Connected address', value: show(tlsEvidence.connectedAddress) },
      { label: 'SNI hostname', value: show(tlsEvidence.sniHost) },
      { label: 'Protocol', value: show(tlsEvidence.protocol) },
      { label: 'Cipher', value: show(tlsCipher.standardName || tlsCipher.name) },
      { label: 'ALPN', value: show(tlsEvidence.alpnProtocol) },
      {
        label: 'Chain trust',
        value: tlsAuthorization.authorized === true
          ? 'Authorised'
          : tlsAuthorization.authorized === false
            ? 'Not authorised'
            : 'Not observed',
        danger: tlsAuthorization.authorized === false,
      },
      {
        label: 'Hostname',
        value: tlsHostname.matches === true
          ? 'Matches SNI'
          : tlsHostname.matches === false
            ? 'Mismatch'
            : 'Not observed',
        danger: tlsHostname.matches === false,
      },
      {
        label: 'Validity',
        value: tlsValidity.status === 'valid'
          ? 'Valid now'
          : tlsValidity.status === 'expired'
            ? 'Expired'
            : tlsValidity.status === 'not_yet_valid'
              ? 'Not yet valid'
              : 'Unknown',
        danger: tlsValidity.status === 'expired' || tlsValidity.status === 'not_yet_valid',
      },
    ],
    tlsFindings: records(tlsEvidence.findings, MAX_LOOKUP_TLS_FINDINGS).map((finding) => ({
      label: boundedTechnologyText(finding.label, 160) || 'TLS finding',
      detail: boundedTechnologyText(finding.detail, 500),
      tone: boundedTechnologyText(finding.tone, 32),
    })),
    leafCertificate,
    alternativeNames: [
      ...dnsNames.map((value) => ({ type: 'DNS', value: show(value) })),
      ...stringList(
        tlsAltNames.ipAddresses,
        Math.max(0, MAX_LOOKUP_TLS_ALT_NAMES - dnsNames.length),
        64,
      ).map((value) => ({ type: 'IP address', value: show(value) })),
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
