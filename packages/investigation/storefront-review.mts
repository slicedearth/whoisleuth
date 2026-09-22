import { array, boolean, domain, enumeration, exact, HEX_DIGEST_RE, iso, text } from '../evidence/artifact-structure.mts';
import { pageObservationOrigin } from './page-behaviour.mts';
import { CONTEXT_REVIEW_SCHEMA, CONTEXT_REVIEW_VERSION, MAX_CONTEXT_RECORDS, type ContextObservation, type ContextReview } from '../contracts/context-review.mts';

export { STOREFRONT_INPUT_SCHEMA, STOREFRONT_INPUT_VERSION } from '../contracts/context-review.mts';
export const STOREFRONT_FIELDS = [
  { id: 'brandNames', label: 'Displayed brand names', treatment: 'text' },
  { id: 'contactDomains', label: 'Published contact domains', treatment: 'domain' },
  { id: 'policyHashes', label: 'Policy text SHA-256 digests', treatment: 'hash' },
  { id: 'checkoutOrigins', label: 'Checkout destinations', treatment: 'origin' },
  { id: 'paymentMethods', label: 'Advertised payment methods', treatment: 'text' },
  { id: 'assetHashes', label: 'Distinctive asset SHA-256 digests', treatment: 'hash' },
] as const;
export type StorefrontField = typeof STOREFRONT_FIELDS[number]['id'];
export type StorefrontObservation = Readonly<{ hostname: string; observedAt: string; source: string }> & Readonly<Record<StorefrontField, readonly string[] | null>>;

export function readStorefrontObservation(raw: unknown): StorefrontObservation {
  const row = exact(raw, ['hostname', 'observedAt', 'source', ...STOREFRONT_FIELDS.map(field => field.id)], 'Storefront observation');
  domain(row.hostname, 'Storefront hostname'); iso(row.observedAt, 'Storefront observation time');
  const fields = {} as Record<StorefrontField, string[] | null>;
  let count = 0;
  for (const field of STOREFRONT_FIELDS) {
    if (row[field.id] === null) { fields[field.id] = null; continue; }
    const values = array(row[field.id], field.label, MAX_CONTEXT_RECORDS);
    count += values.length;
    if (count > MAX_CONTEXT_RECORDS) throw new TypeError('A storefront observation exceeds the aggregate evidence-item bound.');
    fields[field.id] = [...new Set(values.map(value => {
      const candidate = text(value, field.label, 500);
      if (field.treatment === 'domain') domain(candidate, field.label);
      if (field.treatment === 'hash' && !HEX_DIGEST_RE.test(candidate)) throw new TypeError('Storefront digests must be lowercase hexadecimal SHA-256.');
      if (field.treatment === 'origin' && pageObservationOrigin(candidate) !== candidate) throw new TypeError('Checkout observations retain HTTP(S) origins only.');
      return candidate;
    }))].sort();
  }
  return { hostname: row.hostname as string, observedAt: row.observedAt as string, source: text(row.source, 'Storefront source', 500), ...fields };
}

export function reviewStorefront(raw: unknown, reviewedAt: string): ContextReview {
  iso(reviewedAt, 'Review time');
  const input = exact(raw, ['official', 'candidate', 'authorisedComparator', 'resellerStatus', 'resellerSource'], 'Storefront comparison');
  boolean(input.authorisedComparator, 'Comparator authority');
  if (!input.authorisedComparator) throw new TypeError('Confirm that the official comparator is owned or authorised for this review.');
  const official = readStorefrontObservation(input.official), candidate = readStorefrontObservation(input.candidate);
  if (official.hostname === candidate.hostname) throw new TypeError('Select a different candidate hostname for storefront comparison.');
  const reseller = enumeration(input.resellerStatus, ['authorised', 'not_authorised', 'unknown'] as const, 'Reseller status');
  const resellerSource = input.resellerSource === null ? null : text(input.resellerSource, 'Reseller evidence', 500);
  if (reseller !== 'unknown' && !resellerSource) throw new TypeError('A reseller-status declaration needs its source or authority reference.');
  const observations: ContextObservation[] = [];
  let missing = 0;
  for (const field of STOREFRONT_FIELDS) {
    const left = official[field.id], right = candidate[field.id];
    if (left === null || right === null) missing++;
    const shared = left && right ? right.filter(value => left.includes(value)) : [];
    observations.push({ label: field.label, state: left === null || right === null ? 'unknown' : 'observed',
      detail: `Official: ${left === null ? 'not reviewed' : left.length ? left.join(', ') : 'no values recorded'}. Candidate: ${right === null ? 'not reviewed' : right.length ? right.join(', ') : 'no values recorded'}. ${left !== null && right !== null ? `${shared.length} exact shared values.` : 'No comparison established.'}`,
      source: `${official.hostname} · ${official.source} · ${official.observedAt} / ${candidate.hostname} · ${candidate.source}`, observedAt: candidate.observedAt, hostname: candidate.hostname });
  }
  observations.push({ label: 'Reseller or affiliate authority', state: reseller === 'unknown' ? 'unknown' : 'reported', detail: reseller.replaceAll('_', ' '), source: resellerSource ?? 'No authority evidence supplied', observedAt: null, hostname: candidate.hostname });
  return { schema: CONTEXT_REVIEW_SCHEMA, version: CONTEXT_REVIEW_VERSION, kind: 'storefront', reviewedAt, title: 'Storefront comparison', state: missing ? 'partial' : 'reviewed',
    summary: `${candidate.hostname} compared with the authorised reference ${official.hostname}; ${missing} evidence categories lack one side.`, observations,
    nextSteps: ['Check reseller, affiliate and regional-store authority before preparing a complaint.', 'Retain the source pages and distinctive assets privately; select relevant findings in the Case response packet.', 'Use the observed checkout platform and the rights or policy evidence to choose a reporting route. Do not enter payment information or submit an order.'],
    limitations: ['This compares analyst-supplied observations. It does not collect a page, verify a merchant, submit a payment or issue a scam score.', 'Shared wording, assets and payment providers can have legitimate explanations. Digests establish byte equality only when inputs were captured consistently; missing observations do not establish absence.'] };
}
