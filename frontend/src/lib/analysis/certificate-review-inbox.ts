import { buildBrandCertificateEventReplay } from './brand-certificate-event-replay.ts';
import type { BrandProfile, DesiredPostureBaseline } from './brand-profile-model.ts';
import type { CaseRecord } from './case-model.ts';
import { certificateSanPatternMatches } from './certificate-policy-review.ts';
import {
  MAX_ANALYST_REVIEW_ITEMS,
  analystReviewMaterialFingerprint,
  analystReviewSubjectKey,
  type AnalystReviewCompleteness,
  type AnalystReviewItem,
} from './analyst-review-state.ts';

export const CERTIFICATE_REVIEW_INBOX_VERSION = 1;
export const MAX_CERTIFICATE_REVIEW_FINDINGS = MAX_ANALYST_REVIEW_ITEMS;
export const CERTIFICATE_EXPIRY_REVIEW_DAYS = 30;

export type CertificateEvidenceClass = 'certificate_transparency' | 'live_tls' | 'caa' | 'certificate_digest' | 'spki';
export type CertificateReviewFindingKind =
  | 'expected_observation'
  | 'expected_renewal'
  | 'renewal'
  | 'retained_certificate_digest'
  | 'unexpected_issuer'
  | 'unexpected_key'
  | 'unexpected_san'
  | 'unexpected_wildcard'
  | 'unexpected_caa'
  | 'expiry'
  | 'expired_acknowledgement'
  | 'live_unavailable'
  | 'historical_ct_no_deployment';
export type CertificateReviewFindingState = 'expected' | 'review' | 'partial' | 'unavailable' | 'expired';

export type CertificateReviewFinding = Readonly<{
  id: string;
  profileId: string;
  profileName: string;
  domain: string;
  kind: CertificateReviewFindingKind;
  state: CertificateReviewFindingState;
  evidenceClass: CertificateEvidenceClass;
  label: string;
  detail: string;
  observedAt: string;
  notAfter: string | null;
  certificateSha256: string | null;
  spkiSha256: string | null;
  sources: readonly string[];
  limitations: readonly string[];
  item: AnalystReviewItem;
}>;

export type CertificateReviewInbox = Readonly<{
  version: typeof CERTIFICATE_REVIEW_INBOX_VERSION;
  findings: readonly CertificateReviewFinding[];
  profileCount: number;
  domainCount: number;
  truncated: boolean;
  limitations: readonly string[];
}>;

type RetainedFact = Readonly<{
  value: string;
  observedAt: string;
  source: string;
  completeness: AnalystReviewCompleteness;
  caseId: string;
  limitations: readonly string[];
}>;
type RetainedFactIndex = ReadonlyMap<string, RetainedFact>;

const SHA256_RE = /^[a-f0-9]{64}$/iu;
const INCOMPLETE_SOURCE_STATES = new Set([
  'blocked',
  'conflict',
  'conflicting',
  'error',
  'failed',
  'partial',
  'rate_limited',
  'skipped',
  'unavailable',
  'unsupported',
]);

function age(observedAt: string, now: string): AnalystReviewItem['age'] {
  const days = Math.max(0, Date.parse(now) - Date.parse(observedAt)) / 86_400_000;
  return days > 30 ? 'stale' : days > 7 ? 'aging' : 'current';
}

function baseline(profile: BrandProfile, domain: string): DesiredPostureBaseline | null {
  return profile.desiredPostureBaselines.find((candidate) => candidate.domain === domain) ?? null;
}

function retainedFactKey(domain: string, field: string): string {
  return `${domain}\u0000${field.toLowerCase()}`;
}

function fieldValueIsUsable(field: string, value: string): boolean {
  if (['tls.certificate_sha256', 'tls.spki_sha256', 'tls.spkisha256', 'tls.public_key_sha256'].includes(field)) {
    return SHA256_RE.test(value);
  }
  if (field === 'tls.valid_to') return Number.isFinite(Date.parse(value));
  return value.trim().length > 0;
}

function retainedFactOrder(left: RetainedFact, right: RetainedFact): number {
  return right.observedAt.localeCompare(left.observedAt)
    || left.caseId.localeCompare(right.caseId)
    || left.source.localeCompare(right.source)
    || left.value.localeCompare(right.value);
}

