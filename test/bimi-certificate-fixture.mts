import 'reflect-metadata';
import { X509CertificateGenerator, BasicConstraintsExtension, KeyUsagesExtension, KeyUsageFlags,
  SubjectAlternativeNameExtension, ExtendedKeyUsageExtension, CertificatePolicyExtension, Extension } from '@peculiar/x509';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import { LogotypeExtn, LogotypeInfo, LogotypeData, LogotypeImage, LogotypeDetails, HashAlgAndValue } from '@peculiar/asn1-x509-logotype';
import { gzipSync } from 'node:zlib';
import { BIMI_CERTIFICATE_INPUT_SCHEMA, BIMI_CERTIFICATE_VERSION, BIMI_PURPOSE_OID, BIMI_MARK_POLICY_OID, BIMI_LOGOTYPE_OID } from '../packages/contracts/bimi-certificate.mts';

export const BIMI_REVIEW_TIME = '2026-11-01T00:00:00.000Z';
export const BIMI_EXAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 100 100"><title>Example mark</title><rect width="100" height="100" fill="#369"/></svg>\n';
const keys = Promise.all([0, 1].map(() => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])));
const root = keys.then(async ([ca]) => X509CertificateGenerator.createSelfSigned({
  name: 'CN=Example Mark Root', serialNumber: '01', keys: ca!,
  notBefore: new Date('2025-01-01T00:00:00.000Z'), notAfter: new Date('2030-01-01T00:00:00.000Z'),
  signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
  extensions: [new BasicConstraintsExtension(true, 2, true), new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true)],
}, crypto));

export async function bimiCertificateFixture(options: Readonly<{ svg?: string; wrongDigest?: boolean; purpose?: string; certificateDomain?: string }> = {}) {
  const svg = options.svg ?? BIMI_EXAMPLE_SVG;
  const contentDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(svg.replace(/\r\n?/gu, '\n')));
  const hash = new HashAlgAndValue();
  hash.hashAlg.algorithm = '2.16.840.1.101.3.4.2.1';
  hash.hashValue = new OctetString(options.wrongDigest ? new Uint8Array(32) : contentDigest);
  const logotype = new LogotypeExtn({ subjectLogo: new LogotypeInfo({ direct: new LogotypeData({ image: [new LogotypeImage({
    imageDetails: new LogotypeDetails({ mediaType: 'image/svg+xml',
      logotypeHash: [hash],
      logotypeURI: [`data:image/svg+xml;base64,${gzipSync(Buffer.from(svg)).toString('base64')}`] }),
  })] }) }) });
  const [ca, leaf] = await keys;
  const certificate = await X509CertificateGenerator.create({
    subject: 'CN=Example Mark', issuer: (await root).subject, publicKey: leaf!.publicKey, signingKey: ca!.privateKey,
    serialNumber: '02', notBefore: new Date('2026-01-01T00:00:00.000Z'), notAfter: new Date('2027-01-01T00:00:00.000Z'),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [new BasicConstraintsExtension(false, undefined, true),
      new SubjectAlternativeNameExtension([{ type: 'dns', value: options.certificateDomain ?? 'example.test' }]),
      new ExtendedKeyUsageExtension([options.purpose ?? BIMI_PURPOSE_OID]), new CertificatePolicyExtension([BIMI_MARK_POLICY_OID]),
      new Extension(BIMI_LOGOTYPE_OID, false, AsnConvert.serialize(logotype))],
  }, crypto);
  return { schema: BIMI_CERTIFICATE_INPUT_SCHEMA, version: BIMI_CERTIFICATE_VERSION, domain: 'example.test',
    certificatePem: certificate.toString('pem'), trustAnchorsPem: (await root).toString('pem'), logoSvg: svg };
}
