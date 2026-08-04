// Deliberately small interoperability projection over reviewed MISP
// taxonomies. WHOISleuth retains its own bounded workflow vocabulary and
// derives machine tags only when an analyst-owned disposition and reason make
// the mapping unambiguous. These tags never alter collection or scoring.

type AnalystReviewReason = Readonly<{ value: string; label: string }>;
type TaxonomyReference = Readonly<{
  namespace: string;
  version: number;
  sourceSha256: string;
  sourceUrl: string;
}>;

const ANALYST_REVIEW_REASONS: readonly AnalystReviewReason[] = Object.freeze([
  Object.freeze({ value: '', label: 'Not recorded' }),
  Object.freeze({ value: 'authorized_or_owned', label: 'Authorised or owned domain' }),
  Object.freeze({ value: 'shared_infrastructure', label: 'Shared infrastructure explained the signal' }),
  Object.freeze({ value: 'generic_platform_or_template', label: 'Generic platform or template' }),
  Object.freeze({ value: 'parked_or_reseller', label: 'Parking or reseller page' }),
  Object.freeze({ value: 'insufficient_evidence', label: 'Insufficient evidence' }),
  Object.freeze({ value: 'legitimate_third_party', label: 'Legitimate third party' }),
  Object.freeze({ value: 'confirmed_credential_abuse', label: 'Confirmed credential abuse' }),
  Object.freeze({ value: 'confirmed_malware', label: 'Confirmed malware' }),
  Object.freeze({ value: 'other_reviewed', label: 'Other reviewed reason' }),
]);

const ANALYST_REVIEW_REASON_VALUES = new Set(
  ANALYST_REVIEW_REASONS.map(({ value }) => value).filter(Boolean),
);

const MISP_TAXONOMY_REFERENCES: readonly TaxonomyReference[] = Object.freeze([
  Object.freeze({ namespace: 'domain-abuse', version: 2, sourceSha256: '5fcfb44742daac97061726faaaadd2ce6b7eac55306acaae3d30c3882d18f991', sourceUrl: 'https://github.com/MISP/misp-taxonomies/blob/main/domain-abuse/machinetag.json' }),
  Object.freeze({ namespace: 'estimative-language', version: 5, sourceSha256: '1010927d396f66f7cc58a229ebb8af6ad2cdc0250ad5f8ce3b1bd9aacf5ab4da', sourceUrl: 'https://github.com/MISP/misp-taxonomies/blob/main/estimative-language/machinetag.json' }),
  Object.freeze({ namespace: 'event-assessment', version: 2, sourceSha256: '39291bdd50e1b2975a93e33e396f42b398178015580a84402bc3d8d549dd721e', sourceUrl: 'https://github.com/MISP/misp-taxonomies/blob/main/event-assessment/machinetag.json' }),
  Object.freeze({ namespace: 'false-positive', version: 7, sourceSha256: 'ffc8d35ae36eb1d39f33611d1090793021f2bfe3b4b31ae41631e22cf544a2fb', sourceUrl: 'https://github.com/MISP/misp-taxonomies/blob/main/false-positive/machinetag.json' }),
  Object.freeze({ namespace: 'phishing', version: 5, sourceSha256: '8628ebe4d5935216a7b006a4d975669c4ae1a554ef8ed78ffaadd62f763d7263', sourceUrl: 'https://github.com/MISP/misp-taxonomies/blob/main/phishing/machinetag.json' }),
]);

function analystInteroperabilityTags(disposition: unknown, reviewReasonCode: unknown): string[] {
  const tags = new Set<string>();
  if (disposition === 'false_positive') tags.add('false-positive:confirmed="true"');
  if (
    (disposition === 'false_positive' || disposition === 'expected')
    && ['authorized_or_owned', 'shared_infrastructure', 'generic_platform_or_template', 'parked_or_reseller', 'legitimate_third_party'].includes(String(reviewReasonCode))
  ) tags.add('false-positive:risk="high"');
  if (reviewReasonCode === 'insufficient_evidence') {
    tags.add('estimative-language:confidence-in-analytic-judgment="low"');
  }
  if (disposition === 'confirmed_abuse' && reviewReasonCode === 'confirmed_credential_abuse') {
    tags.add('phishing:techniques="fake-website"');
  }
  return [...tags].sort();
}

export {
  ANALYST_REVIEW_REASONS,
  ANALYST_REVIEW_REASON_VALUES,
  MISP_TAXONOMY_REFERENCES,
  analystInteroperabilityTags,
};

export type { AnalystReviewReason, TaxonomyReference };
