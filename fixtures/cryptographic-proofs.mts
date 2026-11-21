import 'reflect-metadata';
import { createHash, sign, KeyObject } from 'node:crypto';
import { X509CertificateGenerator, BasicConstraintsExtension, KeyUsagesExtension, KeyUsageFlags, ExtendedKeyUsageExtension } from '@peculiar/x509';
import { fromBER, Integer, ObjectIdentifier, OctetString, Sequence } from 'asn1js';
import { Certificate, CertificateRevocationList, CryptoEngine, ContentInfo, EncapsulatedContentInfo, TSTInfo, MessageImprint, AlgorithmIdentifier,
  Attribute, SignerInfo, IssuerAndSerialNumber, SignedAndUnsignedAttributes, SignedData, RevokedCertificate, Time, Accuracy, GeneralName } from 'pkijs';
import { CT_INCLUSION_INPUT_SCHEMA, CT_INCLUSION_VERSION } from '../packages/contracts/ct-inclusion-proof.mts';
import { TIMESTAMP_TOKEN_INPUT_SCHEMA, TIMESTAMP_TOKEN_VERSION, TIMESTAMP_PURPOSE_OID } from '../packages/contracts/timestamp-token.mts';

export const PROOF_REVIEW_TIME = '2026-11-01T00:00:00.000Z';
const ecKeys = crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
let rsaKeys: Promise<CryptoKeyPair> | undefined;
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest();
const hashLeaf = (value: Uint8Array) => digest(Buffer.concat([Buffer.from([0]), value]));
const hashPair = (left: Uint8Array, right: Uint8Array) => digest(Buffer.concat([Buffer.from([1]), left, right]));

// Independent recursive tree construction for synthetic test/example material.
function tree(leaves: readonly Buffer[]): Buffer {
  if (leaves.length === 1) return hashLeaf(leaves[0]!);
  const split = 2 ** Math.floor(Math.log2(leaves.length - 1));
  return hashPair(tree(leaves.slice(0, split)), tree(leaves.slice(split)));
}
function path(leaves: readonly Buffer[], index: number): Buffer[] {
  if (leaves.length === 1) return [];
  const split = 2 ** Math.floor(Math.log2(leaves.length - 1));
  return index < split ? [...path(leaves.slice(0, split), index), tree(leaves.slice(split))]
    : [...path(leaves.slice(split), index - split), tree(leaves.slice(0, split))];
}

export async function ctInclusionFixture(options: Readonly<{ size?: number; index?: number; rsa?: boolean; headAt?: string; precertificate?: boolean }> = {}) {
  const size = options.size ?? 3, index = options.index ?? 2;
  if (!Number.isInteger(size) || size < 1 || size > 8 || index < 0 || index >= size) throw new TypeError('Choose a valid small synthetic tree.');
  const certificateKeys = await ecKeys;
  const at = Date.parse(PROOF_REVIEW_TIME);
  const certificate = await X509CertificateGenerator.createSelfSigned({ name: 'CN=Example Certificate', serialNumber: '01', keys: certificateKeys,
    notBefore: new Date(at - 86_400_000), notAfter: new Date(at + 86_400_000), signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' } }, crypto);
  const certificateBytes = Buffer.from(certificate.rawData);
  const certificateSchema = fromBER(certificate.rawData).result;
  if (!(certificateSchema instanceof Sequence)) throw new TypeError('Synthetic certificate must be a sequence.');
  const entry = options.precertificate ? Buffer.from(certificateSchema.valueBlock.value[0]!.valueBeforeDecodeView) : certificateBytes;
  const issuerKeyHash = digest(new Uint8Array(await crypto.subtle.exportKey('spki', certificateKeys.publicKey)));
  const leaves = Array.from({ length: size }, (_, position) => {
    const prefix = Buffer.alloc(options.precertificate ? 47 : 15);
    prefix.writeBigUInt64BE(BigInt(at - 1000 + position), 2);
    if (options.precertificate) { prefix.writeUInt16BE(1, 10); issuerKeyHash.copy(prefix, 12); }
    prefix.writeUIntBE(entry.length, options.precertificate ? 44 : 12, 3);
    return Buffer.concat([prefix, entry, Buffer.alloc(2)]);
  });
  const keys = options.rsa ? await (rsaKeys ??= crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) : certificateKeys;
  const publicKey = Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey));
  const root = tree(leaves), timestamp = Date.parse(options.headAt ?? PROOF_REVIEW_TIME);
  const signedBytes = Buffer.alloc(50);
  signedBytes[1] = 1; signedBytes.writeBigUInt64BE(BigInt(timestamp), 2); signedBytes.writeBigUInt64BE(BigInt(size), 10); root.copy(signedBytes, 18);
  const signature = sign('sha256', signedBytes, KeyObject.from(keys.privateKey));
  const signaturePrefix = Buffer.from([4, options.rsa ? 1 : 3, signature.length >> 8, signature.length & 255]);
  return { schema: CT_INCLUSION_INPUT_SCHEMA, version: CT_INCLUSION_VERSION, protocol: 'rfc6962-v1',
    leafInputBase64: leaves[index]!.toString('base64'), leafIndex: index, auditPath: path(leaves, index).map(value => value.toString('base64')),
    signedTreeHead: { tree_size: size, timestamp, sha256_root_hash: root.toString('base64'), tree_head_signature: Buffer.concat([signaturePrefix, signature]).toString('base64') },
    logKeySpkiBase64: publicKey.toString('base64'), logIdBase64: digest(publicKey).toString('base64') };
}

