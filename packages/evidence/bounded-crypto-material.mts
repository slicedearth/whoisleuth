import { fromBER } from 'asn1js';
import { Certificate, type CryptoEngine } from 'pkijs';

export const SHA2_ALGORITHMS = Object.freeze({
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
});

export function boundedCryptoText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length > maximum || new TextEncoder().encode(value).length > maximum) throw new TypeError(`${label} exceeds its byte limit or is not text.`);
  return value;
}

export function decodeCryptoBase64(value: unknown, maximum: number, label = 'Cryptographic material', allowEmpty = false): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new TypeError(`${label} encoding is invalid.`);
  const decoded = atob(value);
  if ((!allowEmpty && !decoded.length) || decoded.length > maximum || btoa(decoded) !== value) throw new TypeError(`${label} encoding is invalid.`);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

export function parseCryptoDer(raw: Uint8Array<ArrayBuffer>, maximum: number, label: string) {
  if (!raw.length || raw.length > maximum) throw new TypeError(`${label} exceeds its byte limit.`);
  const parsed = fromBER(raw, { maxDepth: 32, maxNodes: 4_096, maxContentLength: maximum, parseEmbedded: true });
  if (parsed.offset !== raw.length || parsed.result.error) throw new TypeError(`${label} is malformed or exceeds parsing limits.`);
  return parsed.result;
}

export function parseCertificatePem(pem: string, maximumCount: number, maximumCertificateBytes: number) {
  const result: { raw: Uint8Array<ArrayBuffer>; certificate: Certificate }[] = [];
  let offset = 0;
  for (const match of pem.matchAll(/-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\r\n\t ]+)-----END CERTIFICATE-----/gu)) {
    if (pem.slice(offset, match.index).trim() || result.length >= maximumCount) throw new TypeError('Select a bounded certificate-only PEM chain.');
    const raw = decodeCryptoBase64(match[1]!.replace(/\s/gu, ''), maximumCertificateBytes, 'Certificate');
    let certificate: Certificate;
    try { certificate = new Certificate({ schema: parseCryptoDer(raw, maximumCertificateBytes, 'Certificate DER') }); }
    catch { throw new TypeError('Certificate structure is malformed or unsupported.'); }
    const identifiers = certificate.extensions?.map(extension => extension.extnID) ?? [];
    if (new Set(identifiers).size !== identifiers.length) throw new TypeError('Certificate extensions are duplicated.');
    result.push({ raw, certificate }); offset = match.index! + match[0].length;
  }
  if (!result.length || pem.slice(offset).trim()) throw new TypeError('Select a bounded certificate-only PEM chain.');
  return result;
}

export async function supportedCertificateSignature(certificate: Certificate, engine: CryptoEngine): Promise<boolean> {
  try {
    if (certificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView.length > 2_048) return false;
    if (certificate.signature.algorithmId !== certificate.signatureAlgorithm.algorithmId
      || certificate.extensions?.some(extension => extension.critical && !extension.parsedValue)) return false;
    if (!['SHA-256', 'SHA-384', 'SHA-512'].includes(engine.getHashAlgorithm(certificate.signatureAlgorithm))) return false;
    const key = await certificate.getPublicKey(undefined, engine);
    const algorithm = key.algorithm as RsaKeyAlgorithm & EcKeyAlgorithm;
    return algorithm.name === 'ECDSA' && ['P-256', 'P-384', 'P-521'].includes(algorithm.namedCurve)
      || ['RSASSA-PKCS1-v1_5', 'RSA-PSS'].includes(algorithm.name) && algorithm.modulusLength >= 2_048 && algorithm.modulusLength <= 8_192;
  } catch { return false; }
}
