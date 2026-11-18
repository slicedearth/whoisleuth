import { Constructed, ObjectIdentifier, OctetString, Sequence, Integer } from 'asn1js';
import { Certificate, CertificateRevocationList, CertificateChainValidationEngine, ContentInfo, CryptoEngine, SignedData, SignedDataVerifyError, TSTInfo, ExtKeyUsage, BasicConstraints, AlgorithmIdentifier, AltName, IssuerAndSerialNumber, RelativeDistinguishedNames, type GeneralName } from 'pkijs';
import { exactOptional } from './artifact-structure.mts';
import { normalizeExplicitIsoTimestamp } from './observation.mts';
import { boundedCryptoText, decodeCryptoBase64, parseCryptoDer, parseCertificatePem, supportedCertificateSignature, SHA2_ALGORITHMS } from './bounded-crypto-material.mts';
import { TIMESTAMP_TOKEN_INPUT_SCHEMA, TIMESTAMP_TOKEN_REVIEW_SCHEMA, TIMESTAMP_TOKEN_VERSION, MAX_TIMESTAMP_INPUT_BYTES, MAX_TIMESTAMP_ARTIFACT_BYTES, MAX_TIMESTAMP_TOKEN_BYTES, MAX_TIMESTAMP_CERTIFICATE_BYTES, TIMESTAMP_PURPOSE_OID } from '../contracts/timestamp-token.mts';

type CheckState = 'matched' | 'mismatch' | 'unsupported' | 'not_supplied' | 'not_checked';
const hex = (value: Uint8Array) => [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: Uint8Array<ArrayBuffer>) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', value)));
const SIGNATURE_ALGORITHMS = new Set(['1.2.840.113549.1.1.1', '1.2.840.113549.1.1.11', '1.2.840.113549.1.1.12', '1.2.840.113549.1.1.13',
  '1.2.840.10045.4.3.2', '1.2.840.10045.4.3.3', '1.2.840.10045.4.3.4']);
const TST_INFO = '1.2.840.113549.1.9.16.1.4';
function encodedName(name: GeneralName): string | null {
  const schema = name.toSchema();
  return 'toBER' in schema ? hex(new Uint8Array(schema.toBER(false))) : null;
}

async function signingCertificateBinding(attributes: SignedData['signerInfos'][number]['signedAttrs'], certificate: Certificate, rawCertificate: Uint8Array<ArrayBuffer>): Promise<CheckState> {
  const attribute = attributes?.attributes.find(attribute => attribute.type === '1.2.840.113549.1.9.16.2.47');
  if (!attribute) return 'unsupported';
  try {
    const outer = attribute.values[0];
    if (attribute.values.length !== 1 || !(outer instanceof Sequence) || outer.valueBlock.value.length !== 1) return 'unsupported';
    const identifiers = outer.valueBlock.value[0];
    if (!(identifiers instanceof Sequence) || identifiers.valueBlock.value.length !== 1) return 'unsupported';
    const identifier = identifiers.valueBlock.value[0];
    if (!(identifier instanceof Sequence)) return 'mismatch';
    const fields = [...identifier.valueBlock.value];
    let algorithm = '2.16.840.1.101.3.4.2.1';
    if (fields[0] instanceof Sequence) algorithm = new AlgorithmIdentifier({ schema: fields.shift()! }).algorithmId;
    if (!Object.hasOwn(SHA2_ALGORITHMS, algorithm)) return 'unsupported';
    const expected = fields.shift();
    if (!(expected instanceof OctetString) || fields.length > 1) return 'mismatch';
    const actual = new Uint8Array(await crypto.subtle.digest(SHA2_ALGORITHMS[algorithm as keyof typeof SHA2_ALGORITHMS], rawCertificate));
    if (hex(actual) !== hex(new Uint8Array(expected.getValue()))) return 'mismatch';
    if (fields.length) {
      const identity = fields[0];
      if (!(identity instanceof Sequence) || identity.valueBlock.value.length !== 2) return 'mismatch';
      const [names, serial] = identity.valueBlock.value;
      if (!(names instanceof Sequence) || !(serial instanceof Integer) || !serial.isEqual(certificate.serialNumber)) return 'mismatch';
      const issuer = new AltName({ schema: names });
      if (!issuer.altNames.some(name => name.type === 4 && name.value instanceof RelativeDistinguishedNames && name.value.isEqual(certificate.issuer))) return 'mismatch';
    }
    return 'matched';
  } catch { return 'mismatch'; }
}

