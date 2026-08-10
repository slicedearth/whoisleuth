import {
  hasVerifiedWholeArtifactIntegrity,
  UnsupportedOfflineArtifactError,
  verifyOfflineArtifact,
} from './artifact-verify.mts';

const SHARING_REVIEW_SCHEMA = 'whoisleuth.cli.sharing-review';
const SHARING_REVIEW_VERSION = 2;
const MAX_SHARING_REVIEW_BYTES = 15 * 1024 * 1024;
const TLP_MARKINGS = ['clear', 'green', 'amber', 'amber-strict', 'red'] as const;
const RECIPIENT_SCOPES = ['public', 'community', 'organization', 'named-recipients'] as const;

type TlpMarking = typeof TLP_MARKINGS[number];
type RecipientScope = typeof RECIPIENT_SCOPES[number];
type FindingState = 'block' | 'caution' | 'pass';
type UnknownRecord = Record<string, unknown>;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

type SharingReviewOptions = Readonly<{
  marking: TlpMarking;
  recipientScope: RecipientScope;
  purpose: string;
  humanReviewed: boolean;
  personalDataReviewed: boolean;
  redactionsConfirmed: boolean;
}>;

type SharingReviewDocument = Readonly<{
  schema: typeof SHARING_REVIEW_SCHEMA;
  version: typeof SHARING_REVIEW_VERSION;
  generatedAt: string;
  artifact: Readonly<{
    schema: string | null;
    version: number | null;
    integrity: 'failed' | 'projection_integrity' | 'structure_only' | 'unsupported' | 'verified';
  }>;
  sharing: Readonly<{
    requestedMarking: `TLP:${string}`;
    strictestImportedMarking: `TLP:${string}` | null;
    effectiveMarking: `TLP:${string}`;
    recipientScope: RecipientScope;
    purposeRecorded: true;
  }>;
  findings: readonly Readonly<{
    id: string;
    state: FindingState;
    label: string;
    detail: string;
  }>[];
  summary: Readonly<{ block: number; caution: number; pass: number; status: 'blocked' | 'ready' | 'review_cautions' }>;
  privacy: Readonly<{
    artifactMetadataFieldsEmitted: 0 | 1 | 2;
    contentValuesEmitted: 0;
    rawEvidenceCopied: 0;
  }>;
  limitations: readonly string[];
}>;

const RISKY_KEYS = new Set([
  'authorization', 'cookie', 'cookies', 'credential', 'credentials', 'email', 'emails',
  'entities', 'password', 'phone', 'raw', 'rawrdap', 'rawwhois', 'registrant', 'session', 'token',
]);
const MARKING_KEYS = new Set([
  'informationmarking', 'marking', 'markings', 'sharingmarking',
  'tlp', 'tlplabel', 'tlpmarking', 'trafficlightprotocol',
]);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function boundedMetadataText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 120 || CONTROL_RE.test(value)) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function markingFromText(value: string): TlpMarking | null {
  const normalized = value.toUpperCase().replace(/\s+/gu, '').replace('TLP:', '').replace('+STRICT', '-STRICT').toLowerCase();
  return TLP_MARKINGS.includes(normalized as TlpMarking) ? normalized as TlpMarking : null;
}

function scanArtifact(root: UnknownRecord): Readonly<{
  importedMarkings: readonly TlpMarking[];
  riskyKeyCount: number;
  truncated: boolean;
}> {
  const stack: Array<{ value: unknown; depth: number; key: string | null }> = [{ value: root, depth: 0, key: null }];
  const markings = new Set<TlpMarking>();
  let riskyKeyCount = 0;
  let visited = 0;
  let truncated = false;
  while (stack.length && visited < 20_000) {
    const next = stack.pop()!;
    visited += 1;
    if (next.key && RISKY_KEYS.has(normalizedKey(next.key))) riskyKeyCount += 1;
    if (typeof next.value === 'string') {
      const marking = markingFromText(next.value);
      if (marking && (next.key === null || MARKING_KEYS.has(normalizedKey(next.key)))) markings.add(marking);
      continue;
    }
    if (next.depth >= 12) {
      if (next.value && typeof next.value === 'object') truncated = true;
      continue;
    }
    if (Array.isArray(next.value)) {
      for (const item of next.value.slice(0, 500)) stack.push({ value: item, depth: next.depth + 1, key: next.key });
      if (next.value.length > 500) truncated = true;
      continue;
    }
    const valueRecord = record(next.value);
    if (!valueRecord) continue;
    const entries = Object.entries(valueRecord);
    for (const [key, value] of entries.slice(0, 500)) stack.push({ value, depth: next.depth + 1, key });
    if (entries.length > 500) truncated = true;
  }
  if (stack.length) truncated = true;
  return { importedMarkings: [...markings], riskyKeyCount, truncated };
}