function buildRetainedFactIndex(records: readonly CaseRecord[]): RetainedFactIndex {
  const fields = new Set([
    'dns.caa',
    'tls.certificate_sha256',
    'tls.issuer',
    'tls.public_key_sha256',
    'tls.san_dns_names',
    'tls.spki_sha256',
    'tls.spkisha256',
    'tls.valid_to',
  ]);
  const output = new Map<string, RetainedFact>();
  for (const record of records) {
    for (const pin of record.evidencePins) {
      const field = pin.field?.toLowerCase() ?? '';
      if (!fields.has(field) || !fieldValueIsUsable(field, pin.value)) continue;
      const sourceState = pin.sourceState?.toLowerCase().replace(/[\s-]+/gu, '_') ?? '';
      const completeness: AnalystReviewCompleteness = pin.truncated === true
        || pin.completeness === 'partial'
        || sourceState === 'partial'
        ? 'partial'
        : pin.completeness === 'complete' && !INCOMPLETE_SOURCE_STATES.has(sourceState)
          ? 'complete'
          : 'inconclusive';
      const candidate: RetainedFact = {
        value: pin.value,
        observedAt: pin.observedAt,
        source: pin.source,
        completeness,
        caseId: record.id,
        limitations: pin.limitations,
      };
      const key = retainedFactKey(record.domain, field);
      const existing = output.get(key);
      if (!existing || retainedFactOrder(candidate, existing) < 0) output.set(key, candidate);
    }
  }
  return output;
}

function retainedFact(
  index: RetainedFactIndex,
  domain: string,
  fields: readonly string[],
): RetainedFact | null {
  const candidates = fields
    .flatMap((field) => {
      const candidate = index.get(retainedFactKey(domain, field));
      return candidate ? [candidate] : [];
    })
    .sort(retainedFactOrder);
  return candidates[0] ?? null;
}

function retainedValues(value: string): string[] {
  return [...new Set(value
    .split(' · ')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))]
    .sort();
}