/** Offline RFC 3161 token review, with explicit policy, anchors and supplied CRLs. */
export async function reviewTimestampToken(value: unknown, reviewedAt = new Date().toISOString(), signal?: AbortSignal) {
  signal?.throwIfAborted();
  const input = exactOptional(value, ['schema', 'version', 'artifactBase64', 'tokenDerBase64', 'trustAnchorsPem', 'expectedPolicyOid'], ['expectedNonceHex', 'crlsDerBase64'], 'Timestamp-token input');
  if (input.schema !== TIMESTAMP_TOKEN_INPUT_SCHEMA || input.version !== TIMESTAMP_TOKEN_VERSION) throw new TypeError('Timestamp-token schema or version is unsupported.');
  const at = normalizeExplicitIsoTimestamp(reviewedAt);
  if (!at || typeof input.expectedPolicyOid !== 'string' || input.expectedPolicyOid.length > 256 || !/^[0-2](?:\.[0-9]{1,20}){1,20}$/u.test(input.expectedPolicyOid)) throw new TypeError('An explicit review time and expected timestamp policy OID are required.');
  if (input.expectedNonceHex !== undefined && (typeof input.expectedNonceHex !== 'string' || !/^(?:[a-fA-F0-9]{2}){1,40}$/u.test(input.expectedNonceHex))) throw new TypeError('The expected nonce must be a bounded hexadecimal integer.');
  const artifact = decodeCryptoBase64(input.artifactBase64, MAX_TIMESTAMP_ARTIFACT_BYTES, 'Selected non-empty artefact');
  const rawToken = decodeCryptoBase64(input.tokenDerBase64, MAX_TIMESTAMP_TOKEN_BYTES, 'Timestamp token');
  const anchors = parseCertificatePem(boundedCryptoText(input.trustAnchorsPem, 256 * 1024, 'Trust-anchor PEM'), 3, MAX_TIMESTAMP_CERTIFICATE_BYTES);
  const crlInputs = input.crlsDerBase64 ?? [];
  if (!Array.isArray(crlInputs) || crlInputs.length > 6) throw new TypeError('Select at most six bounded CRLs.');
  const suppliedCrlBytes = crlInputs.map(value => decodeCryptoBase64(value, MAX_TIMESTAMP_CERTIFICATE_BYTES, 'Selected CRL'));
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_TIMESTAMP_INPUT_BYTES) throw new TypeError('Timestamp review input exceeds its combined byte budget.');
  const content = new ContentInfo({ schema: parseCryptoDer(rawToken, MAX_TIMESTAMP_TOKEN_BYTES, 'Timestamp-token DER') });
  if (content.contentType !== ContentInfo.SIGNED_DATA) throw new TypeError('Select the RFC 3161 CMS timestamp token, not a response envelope or unrelated CMS object.');
  const signed = new SignedData({ schema: content.content });
  if (signed.signerInfos.length !== 1 || !signed.certificates?.length || signed.certificates.length > 6 || signed.certificates.some(certificate => !(certificate instanceof Certificate))
    || signed.encapContentInfo.eContentType !== TST_INFO || !signed.encapContentInfo.eContent) throw new TypeError('One timestamp signer and a bounded X.509 certificate set are required.');
  const chainCertificates = signed.certificates.filter((certificate): certificate is Certificate => certificate instanceof Certificate);
  for (const certificate of chainCertificates) {
    const identifiers = certificate.extensions?.map(extension => extension.extnID) ?? [];
    if (new Set(identifiers).size !== identifiers.length) throw new TypeError('Timestamp certificate extensions are duplicated.');
  }
  const timestamp = new TSTInfo({ schema: parseCryptoDer(new Uint8Array(signed.encapContentInfo.eContent.getValue()), 64 * 1024, 'Timestamp information') });
  if (timestamp.version !== 1 || !Number.isFinite(timestamp.genTime.getTime())) throw new TypeError('Timestamp information has an unsupported version or invalid time.');
  const accuracy = timestamp.accuracy;
  const seconds = accuracy?.seconds ?? 0, millis = accuracy?.millis ?? 0, micros = accuracy?.micros ?? 0;
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(millis) || !Number.isSafeInteger(micros)
    || (accuracy?.millis !== undefined && (millis < 1 || millis > 999)) || (accuracy?.micros !== undefined && (micros < 1 || micros > 999))) throw new TypeError('Timestamp accuracy is invalid or exceeds numeric bounds.');
  const accuracyMicroseconds = BigInt(seconds) * 1_000_000n + BigInt(millis) * 1_000n + BigInt(micros);
  const margin = Number((accuracyMicroseconds + 999n) / 1000n);
  if (!Number.isSafeInteger(margin) || Math.abs(timestamp.genTime.getTime()) + margin > 8_640_000_000_000_000) throw new TypeError('Timestamp accuracy exceeds the supported date range.');
  const signer = signed.signerInfos[0]!;
  const attributes = signer.signedAttrs?.attributes ?? [];
  if (attributes.length > 32 || attributes.some(attribute => attribute.values.length > 32) || new Set(attributes.map(attribute => attribute.type)).size !== attributes.length) throw new TypeError('Timestamp signed attributes are duplicated or exceed their bounds.');
  const contentType = attributes.find(attribute => attribute.type === '1.2.840.113549.1.9.3');
  const messageDigest = attributes.find(attribute => attribute.type === '1.2.840.113549.1.9.4');
  if (contentType?.values.length !== 1 || !(contentType.values[0] instanceof ObjectIdentifier) || contentType.values[0].valueBlock.toString() !== TST_INFO
    || messageDigest?.values.length !== 1 || !(messageDigest.values[0] instanceof OctetString)) throw new TypeError('Timestamp CMS requires unambiguous content-type and message-digest signed attributes.');
  for (let index = 0; index < chainCertificates.length; index++) for (let other = index + 1; other < chainCertificates.length; other++) {
    const left = chainCertificates[index]!, right = chainCertificates[other]!;
    if (left.issuer.isEqual(right.issuer) && left.serialNumber.isEqual(right.serialNumber)
      || !(signer.sid instanceof IssuerAndSerialNumber) && hex(new Uint8Array(left.subjectPublicKeyInfo.toSchema().toBER(false))) === hex(new Uint8Array(right.subjectPublicKeyInfo.toSchema().toBER(false)))) throw new TypeError('Timestamp signer certificate identities are ambiguous.');
  }
  const checks: { id: string; label: string; state: CheckState; detail: string }[] = [];
  const add = (id: string, label: string, state: CheckState, detail: string) => checks.push({ id, label, state, detail });
  const engine = new CryptoEngine({ name: 'offline-timestamp-review', crypto });
  const extensions = timestamp.extensions ?? [];
  if (extensions.length > 32 || new Set(extensions.map(extension => extension.extnID)).size !== extensions.length) throw new TypeError('Timestamp extensions are duplicated or exceed their count limit.');
  add('extensions', 'Token extensions', extensions.some(extension => extension.critical) ? 'unsupported' : 'matched', 'Unknown critical token extensions cannot be accepted. Non-critical extensions are not interpreted.');
  const imprintOid = timestamp.messageImprint.hashAlgorithm.algorithmId;
  const supportedImprint = Object.hasOwn(SHA2_ALGORITHMS, imprintOid);
  const imprint = supportedImprint && await timestamp.verify({ data: artifact.buffer }, engine);
  add('message_imprint', 'Artefact digest', !supportedImprint ? 'unsupported' : imprint ? 'matched' : 'mismatch', 'Compares the supplied artefact bytes with the token’s SHA-256/384/512 message imprint.');
  add('policy', 'Timestamp policy', timestamp.policy === input.expectedPolicyOid ? 'matched' : 'mismatch', 'The token policy must match the deliberately selected policy OID.');
  add('time', 'Recorded time', timestamp.genTime.getTime() + margin <= Date.parse(at) ? 'matched' : 'mismatch', 'The signed generation time and any declared accuracy interval cannot follow the review time. Certificate validity is evaluated at token generation, not today.');
  const nonce = timestamp.nonce?.valueBlock.valueHexView;
  const normalizeHex = (value: string) => value.toLowerCase().replace(/^0+/u, '') || '0';
  add('nonce', 'Request nonce', input.expectedNonceHex === undefined ? 'not_supplied'
    : nonce?.length && !(nonce[0]! & 128) && normalizeHex(hex(nonce)) === normalizeHex(input.expectedNonceHex as string) ? 'matched' : 'mismatch',
  'A supplied request nonce is checked exactly as a non-negative integer; absence is not a claim that the request was independently recovered.');
  let strength = Object.hasOwn(SHA2_ALGORITHMS, signer.digestAlgorithm.algorithmId) && SIGNATURE_ALGORITHMS.has(signer.signatureAlgorithm.algorithmId);
  for (const certificate of [...chainCertificates, ...anchors.map(anchor => anchor.certificate)]) {
    signal?.throwIfAborted();
    if (!await supportedCertificateSignature(certificate, engine)) strength = false;
  }
  add('signature_profile', 'Signature profile', strength ? 'matched' : 'unsupported', 'Supports SHA-256/384/512, RSA PKCS#1 signatures and supported ECDSA curves with RSA keys from 2048 to 8192 bits.');
  let signatureState: CheckState = imprint && strength ? 'mismatch' : 'not_checked';
  let signerCertificate: Certificate | null = null;
  try {
    if (imprint && strength) {
      const result = await signed.verify({ signer: 0, data: artifact.buffer, checkChain: false, extendedMode: true }, engine);
      if (typeof result === 'object') { signerCertificate = result.signerCertificate ?? null; signatureState = result.signatureVerified ? 'matched' : 'mismatch'; }
    }
  } catch (error) { if (error instanceof SignedDataVerifyError) signerCertificate = error.signerCertificate; }
  add('signature', 'Token signature', signatureState, 'Checks the unchanged CMS token and signed attributes. A failed artefact imprint or unsupported profile prevents a signature-pass claim.');
  let binding: CheckState = 'not_checked';
  if (signerCertificate && content.content instanceof Sequence) {
    const certificateSet = content.content.valueBlock.value.find(value => value.idBlock.tagClass === 3 && value.idBlock.tagNumber === 0);
    const raw = certificateSet instanceof Constructed ? certificateSet.valueBlock.value[chainCertificates.indexOf(signerCertificate)]?.valueBeforeDecodeView : undefined;
    binding = raw?.length ? await signingCertificateBinding(signer.signedAttrs, signerCertificate, new Uint8Array(raw)) : 'mismatch';
  }
  add('signer_binding', 'Signer certificate binding', binding, 'Checks the first and sole SHA-256/384/512 ESSCertIDv2 certificate reference, including issuer and serial when present. Legacy-only or additional policy/reference profiles remain unsupported.');
  const hint = timestamp.tsa;
  const alternatives = signerCertificate?.extensions?.find(extension => extension.extnID === '2.5.29.17')?.parsedValue;
  const hintEncoded = hint ? encodedName(hint) : null;
  const hintMatches = signerCertificate && hint && (hint.type === 4 && hint.value instanceof RelativeDistinguishedNames && hint.value.isEqual(signerCertificate.subject)
    || hintEncoded !== null && alternatives instanceof AltName && alternatives.altNames.some(name => encodedName(name) === hintEncoded));
  add('tsa_hint', 'Signer name hint', !hint ? 'not_supplied' : !signerCertificate ? 'not_checked' : hintMatches ? 'matched' : 'mismatch', 'A supplied TSA name hint must match the selected signer’s subject or subject alternative names; it is not used as a trust anchor.');
  const purpose = signerCertificate?.extensions?.find(extension => extension.extnID === '2.5.29.37');
  const eku = purpose?.parsedValue;
  const basic = signerCertificate?.extensions?.find(extension => extension.extnID === '2.5.29.19')?.parsedValue;
  add('purpose', 'Timestamp signer purpose', !signerCertificate ? 'not_checked'
    : purpose?.critical === true && eku instanceof ExtKeyUsage && eku.keyPurposes.length === 1 && eku.keyPurposes[0] === TIMESTAMP_PURPOSE_OID
      && !(basic instanceof BasicConstraints && basic.cA) ? 'matched' : 'mismatch',
  'The signer must be an end-entity certificate with critical, sole time-stamping extended key usage.');
  const validAnchors = anchors.every(anchor => anchor.certificate.extensions?.some(extension => extension.extnID === '2.5.29.19' && extension.parsedValue instanceof BasicConstraints && extension.parsedValue.cA));
  let pathValid = false;
  if (signerCertificate && validAnchors) {
    try {
      const chain = new CertificateChainValidationEngine({ trustedCerts: anchors.map(anchor => anchor.certificate),
        certs: [...chainCertificates.filter(certificate => certificate !== signerCertificate), signerCertificate], checkDate: timestamp.genTime });
      pathValid = (await chain.verify({ passedWhenNotRevValues: true }, engine)).result;
      if (accuracy && chainCertificates.some(certificate => certificate.notBefore.value.getTime() > timestamp.genTime.getTime() - margin
        || certificate.notAfter.value.getTime() < timestamp.genTime.getTime() + margin)) pathValid = false;
    } catch { /* No ambient roots, issuer retrieval or transport fallback. */ }
  }
  add('certification_path', 'Selected trust anchors', !signerCertificate ? 'not_checked' : pathValid ? 'matched' : 'mismatch', 'Checks the signer path against only selected CA anchors at the signed generation time.');
  const embeddedCrls = signed.crls ?? [];
  if (embeddedCrls.length > 6 || (signed.ocsps?.length ?? 0) > 6) throw new TypeError('Embedded revocation material exceeds its count limit.');
  const crls = [...embeddedCrls.filter((crl): crl is CertificateRevocationList => crl instanceof CertificateRevocationList),
    ...suppliedCrlBytes.map(raw => new CertificateRevocationList({ schema: parseCryptoDer(raw, MAX_TIMESTAMP_CERTIFICATE_BYTES, 'Selected CRL DER') }))];
  if (crls.length > 6) throw new TypeError('The combined revocation material exceeds its count limit.');
  const unsupportedRevocation = Boolean(signed.ocsps?.length) || embeddedCrls.some(crl => !(crl instanceof CertificateRevocationList))
    || crls.some(crl => crl.crlExtensions?.extensions.some(extension => extension.critical || ['2.5.29.27', '2.5.29.28'].includes(extension.extnID))
      || !['SHA-256', 'SHA-384', 'SHA-512'].includes(engine.getHashAlgorithm(crl.signatureAlgorithm)));
  const currentCrls = crls.filter(crl => crl.thisUpdate.value.getTime() <= timestamp.genTime.getTime() - margin
    && crl.nextUpdate && crl.nextUpdate.value.getTime() >= timestamp.genTime.getTime() + margin);
  let revocation: CheckState = unsupportedRevocation ? 'unsupported' : crls.length ? 'not_checked' : 'not_supplied';
  if (!unsupportedRevocation && crls.length && pathValid && signerCertificate) {
    try {
      const chain = new CertificateChainValidationEngine({ trustedCerts: anchors.map(anchor => anchor.certificate),
        certs: [...chainCertificates.filter(certificate => certificate !== signerCertificate), signerCertificate], checkDate: timestamp.genTime, crls: currentCrls });
      revocation = currentCrls.length && (await chain.verify({ passedWhenNotRevValues: false }, engine)).result ? 'matched' : 'mismatch';
    } catch { revocation = 'mismatch'; }
  }
  add('revocation', 'Supplied revocation evidence', revocation, 'Only bounded X.509 CRLs are supported. A complete non-revocation result must validate at token generation; absent, stale or unsupported material is not a clean status.');
  signal?.throwIfAborted();
  return Object.freeze({ schema: TIMESTAMP_TOKEN_REVIEW_SCHEMA, version: TIMESTAMP_TOKEN_VERSION, reviewedAt: at,
    state: checks.every(check => check.state === 'matched' || ['nonce', 'tsa_hint'].includes(check.id) && check.state === 'not_supplied') ? 'checks_passed' as const : 'review_required' as const,
    artifact: { byteLength: artifact.length, digestSha256: await sha256(artifact) }, tokenSha256: await sha256(rawToken),
    generatedAt: timestamp.genTime.toISOString(), declaredAccuracyMicroseconds: accuracy ? accuracyMicroseconds.toString() : null,
    policyOid: timestamp.policy, selectedAnchorDigests: await Promise.all(anchors.map(anchor => sha256(anchor.raw))),
    checks, networkRequestsMade: false,
    limitations: ['Trust is limited to the selected policy, CA anchors and supplied revocation evidence. No operating-system trust store, issuer, timestamp-authority, CRL or OCSP request is made.',
      'This checks the token’s binding to the selected bytes and declared time, not the truth of their contents, current trust-store acceptance or a legal outcome. Original material is not copied into the report.'] });
}
