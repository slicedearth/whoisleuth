import type { JsonRecord } from './lookup-display-shared.ts';
import { buildLookupDnsDisplay } from './lookup-dns-display.ts';
import { buildLookupHttpDisplay } from './lookup-http-display.ts';
import { buildLookupTlsDisplay } from './lookup-tls-display.ts';

export type LookupNetworkDisplayInput = Readonly<{
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
}>;

export function buildLookupNetworkDisplay(input: LookupNetworkDisplayInput) {
  const dns = buildLookupDnsDisplay({
    availability: input.availability,
    reverseDns: input.reverseDns,
    reverseDnsRecords: input.reverseDnsRecords,
    dnsEvidence: input.dnsEvidence,
    dnsRecords: input.dnsRecords,
  });
  const http = buildLookupHttpDisplay({
    httpEvidence: input.httpEvidence,
    httpResponse: input.httpResponse,
    httpSecurityHeaders: input.httpSecurityHeaders,
    httpDeliveryMetadata: input.httpDeliveryMetadata,
  });
  const tls = buildLookupTlsDisplay({
    tlsEvidence: input.tlsEvidence,
    tlsCertificate: input.tlsCertificate,
    tlsSubject: input.tlsSubject,
    tlsIssuer: input.tlsIssuer,
    tlsAltNames: input.tlsAltNames,
    tlsPublicKey: input.tlsPublicKey,
    tlsCipher: input.tlsCipher,
    tlsAuthorization: input.tlsAuthorization,
    tlsHostname: input.tlsHostname,
    tlsValidity: input.tlsValidity,
    tlsDiagnostics: input.tlsDiagnostics,
  });
  return { ...dns, ...http, ...tls };
}
