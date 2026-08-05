import {
  enumValue,
  exactKeys,
  requireBoundedString,
  requireIsoTimestamp,
  requireRecord,
} from './bounded-contract-normalizers.mts';

export const TRUST_STORE_COMPARISON_INPUT_SCHEMA = 'whoisleuth.trust-store-comparison.input';
export const TRUST_STORE_COMPARISON_REVIEW_SCHEMA = 'whoisleuth.trust-store-comparison.review';
export const TRUST_STORE_COMPARISON_REVIEW_VERSION = 1;
export const MAX_TRUST_STORE_COMPARISON_STORES = 16;
export const MAX_TRUST_STORE_ANCHORS = 2_048;
export const MAX_TRUST_STORE_CHAIN_CERTIFICATES = 16;

type EvidenceState = 'observed' | 'partial' | 'unavailable';
type RuntimeAuthorisation = 'authorised' | 'unauthorised' | 'unknown';

const ROOT_KEYS = new Set(['schema', 'version', 'certificate', 'stores']);
const CERTIFICATE_KEYS = new Set([
  'source', 'observedAt', 'state', 'chainTruncated',
  'fingerprintsSha256', 'runtimeAuthorisation',
]);
const STORE_KEYS = new Set(['name', 'version', 'source', 'reviewedAt', 'state', 'anchorsSha256']);
const EVIDENCE_STATES = new Set<EvidenceState>(['observed', 'partial', 'unavailable']);
const RUNTIME_AUTHORISATION = new Set<RuntimeAuthorisation>(['authorised', 'unauthorised', 'unknown']);
const SHA256_RE = /^[a-f0-9]{64}$/u;

function digest(value: unknown, label: string): string {
  const normalised = requireBoundedString(value, label, 64).toLowerCase();
  if (!SHA256_RE.test(normalised)) throw new TypeError(`${label} must be a SHA-256 hexadecimal digest.`);
  return normalised;
}

