import 'reflect-metadata';
import { CertificateChainValidationEngine, CryptoEngine, AltName, ExtKeyUsage, CertificatePolicies, BasicConstraints } from 'pkijs';
import { AsnConvert } from '@peculiar/asn1-schema';
import { LogotypeExtn } from '@peculiar/asn1-x509-logotype';
import { SaxesParser } from 'saxes';
import { exactOptional } from './artifact-structure.mts';
import { normalizeDomain } from './domain-name.mts';
import { normalizeExplicitIsoTimestamp } from './observation.mts';
import { SHA2_ALGORITHMS as HASHES, boundedCryptoText as boundedText, decodeCryptoBase64 as base64, parseCertificatePem, supportedCertificateSignature } from './bounded-crypto-material.mts';
import {
  BIMI_CERTIFICATE_INPUT_SCHEMA, BIMI_CERTIFICATE_REVIEW_SCHEMA, BIMI_CERTIFICATE_VERSION,
  BIMI_PURPOSE_OID, BIMI_MARK_POLICY_OID, BIMI_LOGOTYPE_OID, BIMI_CHECK_LABELS,
  MAX_BIMI_INPUT_BYTES, MAX_BIMI_CERTIFICATE_BYTES, MAX_BIMI_PEM_BYTES,
  MAX_BIMI_LOGO_BYTES, MAX_BIMI_CHAIN_CERTIFICATES, type BimiCertificateCheck, type BimiCheckState,
} from '../contracts/bimi-certificate.mts';

