import { SORTED_JSON_V2, sha256ArtifactDigestV2 } from './artifact-integrity.ts';
import {
  BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION,
  normalizeBulkProfileContext,
  normalizeBulkSessionResult,
  type BulkProfileContextProvenance,
  type BulkSessionResult,
  type BulkSessionSourceCoverage,
} from './bulk-session-model.ts';

export const BULK_MAIL_EXPOSURE_SCHEMA = 'whoisleuth.bulk-mail-exposure';
export const BULK_MAIL_EXPOSURE_VERSION = 1;
export const BULK_MAIL_EXPOSURE_EXPORT_VERSION = 2;
export const MAX_BULK_MAIL_EXPOSURE_ROWS = 2_000;

export type BulkMailExposureState =
  | 'authenticated_mail'
  | 'evidence_incomplete'
  | 'mail_auth_gap'
  | 'mail_auth_incomplete'
  | 'no_explicit_mx'
  | 'null_mx';

export type BulkMailBaselineProfile = 'defensive_no_mail' | 'parked' | 'standard' | null;
export type BulkMailBaselineRelation = 'aligned' | 'inconclusive' | 'review';

export type BulkMailExposureRow = Readonly<{
  domain: string;
  state: BulkMailExposureState;
  label: string;
  detail: string;
  baselineRelation: BulkMailBaselineRelation;
  baselineDetail: string;
  mutationTypes: readonly string[];
  registration: string;
  sourceCoverage: readonly BulkSessionSourceCoverage[];
  profileContextState: BulkProfileContextProvenance['sourceState'];
  profileContextLimitation: string;
  limitations: readonly string[];
}>;

export type BulkMailExposureReport = Readonly<{
  version: 1;
  generatedAt: string;
  observedAt: string | null;
  baseline: Readonly<{
    profile: BulkMailBaselineProfile;
    officialDomains: readonly string[];
    label: string;
    limitations: readonly string[];
  }>;
  rows: readonly BulkMailExposureRow[];
  counts: Readonly<Record<BulkMailExposureState, number>>;
  profileContextUnevaluatedCount: number;
  limitations: readonly string[];
}>;

const STATE_LABELS: Readonly<Record<BulkMailExposureState, string>> = {
  authenticated_mail: 'Receiving mail with SPF and DMARC',
  evidence_incomplete: 'Mail evidence incomplete',
  mail_auth_gap: 'Receiving mail with an authentication gap',
  mail_auth_incomplete: 'Receiving mail with incomplete authentication evidence',
  no_explicit_mx: 'No explicit MX observed',
  null_mx: 'Null MX observed',
};

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function baselineLabel(
  profile: BulkMailBaselineProfile,
  profileSourceState: 'loading' | 'ready' | 'unavailable',
): string {
  if (profileSourceState === 'loading') return 'Brand Profile context loading';
  if (profileSourceState === 'unavailable') return 'Brand Profile context unavailable';
  if (profile === 'defensive_no_mail') return 'Configured no-mail baseline';
  if (profile === 'parked') return 'Configured parked-domain baseline';
  if (profile === 'standard') return 'Configured standard-mail baseline';
  return 'No active Brand Profile baseline';
}

function dnsCoverage(row: BulkSessionResult): BulkSessionSourceCoverage | null {
  return row.sourceCoverage.find((source) => source.source === 'dns') ?? null;
}

function exposureState(row: BulkSessionResult): BulkMailExposureState {
  const coverage = dnsCoverage(row);
  if (row.scanDepth !== 'deep' || !coverage || !['complete', 'partial'].includes(coverage.state)) {
    return 'evidence_incomplete';
  }
  if (row.hasNullMx === true) return 'null_mx';
  if (row.hasMx === true) {
    if (row.hasSpf === true && row.hasDmarc === true) return 'authenticated_mail';
    if (row.hasSpf === false || row.hasDmarc === false) return 'mail_auth_gap';
    return 'mail_auth_incomplete';
  }
  if (row.hasMx === false && row.hasNullMx === false) return 'no_explicit_mx';
  return 'evidence_incomplete';
}

