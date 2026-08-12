// Narrow X.509 extension parsing for fields unavailable through Node's native
// X509Certificate API. Raw certificates and extension locations are never
// retained; malformed extensions fail soft and leave an explicit partial flag.

import 'reflect-metadata';
import {
  CertificatePolicyExtension,
  CRLDistributionPointsExtension,
  X509Certificate,
} from '@peculiar/x509';
import { MAX_LOOKUP_TLS_CERTIFICATE_POLICIES } from './lookup-network-evidence-bounds.mts';

export const MAX_CERTIFICATE_POLICIES = MAX_LOOKUP_TLS_CERTIFICATE_POLICIES;
export const MAX_CRL_DISTRIBUTION_POINTS = 32;

export type CertificateExtensionProfile = Readonly<{
  certificatePolicies: Readonly<{ oids: readonly string[]; truncated: boolean }>;
  crlDistributionPoints: Readonly<{
    total: number;
    http: number;
    https: number;
    ldap: number;
    other: number;
    truncated: boolean;
  }>;
  parsed: boolean;
  partial: boolean;
}>;

function emptyProfile(partial = false): CertificateExtensionProfile {
  return Object.freeze({
    certificatePolicies: Object.freeze({ oids: Object.freeze([]), truncated: false }),
    crlDistributionPoints: Object.freeze({ total: 0, http: 0, https: 0, ldap: 0, other: 0, truncated: false }),
    parsed: false,
    partial,
  });
}

function distributionUris(extension: CRLDistributionPointsExtension): string[] {
  const uris: string[] = [];
  for (const point of extension.distributionPoints.slice(0, MAX_CRL_DISTRIBUTION_POINTS + 1)) {
    for (const name of point.distributionPoint?.fullName ?? []) {
      if (typeof name.uniformResourceIdentifier === 'string') uris.push(name.uniformResourceIdentifier);
    }
  }
  return uris;
}

export function parseCertificateExtensionProfile(raw: unknown): CertificateExtensionProfile {
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 256 * 1024) return emptyProfile();
  try {
    const encoded = Uint8Array.from(raw).buffer;
    const certificate = new X509Certificate(encoded);
    const policies = certificate.getExtension(CertificatePolicyExtension)?.policies ?? [];
    const crlExtension = certificate.getExtension(CRLDistributionPointsExtension);
    const uris = crlExtension ? distributionUris(crlExtension) : [];
    const retainedPolicies = [...new Set(policies.filter((oid) => /^\d+(?:\.\d+)+$/u.test(oid)))]
      .slice(0, MAX_CERTIFICATE_POLICIES);
    const retainedUris = uris.slice(0, MAX_CRL_DISTRIBUTION_POINTS);
    const schemes = { http: 0, https: 0, ldap: 0, other: 0 };
    for (const uri of retainedUris) {
      let protocol = '';
      try { protocol = new URL(uri).protocol.toLowerCase(); } catch { /* counted as other */ }
      if (protocol === 'http:') schemes.http += 1;
      else if (protocol === 'https:') schemes.https += 1;
      else if (protocol === 'ldap:' || protocol === 'ldaps:') schemes.ldap += 1;
      else schemes.other += 1;
    }
    return Object.freeze({
      certificatePolicies: Object.freeze({
        oids: Object.freeze(retainedPolicies),
        truncated: policies.length > retainedPolicies.length,
      }),
      crlDistributionPoints: Object.freeze({
        total: retainedUris.length,
        ...schemes,
        truncated: uris.length > retainedUris.length,
      }),
      parsed: true,
      partial: policies.length > retainedPolicies.length || uris.length > retainedUris.length,
    });
  } catch {
    return emptyProfile(true);
  }
}