const encoder = new TextEncoder();
const BER_LIMITS = { maxDepth: 32, maxNodes: 4_096, maxContentLength: MAX_BIMI_CERTIFICATE_BYTES, parseEmbedded: true };
const SVG_ELEMENTS = new Set(['svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'solidColor']);
const bytes = (value: ArrayBuffer) => new Uint8Array(value);
const digest = async (value: Uint8Array<ArrayBuffer>, algorithm = 'SHA-256') =>
  [...new Uint8Array(await crypto.subtle.digest(algorithm, value))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const svgBytes = (value: string) => encoder.encode(value.replace(/\r\n?/gu, '\n'));

const certificates = (pem: string, maximum: number) => parseCertificatePem(pem, maximum, MAX_BIMI_CERTIFICATE_BYTES);

async function inflateLogo(input: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      if ((total += chunk.value.byteLength) > MAX_BIMI_LOGO_BYTES) throw new TypeError('Embedded SVG exceeds its decompressed byte limit.');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/** Core profile and active-content checks only; this is not a full Relax NG validator. */
function svgProfile(svg: string): BimiCheckState {
  let count = 0, depth = 0, root = false, title = false, inTitle = false, unsupported = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new TypeError('DOCTYPE is not accepted.'); });
  parser.on('processinginstruction', () => { throw new TypeError('Processing instructions are not accepted.'); });
  parser.on('opentag', node => {
    if (++count > 2_000 || ++depth > 32 || Object.keys(node.attributes).length > 32) throw new TypeError('SVG structure exceeds its limits.');
    if (node.uri !== 'http://www.w3.org/2000/svg' || !SVG_ELEMENTS.has(node.local)) unsupported = true;
    if (depth === 1) {
      const viewBox = String(node.attributes.viewBox?.value ?? '').trim().split(/\s+/u).map(Number);
      root = node.local === 'svg' && node.attributes.baseProfile?.value === 'tiny-ps' && node.attributes.version?.value === '1.2'
        && viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[2] === viewBox[3];
    }
    inTitle = node.local === 'title';
    for (const attribute of Object.values(node.attributes)) {
      if (attribute.uri === 'http://www.w3.org/2000/xmlns/') continue;
      if (attribute.value.length > 4_096 || /^on/iu.test(attribute.local) || ['href', 'style'].includes(attribute.local)
        || /(?:url\s*\(|https?:|data:)/iu.test(attribute.value) && !/^url\(#[A-Za-z_][\w.-]*\)$/u.test(attribute.value)) unsupported = true;
    }
  });
  parser.on('text', text => { if (inTitle && text.trim()) title = true; });
  parser.on('closetag', () => { depth--; inTitle = false; });
  try { parser.write(svg).close(); } catch { return 'mismatch'; }
  return !root || !title ? 'mismatch' : unsupported ? 'unsupported' : 'matched';
}

/** Offline, separately attributed checks over selected materials and explicit trust anchors. */
export async function reviewBimiCertificate(value: unknown, reviewedAt = new Date().toISOString(), signal?: AbortSignal) {
  signal?.throwIfAborted();
  const input = exactOptional(value, ['schema', 'version', 'domain', 'certificatePem', 'trustAnchorsPem'], ['logoSvg'], 'BIMI certificate input');
  if (input.schema !== BIMI_CERTIFICATE_INPUT_SCHEMA || input.version !== BIMI_CERTIFICATE_VERSION) throw new TypeError('BIMI certificate input schema or version is unsupported.');
  const domain = typeof input.domain === 'string' ? normalizeDomain(input.domain) : null;
  const at = normalizeExplicitIsoTimestamp(reviewedAt);
  if (!domain || !at) throw new TypeError('BIMI review requires one valid domain and an explicit review timestamp.');
  const pem = boundedText(input.certificatePem, MAX_BIMI_PEM_BYTES, 'Certificate PEM');
  const anchorsPem = boundedText(input.trustAnchorsPem, MAX_BIMI_PEM_BYTES, 'Trust-anchor PEM');
  const selectedSvg = input.logoSvg === null || input.logoSvg === undefined ? null : boundedText(input.logoSvg, MAX_BIMI_LOGO_BYTES, 'Selected SVG');
  if (encoder.encode(JSON.stringify(input)).length > MAX_BIMI_INPUT_BYTES) throw new TypeError('Selected BIMI material exceeds its combined byte budget.');
  const chain = certificates(pem, MAX_BIMI_CHAIN_CERTIFICATES), anchors = certificates(anchorsPem, 3);
  const leaf = chain[0]!.certificate;
  const checks: BimiCertificateCheck[] = [];
  const add = (id: keyof typeof BIMI_CHECK_LABELS, state: BimiCheckState, detail: string) => checks.push({ id, label: BIMI_CHECK_LABELS[id], state, detail });
  const engine = new CryptoEngine({ name: 'offline-mark-review', crypto });
  const leafExtension = (oid: string) => leaf.extensions?.find(extension => extension.extnID === oid);
  let pathValid = false;
  try {
    if (anchors.some(item => !(item.certificate.extensions?.find(extension => extension.extnID === '2.5.29.19')?.parsedValue instanceof BasicConstraints)
      || item.certificate.extensions?.find(extension => extension.extnID === '2.5.29.19')?.parsedValue.cA !== true)) throw new TypeError('A selected anchor is not a CA.');
    const result = await new CertificateChainValidationEngine({ trustedCerts: anchors.map(item => item.certificate),
      certs: [...chain.slice(1).map(item => item.certificate), leaf], checkDate: new Date(at) }).verify({ passedWhenNotRevValues: true }, engine);
    pathValid = result.result;
  } catch { /* No network retrieval or ambient trust-store fallback. */ }
  signal?.throwIfAborted();
  add('certification_path', pathValid ? 'matched' : 'mismatch', pathValid ? 'Cryptographic path validation reached a deliberately selected CA anchor. Revocation was not checked.' : 'No valid certification path to the selected CA anchors was established at the review time.');
  const validTime = chain.every(item => Date.parse(at) >= item.certificate.notBefore.value.getTime() && Date.parse(at) <= item.certificate.notAfter.value.getTime());
  add('validity', validTime ? 'matched' : 'mismatch', 'Leaf and supplied chain validity periods are checked at the recorded review time.');
  const eku = leafExtension('2.5.29.37')?.parsedValue;
  const basic = leafExtension('2.5.29.19')?.parsedValue;
  const purpose = eku instanceof ExtKeyUsage && eku.keyPurposes.length === 1 && eku.keyPurposes[0] === BIMI_PURPOSE_OID
    && !(basic instanceof BasicConstraints && basic.cA);
  add('purpose', purpose ? 'matched' : 'mismatch', 'The leaf must declare only the BIMI brand-indicator extended key usage.');
  const policies = leafExtension('2.5.29.32')?.parsedValue;
  add('mark_policy', policies instanceof CertificatePolicies && policies.certificatePolicies.some(policy => policy.policyIdentifier === BIMI_MARK_POLICY_OID) ? 'matched' : 'mismatch', 'Checks the general mark-certificate policy declaration, not the issuer’s audit or trademark rights.');
  const san = leafExtension('2.5.29.17')?.parsedValue;
  const domainMatch = san instanceof AltName && san.altNames.some(name => name.type === 2 && typeof name.value === 'string' && normalizeDomain(name.value) === domain);
  add('domain', domainMatch ? 'matched' : 'mismatch', 'Matches the exact selected domain against DNS subject alternative names; parent domains and wildcards are not substituted.');
  let strength = true;
  try {
    for (const item of chain) {
      signal?.throwIfAborted();
      if (!await supportedCertificateSignature(item.certificate, engine)) strength = false;
    }
  } catch { strength = false; }
  add('signature_strength', strength ? 'matched' : 'unsupported', 'Checks supplied-chain SHA-256/384/512 signatures and RSA ≥2048-bit or P-256/P-384/P-521 keys.');

  let embeddedSvg: string | null = null, embeddedState: BimiCheckState = 'unavailable';
  try {
    const extension = leafExtension(BIMI_LOGOTYPE_OID);
    if (!extension) throw new TypeError('No logotype extension.');
    const logotype = AsnConvert.parse(extension.extnValue.valueBlock.valueHexView, LogotypeExtn, { berOptions: BER_LIMITS });
    const images = logotype.subjectLogo?.direct?.image;
    if (!images || images.length !== 1) { embeddedState = 'unsupported'; throw new TypeError('Ambiguous or indirect subject logo.'); }
    const details = images[0]!.imageDetails;
    if (!['image/svg+xml', 'image/svg+xml+gzip', 'image/svg+xml-compressed'].includes(details.mediaType.toLowerCase())
      || details.logotypeURI.length !== 1 || details.logotypeHash.length > 4) { embeddedState = 'unsupported'; throw new TypeError('Unsupported logo representation.'); }
    const match = /^data:image\/svg\+xml(?:\+gzip|-compressed)?;base64,([A-Za-z0-9+/=]+)$/iu.exec(details.logotypeURI[0]!);
    if (!match) { embeddedState = 'unsupported'; throw new TypeError('Only embedded compressed SVG is inspected.'); }
    const compressed = base64(match[1]!, MAX_BIMI_CERTIFICATE_BYTES);
    const inflated = await inflateLogo(compressed, signal);
    embeddedSvg = new TextDecoder('utf-8', { fatal: true }).decode(inflated);
    const normalized = svgBytes(embeddedSvg);
    const supported = details.logotypeHash.filter(hash => Object.hasOwn(HASHES, hash.hashAlg.algorithm));
    if (!supported.length) embeddedState = 'unsupported';
    else {
      const matches = await Promise.all(supported.map(async hash => await digest(normalized, HASHES[hash.hashAlg.algorithm as keyof typeof HASHES])
        === [...bytes(hash.hashValue.buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')));
      embeddedState = matches.every(Boolean) ? 'matched' : 'mismatch';
    }
  } catch { if (embeddedState === 'unavailable' && leafExtension(BIMI_LOGOTYPE_OID)) embeddedState = 'mismatch'; }
  signal?.throwIfAborted();
  add('embedded_logo', embeddedState, 'Checks the single embedded, bounded gzip SVG against its declared SHA-256/384/512 logotype digests after line-ending normalisation. No certificate URI is fetched.');
  add('selected_logo', selectedSvg === null ? 'not_supplied' : embeddedSvg === null ? 'unavailable'
    : await digest(svgBytes(selectedSvg)) === await digest(svgBytes(embeddedSvg)) ? 'matched' : 'mismatch', 'Compares supplied SVG content with the embedded logo after line-ending normalisation, not visual resemblance.');
  add('svg_profile', embeddedSvg === null ? 'unavailable' : svgProfile(embeddedSvg), 'Checks a square Tiny PS 1.2 document, title and bounded passive SVG subset; does not render it or claim complete Relax NG conformance.');
  const state = checks.every(check => check.state === 'matched' || check.state === 'not_supplied') ? 'checks_passed' as const : 'review_required' as const;
  return Object.freeze({ schema: BIMI_CERTIFICATE_REVIEW_SCHEMA, version: BIMI_CERTIFICATE_VERSION, reviewedAt: at, domain, state,
    certificate: { digestSha256: await digest(chain[0]!.raw), notBefore: leaf.notBefore.value.toISOString(), notAfter: leaf.notAfter.value.toISOString() },
    selectedAnchorDigests: await Promise.all(anchors.map(item => digest(item.raw))), checks,
    logo: { embeddedSha256: embeddedSvg === null ? null : await digest(svgBytes(embeddedSvg)),
      selectedFileSha256: selectedSvg === null ? null : await digest(encoder.encode(selectedSvg)) },
    networkRequestsMade: false,
    limitations: ['Trust is limited to the deliberately selected anchors. No operating-system trust store, AIA, CRL, OCSP or mailbox-provider check is used.',
      'These independent checks do not establish full mark-certificate issuance compliance, trademark rights, DMARC eligibility, certificate-log inclusion or mailbox logo display.',
      'Core SVG checks are a bounded supported subset, not full SVG Tiny PS Relax NG validation. Original certificates and SVG bytes remain separate from this report.'] });
}