function expectedScope(marking: TlpMarking): RecipientScope {
  if (marking === 'clear') return 'public';
  if (marking === 'green') return 'community';
  if (marking === 'red') return 'named-recipients';
  return 'organization';
}

function tlpLabel(marking: TlpMarking): `TLP:${string}` {
  return `TLP:${marking === 'amber-strict' ? 'AMBER+STRICT' : marking.toUpperCase()}`;
}

async function buildSharingReview(
  raw: string,
  options: SharingReviewOptions,
  generatedAt = new Date().toISOString(),
): Promise<SharingReviewDocument> {
  let artifactValue: unknown;
  try {
    artifactValue = JSON.parse(raw);
  } catch {
    throw new TypeError('Sharing review input must be valid JSON.');
  }
  const artifact = record(artifactValue);
  if (!artifact) throw new TypeError('Sharing review input must contain one JSON object.');
  const scan = scanArtifact(artifact);
  const imported = [...scan.importedMarkings].sort(
    (left, right) => TLP_MARKINGS.indexOf(right) - TLP_MARKINGS.indexOf(left),
  );
  const strictestImported = imported[0] || null;
  const requestedRank = TLP_MARKINGS.indexOf(options.marking);
  const importedRank = strictestImported === null ? -1 : TLP_MARKINGS.indexOf(strictestImported);
  const effective = importedRank > requestedRank ? strictestImported! : options.marking;

  let integrity: SharingReviewDocument['artifact']['integrity'] = 'unsupported';
  try {
    const verification = await verifyOfflineArtifact(raw);
    integrity = verification.state === 'verified' && hasVerifiedWholeArtifactIntegrity(verification)
      ? 'verified'
      : verification.state === 'integrity_valid'
        ? 'projection_integrity'
        : 'structure_only';
  } catch (error) {
    integrity = error instanceof UnsupportedOfflineArtifactError ? 'unsupported' : 'failed';
  }

  const findings: Array<SharingReviewDocument['findings'][number]> = [];
  const add = (id: string, state: FindingState, label: string, detail: string) => findings.push({ id, state, label, detail });
  add('integrity', integrity === 'failed' ? 'block' : integrity === 'verified' ? 'pass' : 'caution', 'Artefact integrity',
    integrity === 'verified'
      ? 'The artefact passed its supported local integrity contract.'
      : integrity === 'structure_only'
        ? 'The artefact passed its structural contract but has no verified content digest.'
        : integrity === 'projection_integrity'
          ? 'The artefact passed its structural contract and projection digests, but those digests do not cover the whole file.'
        : integrity === 'unsupported'
          ? 'This artefact schema has no supported local integrity verifier; review its producer and digest contract manually.'
          : 'The artefact failed its supported structure or integrity contract.');
  add('human-review', options.humanReviewed ? 'pass' : 'block', 'Human review', options.humanReviewed
    ? 'A deliberate human review was recorded for this sharing decision.'
    : 'Complete a deliberate human review before sharing.');
  add('personal-data', options.personalDataReviewed ? 'pass' : scan.riskyKeyCount ? 'block' : 'caution', 'Personal-data review', options.personalDataReviewed
    ? 'A personal-data necessity review was recorded.'
    : scan.riskyKeyCount
      ? `The bounded key scan found ${scan.riskyKeyCount} field names that can carry raw, contact, credential, or session material.`
      : 'No personal-data review was recorded; a bounded key scan cannot prove personal data is absent.');
  add('redactions', options.redactionsConfirmed ? 'pass' : scan.riskyKeyCount ? 'block' : 'caution', 'Redaction review', options.redactionsConfirmed
    ? 'A deliberate redaction review was recorded.'
    : 'Confirm that secrets, unnecessary contacts, query strings, fragments, credentials, and unrelated evidence have been removed.');
  add('marking', importedRank > requestedRank ? 'block' : 'pass', 'Sharing marking', importedRank > requestedRank
    ? `${tlpLabel(options.marking)} is less restrictive than imported ${tlpLabel(strictestImported!)} evidence.`
    : strictestImported
      ? `The requested marking preserves the strictest imported marking (${tlpLabel(strictestImported)}).`
      : 'No recognised imported TLP 2.0 marking was found in the bounded scan.');
  add('recipient-scope', options.recipientScope === expectedScope(effective) ? 'pass' : 'block', 'Recipient scope',
    options.recipientScope === expectedScope(effective)
      ? `The recipient scope matches the effective ${tlpLabel(effective)} sharing boundary.`
      : `${tlpLabel(effective)} requires the ${expectedScope(effective)} recipient scope in this local policy.`);
  if (scan.truncated) add('scan-bounds', 'caution', 'Bounded content scan', 'The defensive key and marking scan reached a traversal bound; review the artefact manually.');

  const counts = {
    block: findings.filter((finding) => finding.state === 'block').length,
    caution: findings.filter((finding) => finding.state === 'caution').length,
    pass: findings.filter((finding) => finding.state === 'pass').length,
  };
  const artifactSchema = boundedMetadataText(artifact.schema);
  const rawArtifactVersion = artifact.version ?? artifact.schemaVersion;
  const artifactVersion = Number.isSafeInteger(rawArtifactVersion)
    && Number(rawArtifactVersion) >= 1
    && Number(rawArtifactVersion) <= 10_000
    ? Number(rawArtifactVersion)
    : null;
  const artifactMetadataFieldsEmitted = (
    Number(artifactSchema !== null) + Number(artifactVersion !== null)
  ) as 0 | 1 | 2;
  return {
    schema: SHARING_REVIEW_SCHEMA,
    version: SHARING_REVIEW_VERSION,
    generatedAt,
    artifact: {
      schema: artifactSchema,
      version: artifactVersion,
      integrity,
    },
    sharing: {
      requestedMarking: tlpLabel(options.marking),
      strictestImportedMarking: strictestImported ? tlpLabel(strictestImported) : null,
      effectiveMarking: tlpLabel(effective),
      recipientScope: options.recipientScope,
      purposeRecorded: true,
    },
    findings,
    summary: {
      ...counts,
      status: counts.block ? 'blocked' : counts.caution ? 'review_cautions' : 'ready',
    },
    privacy: { artifactMetadataFieldsEmitted, contentValuesEmitted: 0, rawEvidenceCopied: 0 },
    limitations: [
      'This is a local pre-sharing lint, not legal advice, recipient authorisation, or proof that the artefact is accurate, current, complete, or safe to disclose.',
      'TLP 2.0 labels describe sharing boundaries; they do not replace source-specific terms, privacy obligations, confidentiality agreements, or recipient policy.',
      'The personal-data scan is bounded and key-based. It can miss sensitive meaning and therefore never replaces deliberate human review.',
      'The recorded purpose is required for analyst accountability but is intentionally omitted from machine output to avoid copying potentially sensitive case context.',
    ],
  };
}

function formatSharingReview(document: SharingReviewDocument): string {
  const output = [
    'Evidence sharing review',
    `Status             ${document.summary.status.replaceAll('_', ' ')}`,
    `Effective marking  ${document.sharing.effectiveMarking}`,
    `Recipient scope    ${document.sharing.recipientScope.replaceAll('-', ' ')}`,
    `Integrity          ${document.artifact.integrity.replaceAll('_', ' ')}`,
    '',
  ];
  for (const finding of document.findings) {
    output.push(`${finding.label} [${finding.state}]`);
    output.push(`  ${finding.detail}`);
  }
  output.push('', 'Limitations:');
  for (const limitation of document.limitations) output.push(`  - ${limitation}`);
  return `${output.join('\n')}\n`;
}

export {
  MAX_SHARING_REVIEW_BYTES,
  RECIPIENT_SCOPES,
  SHARING_REVIEW_SCHEMA,
  SHARING_REVIEW_VERSION,
  TLP_MARKINGS,
  buildSharingReview,
  formatSharingReview,
};
export type { RecipientScope, SharingReviewDocument, SharingReviewOptions, TlpMarking };