const timestampKeys = Promise.all([0, 1, 2].map(() => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])));
export const TIMESTAMP_EXAMPLE_POLICY = '1.3.6.1.4.1.32473.1';

/** Real synthetic CMS, certificate and CRL signatures, with a fixed evidence clock. */
export async function timestampTokenFixture(options: Readonly<{ revoked?: boolean; staleCrl?: boolean; futureCrl?: boolean;
  purpose?: string; generatedAt?: string; wrongBinding?: boolean; accuracySeconds?: number; tsaHint?: boolean; otherAuthority?: boolean }> = {}) {
  const [firstCa, signer, otherCa] = await timestampKeys;
  const ca = options.otherAuthority ? otherCa : firstCa;
  const at = Date.parse(PROOF_REVIEW_TIME), day = 86_400_000;
  const root = await X509CertificateGenerator.createSelfSigned({ name: 'CN=Example Timestamp Root', serialNumber: '01', keys: ca!,
    notBefore: new Date(at - 365 * day), notAfter: new Date(at + 365 * day), signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [new BasicConstraintsExtension(true, 1, true), new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true)] }, crypto);
  const leaf = await X509CertificateGenerator.create({ subject: 'CN=Example Timestamp Signer', issuer: root.subject, publicKey: signer!.publicKey, signingKey: ca!.privateKey,
    serialNumber: '02', notBefore: new Date(at - 30 * day), notAfter: new Date(at + 30 * day), signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [new BasicConstraintsExtension(false, undefined, true), new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      new ExtendedKeyUsageExtension([options.purpose ?? TIMESTAMP_PURPOSE_OID], true)] }, crypto);
  const issuer = new Certificate({ schema: fromBER(root.rawData).result }), certificate = new Certificate({ schema: fromBER(leaf.rawData).result });
  const artifact = Buffer.from('Synthetic retained evidence\n');
  const info = new TSTInfo({ version: 1, policy: TIMESTAMP_EXAMPLE_POLICY,
    messageImprint: new MessageImprint({ hashAlgorithm: new AlgorithmIdentifier({ algorithmId: '2.16.840.1.101.3.4.2.1' }),
      hashedMessage: new OctetString({ valueHex: new Uint8Array(digest(artifact)).buffer }) }),
    serialNumber: new Integer({ value: 1 }), genTime: new Date(options.generatedAt ?? '2026-10-31T23:59:00.000Z'), nonce: new Integer({ value: 23 }),
    ...(options.accuracySeconds === undefined ? {} : { accuracy: new Accuracy({ seconds: options.accuracySeconds }) }),
    ...(options.tsaHint ? { tsa: new GeneralName({ type: 4, value: certificate.subject }) } : {}) });
  const encoded = info.toSchema().toBER(false), engine = new CryptoEngine({ name: 'synthetic-timestamp', crypto });
  const signed = new SignedData({ version: 3, certificates: [certificate, issuer],
    encapContentInfo: new EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.9.16.1.4', eContent: new OctetString({ valueHex: encoded }) }),
    signerInfos: [new SignerInfo({ version: 1, sid: new IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }),
      signedAttrs: new SignedAndUnsignedAttributes({ type: 0, attributes: [
        new Attribute({ type: '1.2.840.113549.1.9.3', values: [new ObjectIdentifier({ value: '1.2.840.113549.1.9.16.1.4' })] }),
        new Attribute({ type: '1.2.840.113549.1.9.4', values: [new OctetString({ valueHex: new Uint8Array(digest(new Uint8Array(encoded))).buffer })] }),
        new Attribute({ type: '1.2.840.113549.1.9.16.2.47', values: [new Sequence({ value: [new Sequence({ value: [new Sequence({ value: [
          new OctetString({ valueHex: options.wrongBinding ? new Uint8Array(32).buffer : new Uint8Array(digest(new Uint8Array(leaf.rawData))).buffer }),
        ] })] })] })] }),
      ] }) })] });
  await signed.sign(signer!.privateKey, 0, 'SHA-256', undefined, engine);
  const token = new ContentInfo({ contentType: ContentInfo.SIGNED_DATA, content: signed.toSchema(true) }).toSchema().toBER(false);
  const crl = new CertificateRevocationList({ version: 1, issuer: issuer.subject,
    thisUpdate: new Time({ type: 0, value: new Date(options.futureCrl ? at + day : at - day) }),
    nextUpdate: new Time({ type: 0, value: new Date(options.staleCrl ? at - 2 * day : at + 7 * day) }),
    ...(options.revoked ? { revokedCertificates: [new RevokedCertificate({ userCertificate: certificate.serialNumber,
      revocationDate: new Time({ type: 0, value: new Date(at - day) }) })] } : {}) });
  await crl.sign(ca!.privateKey, 'SHA-256', engine);
  return { schema: TIMESTAMP_TOKEN_INPUT_SCHEMA, version: TIMESTAMP_TOKEN_VERSION, artifactBase64: artifact.toString('base64'), tokenDerBase64: Buffer.from(token).toString('base64'),
    trustAnchorsPem: root.toString('pem'), expectedPolicyOid: TIMESTAMP_EXAMPLE_POLICY, expectedNonceHex: '17',
    crlsDerBase64: [Buffer.from(crl.toSchema(true).toBER(false)).toString('base64')] };
}
