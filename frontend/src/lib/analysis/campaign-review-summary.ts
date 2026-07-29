import {
  latestCaseEvidence,
  type CaseRecord,
} from './case-record-model.ts';

export type CampaignReviewCue = Readonly<{
  id: 'credential_surface' | 'identity_relationship' | 'mail_surface' | 'redirect_review';
  label: string;
  caseCount: number;
  detail: string;
}>;

export type CampaignReviewSummary = Readonly<{
  memberCount: number;
  linkedCaseCount: number;
  unavailableCaseCount: number;
  unreviewedCaseCount: number;
  limitedEvidenceCount: number;
  cues: readonly CampaignReviewCue[];
  limitations: readonly string[];
}>;

const MAX_CAMPAIGN_CASES = 500;
const LIMITED_AVAILABILITY = new Set(['', 'error', 'unknown']);

export function buildCampaignReviewSummary(
  domainsValue: unknown,
  recordsValue: unknown,
): CampaignReviewSummary {
  const domains = Array.isArray(domainsValue)
    ? [...new Set(domainsValue
      .slice(0, MAX_CAMPAIGN_CASES * 2)
      .map((value) => typeof value === 'string' ? value.trim().toLowerCase() : '')
      .filter(Boolean))]
      .slice(0, MAX_CAMPAIGN_CASES)
    : [];
  const records = Array.isArray(recordsValue)
    ? recordsValue.slice(0, MAX_CAMPAIGN_CASES) as CaseRecord[]
    : [];
  const byDomain = new Map(records.map((record) => [record.domain, record]));
  const linked = domains.map((domain) => byDomain.get(domain)).filter((record): record is CaseRecord => Boolean(record));
  const snapshots = linked.map((record) => ({ record, evidence: latestCaseEvidence(record) }));
  const count = (predicate: (item: typeof snapshots[number]) => boolean) => snapshots.filter(predicate).length;
  const cues: CampaignReviewCue[] = [
    {
      id: 'credential_surface',
      label: 'Password field observed',
      caseCount: count(({ evidence }) => evidence?.hasPasswordField === true),
      detail: 'Static page evidence retained a password input. This does not establish credential theft or maliciousness.',
    },
    {
      id: 'identity_relationship',
      label: 'Official identity relationship',
      caseCount: count(({ evidence }) => Boolean(
        evidence?.faviconMatch
        || evidence?.faviconNearMatch
        || evidence?.reusesOfficialAssets,
      )),
      detail: 'A favicon or official-asset relationship was retained. Shared assets and templates can be legitimate.',
    },
    {
      id: 'redirect_review',
      label: 'Redirect or transport review',
      caseCount: count(({ evidence }) => Boolean(
        evidence?.httpCrossOriginRedirect
        || evidence?.httpHttpsDowngrade,
      )),
      detail: 'A cross-origin redirect or HTTPS downgrade was retained for review; neither signal establishes intent.',
    },
    {
      id: 'mail_surface',
      label: 'Mail exchanger observed',
      caseCount: count(({ evidence }) => evidence?.hasMx === true),
      detail: 'Mail-routing evidence was retained. Receiving mail is operational context, not evidence of abuse.',
    },
  ];
  return {
    memberCount: domains.length,
    linkedCaseCount: linked.length,
    unavailableCaseCount: Math.max(0, domains.length - linked.length),
    unreviewedCaseCount: linked.filter((record) => record.disposition === 'unreviewed').length,
    limitedEvidenceCount: snapshots.filter(({ evidence }) => (
      !evidence
      || LIMITED_AVAILABILITY.has(String(evidence.availability ?? '').toLowerCase())
      || evidence.confidence === null
    )).length,
    cues,
    limitations: [
      'Counts use only the latest bounded evidence already retained in linked browser-local cases and make no request.',
      'Cue overlap is expected. Counts are not a score, campaign-attribution finding, ownership claim, or maliciousness determination.',
      'A campaign member without a linked case or usable snapshot remains unavailable rather than becoming a negative observation.',
    ],
  };
}
