import type { JsonRecord } from './lookup-display-shared.ts';
import type { LookupViewModel } from './lookup-response.ts';
import { buildLookupDnsDisplay } from './lookup-dns-display.ts';
import { buildLookupHttpDisplay } from './lookup-http-display.ts';
import { buildLookupTlsDisplay } from './lookup-tls-display.ts';

export type LookupNetworkDisplayInput = Pick<LookupViewModel,
  'availability' | 'reverseDns' | 'reverseDnsRecords' | 'dnsEvidence' | 'dnsRecords'
  | 'httpEvidence' | 'httpResponse' | 'httpSecurityHeaders'
  | 'tlsEvidence' | 'tlsCertificate' | 'tlsSubject' | 'tlsIssuer' | 'tlsAltNames'
  | 'tlsPublicKey' | 'tlsCipher' | 'tlsAuthorization' | 'tlsHostname' | 'tlsValidity' | 'tlsDiagnostics'> & Readonly<{
  httpDeliveryMetadata?: JsonRecord;
}>;

export function buildLookupNetworkDisplay(input: LookupNetworkDisplayInput) {
  const dns = buildLookupDnsDisplay(input);
  const http = buildLookupHttpDisplay(input);
  const tls = buildLookupTlsDisplay(input);
  return { ...dns, ...http, ...tls };
}