function stateDetail(state: BulkMailExposureState): string {
  if (state === 'authenticated_mail') {
    return 'An explicit receiving MX plus SPF and DMARC publications were observed.';
  }
  if (state === 'null_mx') {
    return 'A null MX explicitly declaring no inbound mail was observed.';
  }
  if (state === 'mail_auth_gap') {
    return 'A receiving MX was observed while SPF or DMARC was observed absent.';
  }
  if (state === 'mail_auth_incomplete') {
    return 'A receiving MX was observed, but SPF or DMARC collection was incomplete.';
  }
  if (state === 'no_explicit_mx') {
    return 'DNS collection completed without an explicit MX. This is not proof that SMTP delivery is impossible.';
  }
  return 'The compact scan did not retain enough settled DNS evidence to classify mail exposure.';
}

function relation(
  state: BulkMailExposureState,
  profile: BulkMailBaselineProfile,
  profileSourceState: 'loading' | 'ready' | 'unavailable',
  profileContextComparable: boolean,
  profileContextLimitation: string,
): Pick<BulkMailExposureRow, 'baselineDetail' | 'baselineRelation'> {
  if (profileSourceState !== 'ready') {
    return {
      baselineRelation: 'inconclusive',
      baselineDetail: profileSourceState === 'loading'
        ? 'Brand Profile context is still loading, so no profile-derived mail comparison is available.'
        : 'Brand Profile context could not be read, so no profile-derived mail comparison is available.',
    };
  }
  if (!profileContextComparable) {
    return {
      baselineRelation: 'inconclusive',
      baselineDetail: profileContextLimitation || BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION,
    };
  }
  if (!profile || state === 'evidence_incomplete' || state === 'mail_auth_incomplete') {
    return {
      baselineRelation: 'inconclusive',
      baselineDetail: profile
        ? 'Incomplete evidence prevents a reliable comparison with the configured baseline.'
        : 'Set an active Brand Profile to compare this observation with a configured official-domain mail posture.',
    };
  }
  if (profile === 'defensive_no_mail') {
    return state === 'null_mx'
      ? {
          baselineRelation: 'aligned',
          baselineDetail: 'The observed null MX matches the configured no-mail posture.',
        }
      : {
          baselineRelation: 'review',
          baselineDetail: 'The observed candidate posture differs from the configured no-mail baseline.',
        };
  }
  if (profile === 'standard') {
    return ['authenticated_mail', 'mail_auth_gap'].includes(state)
      ? {
          baselineRelation: state === 'authenticated_mail' ? 'aligned' : 'review',
          baselineDetail: state === 'authenticated_mail'
            ? 'Receiving mail plus SPF and DMARC matches the configured standard-mail baseline.'
            : 'Receiving mail was observed with an authentication gap relative to the configured baseline.',
        }
      : {
          baselineRelation: 'review',
          baselineDetail: 'The observed candidate posture differs from the configured standard-mail baseline.',
        };
  }
  return {
    baselineRelation: 'review',
    baselineDetail: 'The parked-domain profile is context rather than a claim about the expected candidate mail posture.',
  };
}

function rowLimitations(
  row: BulkSessionResult,
  state: BulkMailExposureState,
  profileSourceState: 'loading' | 'ready' | 'unavailable',
  profileContextComparable: boolean,
  profileContextLimitation: string,
): string[] {
  const output: string[] = [];
  if (profileSourceState !== 'ready') {
    output.push(profileSourceState === 'loading'
      ? 'Brand Profile context was still loading; official-domain mail posture was not evaluated.'
      : 'Brand Profile context was unavailable; official-domain mail posture was not evaluated.');
  }
  if (profileSourceState === 'ready' && !profileContextComparable) {
    output.push(profileContextLimitation || BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION);
  }
  const coverage = dnsCoverage(row);
  if (!coverage) output.push('DNS source coverage was not recorded for this compact result.');
  else if (coverage.state !== 'complete') output.push(`DNS source coverage was ${coverage.state}.`);
  if (row.scanDepth !== 'deep') output.push('Fast mode does not collect the complete mail evidence used by this review.');
  if (state === 'no_explicit_mx') {
    output.push('No explicit MX is not equivalent to a null MX or proof that the domain cannot receive mail.');
  }
  output.push('Mail configuration alone does not establish use, intent, control, safety, or maliciousness.');
  return output.slice(0, 6);
}