function digests(value: unknown, label: string, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must contain no more than ${maximum} SHA-256 digests.`);
  }
  return Object.freeze([...new Set(value.map((entry, index) => digest(entry, `${label}[${index}]`)))].sort());
}

export function compareTrustStoreEvidence(inputRaw: unknown, generatedAtValue = new Date().toISOString()) {
  const input = requireRecord(inputRaw, 'Trust-store comparison input');
  if (input.schema !== TRUST_STORE_COMPARISON_INPUT_SCHEMA || input.version !== 1) {
    throw new TypeError(`Trust-store comparison input must use ${TRUST_STORE_COMPARISON_INPUT_SCHEMA} version 1.`);
  }
  exactKeys(input, ROOT_KEYS, 'Trust-store comparison input');
  const certificateInput = requireRecord(input.certificate, 'certificate');
  exactKeys(certificateInput, CERTIFICATE_KEYS, 'certificate');
  const certificateState = enumValue(certificateInput.state, EVIDENCE_STATES, 'certificate.state');
  if (typeof certificateInput.chainTruncated !== 'boolean') throw new TypeError('certificate.chainTruncated must be a Boolean.');
  const certificateFingerprints = digests(
    certificateInput.fingerprintsSha256,
    'certificate.fingerprintsSha256',
    MAX_TRUST_STORE_CHAIN_CERTIFICATES,
  );
  if (certificateState === 'unavailable' && certificateFingerprints.length) {
    throw new TypeError('An unavailable certificate observation cannot contain fingerprints.');
  }
  if (certificateState !== 'unavailable' && !certificateFingerprints.length) {
    throw new TypeError('An observed or partial certificate observation requires at least one fingerprint.');
  }
  const certificate = Object.freeze({
    source: requireBoundedString(certificateInput.source, 'certificate.source', 240),
    observedAt: requireIsoTimestamp(certificateInput.observedAt, 'certificate.observedAt'),
    state: certificateState,
    chainTruncated: certificateInput.chainTruncated,
    leafSha256: certificateFingerprints[0] ?? null,
    fingerprintsSha256: certificateFingerprints,
    runtimeAuthorisation: enumValue(
      certificateInput.runtimeAuthorisation,
      RUNTIME_AUTHORISATION,
      'certificate.runtimeAuthorisation',
    ),
  });

  if (!Array.isArray(input.stores) || input.stores.length < 1 || input.stores.length > MAX_TRUST_STORE_COMPARISON_STORES) {
    throw new TypeError(`stores must contain between 1 and ${MAX_TRUST_STORE_COMPARISON_STORES} entries.`);
  }
  const storeKeys = new Set<string>();
  const stores = input.stores.map((raw, index) => {
    const store = requireRecord(raw, `stores[${index}]`);
    exactKeys(store, STORE_KEYS, `stores[${index}]`);
    const name = requireBoundedString(store.name, `stores[${index}].name`, 120);
    const version = requireBoundedString(store.version, `stores[${index}].version`, 120);
    const key = `${name}\u0000${version}`;
    if (storeKeys.has(key)) throw new TypeError(`stores[${index}] repeats a store name and version.`);
    storeKeys.add(key);
    const storeState = enumValue(store.state, EVIDENCE_STATES, `stores[${index}].state`);
    const anchors = digests(store.anchorsSha256, `stores[${index}].anchorsSha256`, MAX_TRUST_STORE_ANCHORS);
    if (storeState === 'unavailable' && anchors.length) throw new TypeError(`stores[${index}] cannot contain anchors when unavailable.`);
    if (storeState === 'observed' && !anchors.length) throw new TypeError(`stores[${index}] requires at least one anchor when observed.`);
    return Object.freeze({
      name,
      version,
      source: requireBoundedString(store.source, `stores[${index}].source`, 240),
      reviewedAt: requireIsoTimestamp(store.reviewedAt, `stores[${index}].reviewedAt`),
      state: storeState,
      anchors,
    });
  }).sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

  const chainSet = new Set(certificate.fingerprintsSha256);
  const comparisons = stores.map((store) => {
    const matchedAnchorSha256 = store.anchors.filter((anchor) => chainSet.has(anchor));
    const completeInputs = certificate.state === 'observed'
      && certificate.chainTruncated === false
      && store.state === 'observed';
    const state = matchedAnchorSha256.length
      ? 'anchor_observed' as const
      : completeInputs
        ? 'not_observed' as const
        : 'inconclusive' as const;
    return Object.freeze({
      store: Object.freeze({
        name: store.name,
        version: store.version,
        source: store.source,
        reviewedAt: store.reviewedAt,
        state: store.state,
        anchorCount: store.anchors.length,
      }),
      state,
      matchedAnchorSha256: Object.freeze(matchedAnchorSha256),
      explanation: state === 'anchor_observed'
        ? 'At least one supplied chain fingerprint exactly matched a supplied trust-anchor fingerprint.'
        : state === 'not_observed'
          ? 'No supplied chain fingerprint matched this complete supplied trust-store snapshot.'
          : 'Certificate-chain or trust-store evidence was incomplete or unavailable, so non-observation cannot be established.',
    });
  });
  const incomplete = certificate.state !== 'observed'
    || certificate.chainTruncated
    || stores.some((store) => store.state !== 'observed');
  return Object.freeze({
    schema: TRUST_STORE_COMPARISON_REVIEW_SCHEMA,
    version: TRUST_STORE_COMPARISON_REVIEW_VERSION,
    generatedAt: requireIsoTimestamp(generatedAtValue, 'generatedAt'),
    state: incomplete ? 'partial' as const : 'complete' as const,
    certificate: Object.freeze({
      source: certificate.source,
      observedAt: certificate.observedAt,
      state: certificate.state,
      chainTruncated: certificate.chainTruncated,
      leafSha256: certificate.leafSha256,
      chainFingerprintCount: certificate.fingerprintsSha256.length,
      runtimeAuthorisation: certificate.runtimeAuthorisation,
    }),
    comparisons: Object.freeze(comparisons),
    counts: Object.freeze({
      stores: comparisons.length,
      anchorObserved: comparisons.filter((comparison) => comparison.state === 'anchor_observed').length,
      notObserved: comparisons.filter((comparison) => comparison.state === 'not_observed').length,
      inconclusive: comparisons.filter((comparison) => comparison.state === 'inconclusive').length,
    }),
    limitations: Object.freeze([
      'This local comparison uses only supplied SHA-256 fingerprints and makes no TLS, certificate-authority, operating-system, or trust-store request.',
      'An exact anchor fingerprint intersection does not build or validate a certificate path, check signatures, names, validity, constraints, revocation, policy, or application-specific trust.',
      'A complete supplied chain can omit its root certificate. A not-observed result therefore does not mean the runtime, browser, operating system, or another client would reject the certificate.',
      'Trust stores differ by product, platform, version, policy, update state, and local administration. The analyst-supplied source and version remain part of every comparison.',
      'Runtime authorisation is preserved as separate context and is not overridden by this fingerprint comparison.',
    ]),
  });
}