function exactSetMatch(left: readonly string[], right: readonly string[]): boolean {
  const leftValues = [...new Set(left.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort();
  const rightValues = [...new Set(right.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort();
  return leftValues.length === rightValues.length
    && leftValues.every((item, index) => item === rightValues[index]);
}

function changeWindowAt(desired: DesiredPostureBaseline, observedAt: string) {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return null;
  return desired.approvedChangeWindows.find((window) => (
    Date.parse(window.startsAt) <= observed && observed <= Date.parse(window.endsAt)
  )) ?? null;
}

function safeTime(value: string | null, fallback: string): string {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function finding(
  input: Omit<CertificateReviewFinding, 'id' | 'item'> & Readonly<{
    stableIdentity: readonly unknown[];
    materialIdentity: readonly unknown[];
    completeness: AnalystReviewCompleteness;
    caseId?: string | null | undefined;
    now: string;
  }>,
): CertificateReviewFinding {
  const evidenceFamily = input.evidenceClass === 'spki' || input.evidenceClass === 'certificate_digest'
    ? 'certificate_identity' as const
    : input.evidenceClass;
  const subjectKey = analystReviewSubjectKey(evidenceFamily, input.stableIdentity);
  const materialFingerprint = analystReviewMaterialFingerprint(input.materialIdentity);
  const id = `certificate:${subjectKey.slice(-16)}`;
  const priority = input.state === 'expired' || input.state === 'review'
    ? 'high' as const
    : input.state === 'partial' || input.state === 'unavailable' ? 'normal' as const : 'normal' as const;
  const item: AnalystReviewItem = {
    id,
    kind: 'certificate',
    evidenceFamily,
    subjectKey,
    materialFingerprint,
    requiresExpiry: true,
    priority,
    title: input.label,
    detail: input.detail,
    source: input.sources.join(', ') || 'Retained certificate context',
    sourceIds: [input.evidenceClass],
    caseDomain: input.domain,
    observedAt: input.observedAt,
    dueAt: input.kind === 'expiry' || input.kind === 'expired_acknowledgement' ? input.notAfter : null,
    age: age(input.observedAt, input.now),
    completeness: input.completeness,
    nextAction: input.state === 'unavailable' || input.state === 'partial' ? 'refresh' : 'review',
    rankingReason: input.kind === 'retained_certificate_digest'
      ? 'A separately retained live certificate identity is available for explicit analyst review.'
      : input.state === 'expired'
      ? 'An explicitly retained expiry time has passed.'
      : input.state === 'review'
        ? 'Retained evidence differs from the reviewed desired posture.'
        : 'Retained certificate context is ordered by observation time and stable identity.',
    href: `/monitor?view=certificates&profile=${encodeURIComponent(input.profileId)}&certificate=${encodeURIComponent(id)}`,
    retryHref: input.state === 'unavailable' || input.state === 'partial'
      ? `/lookup?q=${encodeURIComponent(input.domain)}&depth=deep`
      : null,
    caseId: input.caseId ?? null,
    campaignIds: [],
    dismissalTarget: null,
  };
  return { ...input, id, item };
}

function availabilityFinding(
  profile: BrandProfile,
  domain: string,
  desired: DesiredPostureBaseline,
  retainedFacts: RetainedFactIndex,
  now: string,
): CertificateReviewFinding[] {
  const output: CertificateReviewFinding[] = [];
  const liveIssuer = retainedFact(retainedFacts, domain, ['tls.issuer']);
  if (desired.tlsIssuer) {
    const matches = liveIssuer?.value.toLowerCase() === desired.tlsIssuer.toLowerCase();
    output.push(finding({
      profileId: profile.id,
      profileName: profile.name,
      domain,
      kind: !liveIssuer ? 'live_unavailable' : matches ? 'expected_observation' : 'unexpected_issuer',
      state: !liveIssuer ? 'unavailable' : liveIssuer.completeness !== 'complete' ? 'partial' : matches ? 'expected' : 'review',
      evidenceClass: 'live_tls',
      label: !liveIssuer ? `Live TLS issuer unavailable for ${domain}` : matches ? `Expected live TLS issuer retained for ${domain}` : `Unexpected live TLS issuer retained for ${domain}`,
      detail: !liveIssuer
        ? 'An issuer expectation is configured, but no separately typed retained live TLS issuer fact is available.'
        : liveIssuer.completeness !== 'complete'
          ? 'The retained live TLS issuer fact is partial, truncated, or source-inconclusive, so it cannot support a complete expectation comparison.'
          : matches
            ? 'The retained live TLS issuer at its observation time matches the reviewed baseline.'
            : 'The retained live TLS issuer at its observation time differs from the reviewed baseline. This is a review lead, not proof of unauthorised use.',
      observedAt: liveIssuer?.observedAt ?? desired.updatedAt,
      notAfter: null,
      certificateSha256: null,
      spkiSha256: null,
      sources: liveIssuer ? [liveIssuer.source] : ['Brand Profile baseline'],
      limitations: [
        ...(liveIssuer?.limitations ?? []),
        'A retained live TLS observation describes what was served at its observation time; it does not establish current deployment, ownership, control, legitimacy, or safety.',
      ],
      stableIdentity: [profile.id, domain, 'live-tls-issuer'],
      materialIdentity: [desired.tlsIssuer, liveIssuer?.value, liveIssuer?.observedAt, liveIssuer?.completeness, liveIssuer?.source, liveIssuer?.limitations],
      completeness: liveIssuer?.completeness ?? 'inconclusive',
      caseId: liveIssuer?.caseId,
      now,
    }));
  }

  const liveNames = retainedFact(retainedFacts, domain, ['tls.san_dns_names']);
  if (desired.tlsSanPatterns.length) {
    const observedNames = liveNames ? retainedValues(liveNames.value) : [];
    const matches = desired.tlsSanPatterns.every((pattern) => (
      observedNames.some((name) => certificateSanPatternMatches(pattern, name))
    )) && observedNames.every((name) => (
      desired.tlsSanPatterns.some((pattern) => certificateSanPatternMatches(pattern, name))
    ));
    const wildcard = observedNames.some((name) => name.startsWith('*.'));
    output.push(finding({
      profileId: profile.id,
      profileName: profile.name,
      domain,
      kind: !liveNames ? 'live_unavailable' : matches ? 'expected_observation' : wildcard ? 'unexpected_wildcard' : 'unexpected_san',
      state: !liveNames ? 'unavailable' : liveNames.completeness !== 'complete' ? 'partial' : matches ? 'expected' : 'review',
      evidenceClass: 'live_tls',
      label: !liveNames ? `Live TLS certificate names unavailable for ${domain}` : matches ? `Expected live TLS certificate names retained for ${domain}` : `Unexpected live TLS certificate names retained for ${domain}`,
      detail: !liveNames
        ? 'Certificate-name expectations are configured, but no separately typed retained live TLS SAN fact is available.'
        : liveNames.completeness !== 'complete'
          ? 'The retained live TLS certificate names are partial, truncated, or source-inconclusive, so missing or wildcard coverage remains indeterminate.'
          : matches
            ? 'The complete retained live TLS certificate names at their observation time cover the reviewed SAN patterns.'
            : 'The complete retained live TLS certificate names at their observation time do not cover every reviewed SAN pattern. This needs analyst review.',
      observedAt: liveNames?.observedAt ?? desired.updatedAt,
      notAfter: null,
      certificateSha256: null,
      spkiSha256: null,
      sources: liveNames ? [liveNames.source] : ['Brand Profile baseline'],
      limitations: [
        ...(liveNames?.limitations ?? []),
        'Certificate names are compared only when the retained source is complete and untruncated; matching names do not establish ownership, control, legitimacy, or safety.',
      ],
      stableIdentity: [profile.id, domain, 'live-tls-san'],
      materialIdentity: [desired.tlsSanPatterns, observedNames, liveNames?.observedAt, liveNames?.completeness, liveNames?.source, liveNames?.limitations],
      completeness: liveNames?.completeness ?? 'inconclusive',
      caseId: liveNames?.caseId,
      now,
    }));
  }

  const liveDigest = retainedFact(retainedFacts, domain, ['tls.certificate_sha256']);
  if (liveDigest) {
    output.push(finding({
      profileId: profile.id,
      profileName: profile.name,
      domain,
      kind: 'retained_certificate_digest',
      state: liveDigest.completeness === 'complete' ? 'review' : 'partial',
      evidenceClass: 'certificate_digest',
      label: `Review retained live certificate digest for ${domain}`,
      detail: liveDigest.completeness === 'complete'
        ? 'This separately retained live TLS certificate SHA-256 identifies certificate bytes observed at one time. No certificate-digest baseline or public-key equivalence is inferred.'
        : 'The separately retained certificate digest came from partial, truncated, or source-inconclusive live TLS evidence and remains indeterminate.',
      observedAt: liveDigest.observedAt,
      notAfter: null,
      certificateSha256: liveDigest.value.toLowerCase(),
      spkiSha256: null,
      sources: [liveDigest.source],
      limitations: [
        ...liveDigest.limitations,
        'A certificate SHA-256 digest is not an SPKI digest and does not by itself establish current deployment, ownership, control, legitimacy, or safety.',
      ],
      stableIdentity: [profile.id, domain, 'live-certificate-digest'],
      materialIdentity: [liveDigest.value.toLowerCase(), liveDigest.observedAt, liveDigest.completeness, liveDigest.source, liveDigest.limitations],
      completeness: liveDigest.completeness,
      caseId: liveDigest.caseId,
      now,
    }));
  }

  const liveExpiry = retainedFact(retainedFacts, domain, ['tls.valid_to']);
  if (liveExpiry) {
    const notAfter = new Date(liveExpiry.value).toISOString();
    const expiryDays = (Date.parse(notAfter) - Date.parse(now)) / 86_400_000;
    if (expiryDays <= CERTIFICATE_EXPIRY_REVIEW_DAYS) {
      const expired = expiryDays <= 0;
      output.push(finding({
        profileId: profile.id,
        profileName: profile.name,
        domain,
        kind: expired ? 'expired_acknowledgement' : 'expiry',
        state: liveExpiry.completeness !== 'complete' ? 'partial' : expired ? 'expired' : 'review',
        evidenceClass: 'live_tls',
        label: expired ? `Acknowledge retained live certificate expiry for ${domain}` : `Retained live certificate expiry is approaching for ${domain}`,
        detail: `The separately retained live TLS not-after time is ${notAfter}. Acknowledgement changes only the Review Item lifecycle.`,
        observedAt: liveExpiry.observedAt,
        notAfter,
        certificateSha256: null,
        spkiSha256: null,
        sources: [liveExpiry.source],
        limitations: [
          ...liveExpiry.limitations,
          'This point-in-time live TLS fact does not establish whether the same certificate remains deployed.',
        ],
        stableIdentity: [profile.id, domain, 'live-certificate-expiry'],
        materialIdentity: [notAfter, liveExpiry.observedAt, liveExpiry.completeness, liveExpiry.source, liveExpiry.limitations],
        completeness: liveExpiry.completeness,
        caseId: liveExpiry.caseId,
        now,
      }));
    }
  }

  const spki = retainedFact(retainedFacts, domain, ['tls.spki_sha256', 'tls.spkisha256', 'tls.public_key_sha256']);
  if (desired.tlsSpkiSha256) {
    const matches = spki?.value.toLowerCase() === desired.tlsSpkiSha256.toLowerCase();
    output.push(finding({
      profileId: profile.id,
      profileName: profile.name,
      domain,
      kind: !spki ? 'live_unavailable' : matches ? 'expected_observation' : 'unexpected_key',
      state: !spki ? 'unavailable' : spki.completeness !== 'complete' ? 'partial' : matches ? 'expected' : 'review',
      evidenceClass: 'spki',
      label: !spki ? `Live public-key evidence unavailable for ${domain}` : matches ? `Expected public key retained for ${domain}` : `Unexpected public key retained for ${domain}`,
      detail: !spki
        ? 'An expected SPKI SHA-256 value is configured, but no separately typed retained live public-key observation is available. Certificate digests are not substituted.'
        : matches
          ? 'The retained SPKI SHA-256 value matches the reviewed baseline.'
          : 'The retained SPKI SHA-256 value differs from the reviewed baseline. This is a review lead, not proof of unauthorised use.',
      observedAt: spki?.observedAt ?? desired.updatedAt,
      notAfter: null,
      certificateSha256: null,
      spkiSha256: spki?.value ?? null,
      sources: spki ? [spki.source] : ['Brand Profile baseline'],
      limitations: [
        ...(spki?.limitations ?? []),
        'A certificate digest and an SPKI digest identify different material and are never treated as interchangeable.',
      ],
      stableIdentity: [profile.id, domain, 'spki'],
      materialIdentity: [desired.tlsSpkiSha256, spki?.value, spki?.observedAt, spki?.completeness, spki?.source, spki?.limitations],
      completeness: spki?.completeness ?? 'inconclusive',
      caseId: spki?.caseId,
      now,
    }));
  }
  const caa = retainedFact(retainedFacts, domain, ['dns.caa']);
  if (desired.caa.length) {
    const observed = caa ? retainedValues(caa.value) : [];
    const matches = Boolean(caa && exactSetMatch(observed, desired.caa));
    output.push(finding({
      profileId: profile.id,
      profileName: profile.name,
      domain,
      kind: !caa ? 'live_unavailable' : matches ? 'expected_observation' : 'unexpected_caa',
      state: !caa ? 'unavailable' : caa.completeness !== 'complete' ? 'partial' : matches ? 'expected' : 'review',
      evidenceClass: 'caa',
      label: !caa ? `Current CAA evidence unavailable for ${domain}` : matches ? `Expected CAA evidence retained for ${domain}` : `CAA differs from reviewed posture for ${domain}`,
      detail: !caa
        ? 'CAA expectations are configured, but no retained current CAA fact is available. Historical certificate publication cannot establish current DNS policy.'
        : matches
          ? 'The latest separately retained CAA fact exactly matches the reviewed posture.'
          : 'The latest separately retained CAA fact does not exactly match the reviewed posture. Recheck current evidence before deciding what changed.',
      observedAt: caa?.observedAt ?? desired.updatedAt,
      notAfter: null,
      certificateSha256: null,
      spkiSha256: null,
      sources: caa ? [caa.source] : ['Brand Profile baseline'],
      limitations: [
        ...(caa?.limitations ?? []),
        'CAA is a point-in-time DNS policy observation and is not historical proof of certificate issuance or deployment.',
      ],
      stableIdentity: [profile.id, domain, 'caa'],
      materialIdentity: [desired.caa, caa?.value, caa?.observedAt, caa?.completeness, caa?.source, caa?.limitations],
      completeness: caa?.completeness ?? 'inconclusive',
      caseId: caa?.caseId,
      now,
    }));
  }
  return output;
}

function compareFindings(left: CertificateReviewFinding, right: CertificateReviewFinding): number {
  const rank = { expired: 0, review: 1, partial: 2, unavailable: 3, expected: 4 } as const;
  return rank[left.state] - rank[right.state]
    || right.observedAt.localeCompare(left.observedAt)
    || left.id.localeCompare(right.id);
}

export function buildCertificateReviewInbox(
  profilesValue: readonly BrandProfile[],
  recordsValue: readonly CaseRecord[],
  options: Readonly<{ now?: string; profileId?: string }> = {},
): CertificateReviewInbox {
  const now = safeTime(options.now ?? new Date().toISOString(), new Date(0).toISOString());
  const profiles = profilesValue.slice(0, 100).filter((profile) => !options.profileId || profile.id === options.profileId);
  const records = recordsValue.slice(0, 500);
  const retainedFacts = buildRetainedFactIndex(records);
  const findings: CertificateReviewFinding[] = [];
  const domains = new Set<string>();
  let inputCount = 0;
  const addFindings = (candidates: readonly CertificateReviewFinding[]) => {
    inputCount += candidates.length;
    findings.push(...candidates);
    if (findings.length > MAX_CERTIFICATE_REVIEW_FINDINGS * 2) {
      findings.sort(compareFindings).splice(MAX_CERTIFICATE_REVIEW_FINDINGS);
    }
  };
  for (const profile of profiles) {
    const replay = buildBrandCertificateEventReplay(profile, records);
    for (const domainReview of replay.domains) {
      domains.add(domainReview.domain);
      const desired = baseline(profile, domainReview.domain);
      if (desired) addFindings(availabilityFinding(profile, domainReview.domain, desired, retainedFacts, now));
      const events = [...domainReview.events].sort((left, right) => left.observedAt.localeCompare(right.observedAt));
      let previousDigest: string | null = null;
      for (const event of events) {
        const issuer = event.clauses.find((clause) => clause.id === 'issuer');
        const san = event.clauses.find((clause) => clause.id === 'san_patterns');
        const wildcard = event.names.some((name) => name.startsWith('*.'));
        const clauseReview = !domainReview.baselineConfigured ? 'historical_ct_no_deployment'
          : issuer?.state === 'review' ? 'unexpected_issuer'
          : san?.state === 'review' ? wildcard ? 'unexpected_wildcard' : 'unexpected_san'
            : 'expected_observation';
        const incomplete = event.completeness !== 'complete' || !event.namesComplete || event.state === 'indeterminate';
        const caseId = event.caseReferences[0]?.id ?? null;
        const notAfter = event.notAfter;
        const expiryDays = notAfter ? (Date.parse(notAfter) - Date.parse(now)) / 86_400_000 : Number.POSITIVE_INFINITY;
        const expiryKind = expiryDays <= 0 ? 'expired_acknowledgement' : expiryDays <= CERTIFICATE_EXPIRY_REVIEW_DAYS ? 'expiry' : null;
        const reviewedWindow = desired ? changeWindowAt(desired, event.observedAt) : null;
        const changedDigest = Boolean(previousDigest && previousDigest !== event.certificateSha256);
        const postureDifference = clauseReview === 'unexpected_issuer'
          || clauseReview === 'unexpected_san'
          || clauseReview === 'unexpected_wildcard';
        const kind = expiryKind
          ?? (postureDifference
            ? clauseReview
            : changedDigest
              ? reviewedWindow ? 'expected_renewal' : 'renewal'
              : clauseReview);
        const state: CertificateReviewFindingState = incomplete ? 'partial'
          : expiryDays <= 0 ? 'expired'
            : kind === 'expected_observation' || kind === 'expected_renewal' ? 'expected'
              : 'review';
        const label = kind === 'expired_acknowledgement' ? `Acknowledge retained certificate expiry for ${domainReview.domain}`
          : kind === 'expiry' ? `Retained certificate expiry is approaching for ${domainReview.domain}`
            : kind === 'renewal' ? `Review retained certificate renewal for ${domainReview.domain}`
              : kind === 'expected_renewal' ? `Expected certificate renewal retained for ${domainReview.domain}`
              : kind === 'unexpected_issuer' ? `Unexpected retained issuer for ${domainReview.domain}`
                : kind === 'unexpected_san' || kind === 'unexpected_wildcard' ? `Unexpected retained certificate name for ${domainReview.domain}`
                  : kind === 'historical_ct_no_deployment' ? `Review historical certificate publication for ${domainReview.domain}`
                    : `Expected certificate observation for ${domainReview.domain}`;
        addFindings([finding({
          profileId: profile.id,
          profileName: profile.name,
          domain: domainReview.domain,
          kind,
          state,
          evidenceClass: 'certificate_transparency',
          label,
          detail: incomplete
            ? 'The retained event is incomplete, so issuer and certificate-name differences remain indeterminate.'
            : kind === 'expected_observation'
              ? 'The retained publication event matches the reviewed issuer and certificate-name posture.'
              : kind === 'renewal'
                ? 'A different retained certificate digest was observed after an earlier event. Review the bounded evidence before treating it as an expected renewal.'
                : kind === 'expected_renewal'
                  ? `A different retained certificate digest was observed during the reviewed change window: ${reviewedWindow?.summary ?? 'Reviewed change'}. This records analyst intent, not live deployment or operator control.`
                  : kind === 'historical_ct_no_deployment'
                    ? 'This retained Certificate Transparency or imported publication event has no configured issuer or SAN expectation. It remains historical review context without live deployment confirmation.'
                : kind === 'expiry' || kind === 'expired_acknowledgement'
                  ? `The retained not-after time is ${notAfter}. Acknowledgement changes only the Review Item lifecycle.`
                  : 'The retained publication event differs from the reviewed posture and needs analyst review.',
          observedAt: event.observedAt,
          notAfter,
          certificateSha256: event.certificateSha256,
          spkiSha256: null,
          sources: event.sources,
          limitations: [
            ...event.limitations,
            'This is historical Certificate Transparency or imported publication evidence; it is not proof of live deployment.',
            ...(reviewedWindow ? ['An approved change window records reviewed analyst intent only and does not prove that a certificate change was authorised or completed.'] : []),
          ],
          stableIdentity: [profile.id, domainReview.domain, 'retained-certificate-event', event.eventId],
          materialIdentity: [kind, state, event.eventId, event.certificateSha256, event.issuer, event.names, event.namesComplete, event.notAfter, event.observedAt, event.completeness, event.sources, event.limitations, event.caseReferences.map((reference) => reference.id), issuer?.expected, san?.expected, reviewedWindow],
          completeness: incomplete ? 'partial' : 'complete',
          caseId,
          now,
        })]);
        previousDigest = event.certificateSha256;
      }
    }
  }
  const sorted = findings.sort(compareFindings);
  return {
    version: CERTIFICATE_REVIEW_INBOX_VERSION,
    findings: sorted.slice(0, MAX_CERTIFICATE_REVIEW_FINDINGS),
    profileCount: profiles.length,
    domainCount: domains.size,
    truncated: profilesValue.length > 100 || recordsValue.length > 500 || inputCount > MAX_CERTIFICATE_REVIEW_FINDINGS || sorted.length > MAX_CERTIFICATE_REVIEW_FINDINGS,
    limitations: [
      'This inbox uses retained or imported browser-local evidence only and starts no Certificate Transparency, DNS, TLS, provider, monitoring, or Lookup request.',
      'Certificate Transparency publication, live TLS, CAA, certificate digest, and SPKI evidence remain separately labelled and are never substituted for one another.',
      'Expected, unexpected, renewed, expiring, and expired are review states against analyst-authored posture. They do not prove ownership, control, legitimacy, compromise, safety, or maliciousness.',
      'Missing or partial evidence remains unavailable or partial and cannot resolve a Review Item.',
    ],
  };
}