export function buildBulkMailExposureReport(
  rowsRaw: readonly unknown[],
  options: Readonly<{
    generatedAt?: unknown;
    observedAt?: unknown;
    officialDomains?: readonly string[];
    profile?: BulkMailBaselineProfile;
    profileSourceState?: 'loading' | 'ready' | 'unavailable';
    currentProfileContext?: unknown;
  }> = {},
): BulkMailExposureReport {
  const generatedAt = timestamp(options.generatedAt) ?? new Date().toISOString();
  const profileSourceState = options.profileSourceState ?? 'ready';
  const currentProfileContext = normalizeBulkProfileContext(
    options.currentProfileContext ?? (profileSourceState === 'ready'
      ? { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' }
      : { sourceState: 'unavailable' }),
  );
  const profile = profileSourceState === 'ready' ? options.profile ?? null : null;
  const officialDomains = [...new Set(
    (profileSourceState === 'ready' ? options.officialDomains ?? [] : [])
      .map((domain) => domain.trim().toLowerCase().replace(/\.$/u, ''))
      .filter(Boolean),
  )].slice(0, 20);
  let profileContextUnevaluatedCount = 0;
  const rows = rowsRaw
    .map((row) => normalizeBulkSessionResult(row))
    .filter((row): row is BulkSessionResult => Boolean(row))
    .filter((row) => row.trusted === null)
    .slice(0, MAX_BULK_MAIL_EXPOSURE_ROWS)
    .map((item): BulkMailExposureRow => {
      const state = exposureState(item);
      const profileContextComparable = profileSourceState === 'ready'
        && currentProfileContext.sourceState === 'ready'
        && item.profileContext.sourceState === 'ready'
        && item.profileContext.activeProfileId === currentProfileContext.activeProfileId
        && item.profileContext.profileUpdatedAt === currentProfileContext.profileUpdatedAt;
      const profileContextLimitation = profileContextComparable
        ? item.profileContext.limitation
        : item.profileContext.limitation || BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION;
      if (!profileContextComparable) profileContextUnevaluatedCount += 1;
      return {
        domain: item.domain,
        state,
        label: STATE_LABELS[state],
        detail: stateDetail(state),
        ...relation(state, profile, profileSourceState, profileContextComparable, profileContextLimitation),
        mutationTypes: item.mutationTypes.slice(0, 40),
        registration: item.availability,
        sourceCoverage: item.sourceCoverage.slice(0, 12),
        profileContextState: item.profileContext.sourceState,
        profileContextLimitation,
        limitations: rowLimitations(item, state, profileSourceState, profileContextComparable, profileContextLimitation),
      };
    });
  const counts: Record<BulkMailExposureState, number> = {
    authenticated_mail: 0,
    evidence_incomplete: 0,
    mail_auth_gap: 0,
    mail_auth_incomplete: 0,
    no_explicit_mx: 0,
    null_mx: 0,
  };
  for (const item of rows) counts[item.state] += 1;
  return {
    version: BULK_MAIL_EXPOSURE_VERSION,
    generatedAt,
    observedAt: timestamp(options.observedAt),
    baseline: {
      profile,
      officialDomains,
      label: baselineLabel(profile, profileSourceState),
      limitations: [
        ...(profileSourceState === 'loading'
          ? ['Brand Profile context was loading, so profile-derived mail posture is inconclusive.']
          : profileSourceState === 'unavailable'
            ? ['Brand Profile context was unavailable, so profile-derived mail posture is inconclusive.']
            : []),
        'The Brand Profile describes an analyst-configured official-domain posture; it is not a live observation.',
        'Candidate similarity and mail configuration do not establish use, control, intent, safety, or maliciousness.',
      ],
    },
    rows,
    counts,
    profileContextUnevaluatedCount,
    limitations: [
      'This review uses compact Bulk evidence already collected and makes no additional request.',
      'Null MX, no explicit MX, receiving mail, authentication gaps, and incomplete evidence remain separate states.',
      'SMTP delivery, mailbox existence, catch-all behaviour, and message acceptance were not tested.',
    ],
  };
}

export async function buildBulkMailExposureExport(report: BulkMailExposureReport) {
  const unsigned = {
    schema: BULK_MAIL_EXPOSURE_SCHEMA,
    version: BULK_MAIL_EXPOSURE_EXPORT_VERSION,
    report,
  };
  const digestSha256 = await sha256ArtifactDigestV2(unsigned);
  const document = {
    ...unsigned,
    integrity: { algorithm: 'SHA-256' as const, canonicalization: SORTED_JSON_V2, digestSha256 },
  };
  return {
    document,
    content: `${JSON.stringify(document, null, 2)}\n`,
    filename: `whoisleuth-mail-exposure-${report.generatedAt.slice(0, 10)}.json`,
  };
}
