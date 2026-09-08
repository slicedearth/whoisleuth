import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import {
  BULK_SESSION_SCHEMA,
  MAX_BULK_SESSIONS,
  MAX_BULK_SESSION_ROWS,
  SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS,
  mergeBulkSessions,
  normalizeBulkSession,
  type BulkSession,
} from '../packages/workspace/bulk-session-model.mts';
import { buildBulkComparisonCandidates } from '../packages/comparison/comparison-ledger-bulk.mts';
import {
  MAX_COMPARISON_LEDGER_DETAIL_ROWS,
  boundedComparisonLedgerLimitations,
  comparisonLedgerCollector,
  comparisonLedgerValuePresent,
  freshComparisonLedgerCounters,
  makeComparisonLedgerCandidate,
  normaliseComparisonLedgerRowWithCounters,
  stableComparisonLedgerId,
  stableComparisonLedgerJson,
  type ComparisonLedgerCandidate,
  type ComparisonLedgerDetails,
  type ComparisonLedgerIndex,
  type MutableComparisonLedgerCounters,
  type RawComparisonLedgerProjection,
} from '../packages/comparison/comparison-ledger-contract.mts';
import {
  DOMAIN_PORTFOLIO_INPUT_SCHEMA,
  DOMAIN_PORTFOLIO_REVIEW_SCHEMA,
  DOMAIN_PORTFOLIO_REVIEW_VERSION,
  reviewDomainPortfolio,
} from '../lib/domain-portfolio-review.mts';
import { parseBoundedJsonObject } from './bounded-json.mts';
import { CliUsageError } from './errors.mts';
import { buildCliLookupDiff, formatCliLookupDiff, type CliLookupDiffDocument } from './lookup-diff.mts';
import { SAVED_LOOKUP_SCHEMA } from './saved-lookup.mts';
import {
  CLI_COMPARISON_LEDGER_SCHEMA,
  CLI_COMPARISON_LEDGER_VERSION,
  MAX_RETAINED_ARTIFACT_DIFF_BYTES,
} from '../packages/contracts/offline-comparison.mts';

export { CLI_COMPARISON_LEDGER_SCHEMA, CLI_COMPARISON_LEDGER_VERSION, MAX_RETAINED_ARTIFACT_DIFF_BYTES };

type UnknownRecord = Record<string, unknown>;
type ArtifactFamily = 'bulk_sessions' | 'domain_portfolio';
type RetainedSide = Readonly<{
  schema: string;
  version: number;
  id: string;
  label: string;
  retainedAt: string;
}>;

export type CliComparisonLedgerDocument = Readonly<{
  schema: typeof CLI_COMPARISON_LEDGER_SCHEMA;
  version: typeof CLI_COMPARISON_LEDGER_VERSION;
  generatedAt: string;
  artifactFamily: ArtifactFamily;
  left: RetainedSide;
  right: RetainedSide;
  index: ComparisonLedgerIndex;
  details: ComparisonLedgerDetails;
  limitations: readonly string[];
}>;

export type CliRetainedArtifactDiffDocument = CliLookupDiffDocument | CliComparisonLedgerDocument;
export type CliRetainedArtifactDiffOptions = Readonly<{
  leftSessionId?: string | null;
  rightSessionId?: string | null;
}>;

const BULK_ROOT_KEYS = new Set(['schema', 'version', 'generatedAt', 'sessions', 'limitations']);
const PORTFOLIO_ROOT_KEYS = new Set(['schema', 'version', 'generatedAt', 'portfolioLabel', 'assets', 'simulations', 'renewalQueue', 'recoveryCycles', 'unknownCounts', 'limitations']);
const SAFE_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function exactKeys(value: UnknownRecord, allowed: ReadonlySet<string>, label: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key)) || [...allowed].some((key) => !Object.hasOwn(value, key))) {
    throw new CliUsageError(`${label} does not match its exact retained export contract.`);
  }
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new CliUsageError(`${label} is missing or invalid.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new CliUsageError(`${label} is missing or invalid.`);
  return new Date(parsed).toISOString();
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function parseDocument(raw: string, label: string): UnknownRecord {
  try {
    return parseBoundedJsonObject(raw, { label, maximumBytes: MAX_RETAINED_ARTIFACT_DIFF_BYTES });
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function assertLimitations(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length > 8 || value.some((item) => (
    typeof item !== 'string' || item.length > 600 || /[\u0000-\u001f\u007f]/u.test(item)
  ))) throw new CliUsageError(`${label} limitations are invalid.`);
}

type ParsedBulkExport = Readonly<{
  version: number;
  generatedAt: string;
  sessions: readonly BulkSession[];
}>;

function parseBulkExport(root: UnknownRecord): ParsedBulkExport {
  exactKeys(root, BULK_ROOT_KEYS, 'Bulk session export');
  const version = Number(root.version);
  if (root.schema !== BULK_SESSION_SCHEMA || !SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS.includes(version)) {
    throw new CliUsageError(`Bulk session exports must use a supported ${BULK_SESSION_SCHEMA} version.`);
  }
  const generatedAt = timestamp(root.generatedAt, 'Bulk session export generatedAt');
  assertLimitations(root.limitations, 'Bulk session export');
  if (!Array.isArray(root.sessions) || root.sessions.length < 1 || root.sessions.length > MAX_BULK_SESSIONS) {
    throw new CliUsageError(`Bulk session exports used by diff must contain from 1 to ${MAX_BULK_SESSIONS} sessions.`);
  }
  const ids = new Set<string>();
  for (const [index, candidate] of root.sessions.entries()) {
    const rawSession = record(candidate);
    const rawResults = Array.isArray(rawSession?.results) ? rawSession.results : null;
    const rawDomains = Array.isArray(rawSession?.domains) ? rawSession.domains : null;
    const session = normalizeBulkSession(candidate, version);
    if (!session || !rawResults || !rawDomains
      || rawResults.length > MAX_BULK_SESSION_ROWS
      || rawResults.length !== session.results.length
      || rawDomains.length !== session.domains.length
      || ids.has(session.id)) {
      throw new CliUsageError(`Bulk session export row ${index + 1} is malformed, duplicated, or would be silently omitted.`);
    }
    ids.add(session.id);
  }
  const imported = mergeBulkSessions([], root);
  if (imported.skipped || imported.pruned || imported.sessions.length !== root.sessions.length) {
    throw new CliUsageError('Bulk session export cannot be compared without omitting or pruning retained sessions.');
  }
  return Object.freeze({ version, generatedAt, sessions: Object.freeze(imported.sessions) });
}

function selectSession(document: ParsedBulkExport, requested: string | null | undefined, side: 'left' | 'right'): BulkSession {
  if (requested !== null && requested !== undefined && !SAFE_SESSION_ID_RE.test(requested)) {
    throw new CliUsageError(`The ${side} saved-session ID is invalid.`);
  }
  if (!requested && document.sessions.length !== 1) {
    throw new CliUsageError(`The ${side} Bulk export contains multiple sessions; select one with --${side}-session.`);
  }
  const selected = requested
    ? document.sessions.find((session) => session.id === requested)
    : document.sessions[0];
  if (!selected) throw new CliUsageError(`The selected ${side} saved session was not found.`);
  return selected;
}

function withoutOwnerHref(index: ComparisonLedgerIndex): ComparisonLedgerIndex {
  return Object.freeze({
    ...index,
    items: Object.freeze(index.items.map((item) => Object.freeze({ ...item, ownerHref: '' }))),
  });
}

function withoutDetailOwnerHref(details: ComparisonLedgerDetails): ComparisonLedgerDetails {
  return Object.freeze({
    ...details,
    selectedItems: Object.freeze(details.selectedItems.map((item) => Object.freeze({ ...item, ownerHref: '' }))),
  });
}

function buildBulkLedger(
  leftRaw: string,
  rightRaw: string,
  leftRoot: UnknownRecord,
  rightRoot: UnknownRecord,
  options: CliRetainedArtifactDiffOptions,
  generatedAt: string,
): CliComparisonLedgerDocument {
  const leftDocument = parseBulkExport(leftRoot);
  const rightDocument = parseBulkExport(rightRoot);
  const left = selectSession(leftDocument, options.leftSessionId, 'left');
  const right = selectSession(rightDocument, options.rightSessionId, 'right');
  if (left.updatedAt > right.updatedAt) throw new CliUsageError('Bulk diff requires the left saved session to be no later than the right saved session.');
  const leftTransientId = stableComparisonLedgerId('cli-bulk-left', [left.id, left.updatedAt, digest(leftRaw)]);
  const rightTransientId = stableComparisonLedgerId('cli-bulk-right', [right.id, right.updatedAt, digest(rightRaw)]);
  const transientLeft = { ...left, id: leftTransientId };
  const transientRight = { ...right, id: rightTransientId };
  const counters = freshComparisonLedgerCounters();
  const candidates = buildBulkComparisonCandidates(
    [transientLeft, transientRight],
    [{ earlierSessionId: leftTransientId, laterSessionId: rightTransientId }],
    counters,
  );
  const candidate = candidates[0];
  if (!candidate || candidates.length !== 1) throw new CliUsageError('The selected Bulk sessions are not a compatible chronological pair.');
  const projected = projectSingleCandidate(candidate, counters);
  return Object.freeze({
    schema: CLI_COMPARISON_LEDGER_SCHEMA,
    version: CLI_COMPARISON_LEDGER_VERSION,
    generatedAt: timestamp(generatedAt, 'Comparison ledger generatedAt'),
    artifactFamily: 'bulk_sessions',
    left: Object.freeze({ schema: BULK_SESSION_SCHEMA, version: leftDocument.version, id: left.id, label: left.name, retainedAt: left.updatedAt }),
    right: Object.freeze({ schema: BULK_SESSION_SCHEMA, version: rightDocument.version, id: right.id, label: right.name, retainedAt: right.updatedAt }),
    index: withoutOwnerHref(projected.index),
    details: withoutDetailOwnerHref(projected.details),
    limitations: Object.freeze([
      'The ledger compares one explicit chronological pair of compact retained Bulk sessions without making a request or reading source file paths.',
      'Portable session claims are treated as unauthenticated imports: profile-derived trust, matches, and Risk remain quarantined while independent retained source fields can still be reviewed.',
      'Missing later rows are not domain removals, releases, resolution changes, or availability findings.',
    ]),
  });
}

type PortfolioReview = ReturnType<typeof reviewDomainPortfolio>;

function parsePortfolioReview(root: UnknownRecord): PortfolioReview {
  exactKeys(root, PORTFOLIO_ROOT_KEYS, 'Domain portfolio review');
  if (root.schema !== DOMAIN_PORTFOLIO_REVIEW_SCHEMA || root.version !== DOMAIN_PORTFOLIO_REVIEW_VERSION) {
    throw new CliUsageError(`Domain portfolio reviews must use ${DOMAIN_PORTFOLIO_REVIEW_SCHEMA} version ${DOMAIN_PORTFOLIO_REVIEW_VERSION}.`);
  }
  const rebuilt = reviewDomainPortfolio({
    schema: DOMAIN_PORTFOLIO_INPUT_SCHEMA,
    version: 1,
    portfolioLabel: root.portfolioLabel,
    assets: root.assets,
  }, timestamp(root.generatedAt, 'Domain portfolio review generatedAt'));
  if (canonicalArtifactJsonV2(rebuilt) !== canonicalArtifactJsonV2(root)) {
    throw new CliUsageError('Domain portfolio review derived fields do not match its bounded source asset projection.');
  }
  return rebuilt;
}

const PORTFOLIO_FIELDS = Object.freeze([
  ['Criticality', 'portfolio', (item: UnknownRecord) => item.criticality],
  ['Registrar', 'registration', (item: UnknownRecord) => item.registrar],
  ['Registrar account label', 'registration', (item: UnknownRecord) => item.registrarAccount],
  ['Expiry', 'registration', (item: UnknownRecord) => item.expiresAt],
  ['Auto-renew', 'registration', (item: UnknownRecord) => item.autoRenew],
  ['DNS providers', 'dns', (item: UnknownRecord) => item.dnsProviders],
  ['Mail providers', 'mail', (item: UnknownRecord) => item.mailProviders],
  ['Certificate providers', 'certificate', (item: UnknownRecord) => item.certificateProviders],
  ['Recovery domains', 'recovery', (item: UnknownRecord) => item.recoveryDomains],
] as const);

function portfolioSide(report: PortfolioReview, value: unknown, observedAt: string | null = null) {
  return {
    source: `Retained domain portfolio · ${report.portfolioLabel}`,
    sourceState: 'analyst_supplied',
    value,
    observedAt,
    retainedAt: report.generatedAt,
  };
}

type PortfolioProjection = Readonly<{
  projection: RawComparisonLedgerProjection;
  incomplete: boolean;
}>;

function portfolioRows(ownerId: string, earlier: PortfolioReview, later: PortfolioReview): PortfolioProjection {
  const output = comparisonLedgerCollector();
  let incomplete = false;
  const before = new Map(earlier.assets.map((asset) => [asset.domain, asset]));
  const after = new Map(later.assets.map((asset) => [asset.domain, asset]));
  for (const domain of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const left = before.get(domain);
    const right = after.get(domain);
    if (!left && right) {
      output.add({ comparisonId: ownerId, ownerId, entityId: domain, mode: 'membership', state: 'added', field: 'Retained portfolio membership', family: 'membership', earlier: portfolioSide(earlier, null), later: portfolioSide(later, 'Included', right.reviewedAt), completeness: 'complete', limitations: ['Membership applies only to the two analyst-supplied retained portfolios; it is not evidence of registration, ownership, control, or activity.'] });
      continue;
    }
    if (left && !right) {
      incomplete = true;
      output.add({ comparisonId: ownerId, ownerId, entityId: domain, mode: 'membership', state: 'not_compared', field: 'Retained portfolio membership', family: 'membership', earlier: portfolioSide(earlier, 'Included', left.reviewedAt), later: portfolioSide(later, null), completeness: 'partial', limitations: ['The later retained portfolio omits this asset. That omission is not evidence of registration removal, release, loss of control, or inactivity.'] });
      continue;
    }
    if (!left || !right) continue;
    const leftRecord = left as unknown as UnknownRecord;
    const rightRecord = right as unknown as UnknownRecord;
    for (const [field, family, read] of PORTFOLIO_FIELDS) {
      const beforeValue = read(leftRecord);
      const afterValue = read(rightRecord);
      if (stableComparisonLedgerJson(beforeValue) === stableComparisonLedgerJson(afterValue)) continue;
      const afterPresent = comparisonLedgerValuePresent(afterValue);
      const beforePresent = comparisonLedgerValuePresent(beforeValue);
      if (beforePresent && !afterPresent) incomplete = true;
      output.add({
        comparisonId: ownerId,
        ownerId,
        entityId: domain,
        mode: 'temporal',
        state: !beforePresent && afterPresent ? 'added' : beforePresent && !afterPresent ? 'incomplete' : 'different',
        field,
        family,
        earlier: portfolioSide(earlier, beforeValue, left.reviewedAt),
        later: portfolioSide(later, afterValue, right.reviewedAt),
        completeness: beforePresent && !afterPresent ? 'partial' : 'complete',
        limitations: ['Values are bounded analyst-supplied portfolio assertions, not current provider observations or proof of ownership, configuration, or responsibility.'],
      });
    }
    if (left.reviewedAt !== right.reviewedAt) {
      output.add({ comparisonId: ownerId, ownerId, entityId: domain, mode: 'temporal', state: 'collection_changed', field: 'Analyst review time', family: 'collection', earlier: portfolioSide(earlier, left.reviewedAt, left.reviewedAt), later: portfolioSide(later, right.reviewedAt, right.reviewedAt), completeness: 'complete', limitations: ['Review-time movement records analyst retention context and is not a change to the domain or provider.'] });
    }
  }
  if (!output.totalRows) {
    output.add({ comparisonId: ownerId, ownerId, entityId: 'portfolio-summary', mode: 'temporal', state: 'equivalent', field: 'Bounded retained portfolio assertions', family: 'summary', earlier: portfolioSide(earlier, 'No bounded material difference'), later: portfolioSide(later, 'No bounded material difference'), completeness: 'complete', limitations: ['Equivalence applies only to the exact bounded analyst-supplied fields retained in both portfolio review documents.'] });
  }
  return Object.freeze({
    projection: Object.freeze({ rows: output.rows, totalRows: output.totalRows, sourceOmittedRows: 0 }),
    incomplete,
  });
}

function projectSingleCandidate(candidate: ComparisonLedgerCandidate, counters: MutableComparisonLedgerCounters): Readonly<{ index: ComparisonLedgerIndex; details: ComparisonLedgerDetails }> {
  const indexOmissions = Object.freeze({
    inputRecords: counters.inputRecords,
    inputScanTruncations: counters.inputScanTruncations,
    invalidRecords: counters.invalidRecords,
    duplicateRecords: counters.duplicateRecords,
    indexItems: 0,
    limitations: counters.limitations,
    truncatedStrings: counters.truncatedStrings,
  });
  const index: ComparisonLedgerIndex = Object.freeze({ items: Object.freeze([candidate.item]), counts: Object.freeze({ candidates: 1, retained: 1 }), omissions: indexOmissions, truncated: candidate.item.truncated || Object.values(indexOmissions).some((count) => count > 0) });
  const projection = candidate.buildDetails();
  const rows = [];
  const ids = new Set<string>();
  let invalidRows = 0;
  let duplicateRows = 0;
  for (const rawRow of projection.rows) {
    const row = normaliseComparisonLedgerRowWithCounters(rawRow, counters);
    if (!row) { invalidRows += 1; continue; }
    if (ids.has(row.id)) { duplicateRows += 1; continue; }
    ids.add(row.id);
    if (rows.length < MAX_COMPARISON_LEDGER_DETAIL_ROWS) rows.push(row);
  }
  rows.sort((left, right) => left.entityId.localeCompare(right.entityId) || left.family.localeCompare(right.family) || left.field.localeCompare(right.field) || left.id.localeCompare(right.id));
  const totalRows = Math.max(0, projection.totalRows - duplicateRows);
  const limitations = boundedComparisonLedgerLimitations(candidate.item.limitations, counters);
  const omissions = Object.freeze({
    inputRecords: counters.inputRecords,
    inputScanTruncations: counters.inputScanTruncations,
    invalidRecords: counters.invalidRecords + invalidRows,
    duplicateRecords: counters.duplicateRecords,
    indexItems: 0,
    entityRequests: 0,
    duplicateEntityRequests: 0,
    invalidEntityRequests: 0,
    missingEntities: 0,
    duplicateDetailRows: duplicateRows,
    detailRows: Math.max(0, totalRows - rows.length),
    sourceRows: projection.sourceOmittedRows,
    limitations: counters.limitations,
    truncatedStrings: counters.truncatedStrings,
  });
  const details: ComparisonLedgerDetails = Object.freeze({ selectedItems: Object.freeze([candidate.item]), rows: Object.freeze(rows), totalRows, limitations: limitations.values, omissions, truncated: candidate.item.truncated || Object.values(omissions).some((count) => count > 0) });
  return Object.freeze({ index, details });
}

function buildPortfolioLedger(leftRaw: string, rightRaw: string, leftRoot: UnknownRecord, rightRoot: UnknownRecord, generatedAt: string): CliComparisonLedgerDocument {
  const left = parsePortfolioReview(leftRoot);
  const right = parsePortfolioReview(rightRoot);
  if (left.generatedAt > right.generatedAt) throw new CliUsageError('Domain portfolio diff requires the left review to be no later than the right review.');
  const counters = freshComparisonLedgerCounters();
  const ownerId = stableComparisonLedgerId('retained-portfolio-pair', [digest(leftRaw), digest(rightRaw)]);
  const portfolioProjection = portfolioRows(ownerId, left, right);
  const { projection } = portfolioProjection;
  const completeness = portfolioProjection.incomplete ? 'partial' : 'complete';
  const projectionTruncated = projection.totalRows > projection.rows.length;
  const candidate = makeComparisonLedgerCandidate({
    idParts: [digest(leftRaw), digest(rightRaw)],
    ownerType: 'retained_artifact_pair',
    ownerId,
    entityId: 'domain-portfolio-pair',
    label: `${left.portfolioLabel} → ${right.portfolioLabel} · retained portfolio pair`,
    mode: 'temporal',
    earlier: portfolioSide(left, null),
    later: portfolioSide(right, null),
    completeness,
    truncated: projectionTruncated,
    limitations: [
      'This offline ledger compares bounded retained analyst-supplied portfolio assertions and makes no provider request.',
      ...(completeness === 'partial' ? ['At least one later omission is not represented as a real-world removal or resolved dependency.'] : []),
    ],
    ownerHref: '',
    buildDetails: () => projection,
  }, counters);
  if (!candidate) throw new CliUsageError('The retained domain portfolio pair could not be projected safely.');
  const projected = projectSingleCandidate(candidate, counters);
  return Object.freeze({
    schema: CLI_COMPARISON_LEDGER_SCHEMA,
    version: CLI_COMPARISON_LEDGER_VERSION,
    generatedAt: timestamp(generatedAt, 'Comparison ledger generatedAt'),
    artifactFamily: 'domain_portfolio',
    left: Object.freeze({ schema: DOMAIN_PORTFOLIO_REVIEW_SCHEMA, version: DOMAIN_PORTFOLIO_REVIEW_VERSION, id: digest(leftRaw), label: left.portfolioLabel, retainedAt: left.generatedAt }),
    right: Object.freeze({ schema: DOMAIN_PORTFOLIO_REVIEW_SCHEMA, version: DOMAIN_PORTFOLIO_REVIEW_VERSION, id: digest(rightRaw), label: right.portfolioLabel, retainedAt: right.generatedAt }),
    ...projected,
    limitations: Object.freeze([
      'Only the two explicitly selected retained review documents are compared; source file paths are not retained.',
      'Portfolio values are analyst-supplied context. They do not prove live configuration, registration, ownership, control, availability, or provider responsibility.',
    ]),
  });
}

export function buildCliRetainedArtifactDiff(
  leftRaw: string,
  rightRaw: string,
  options: CliRetainedArtifactDiffOptions = {},
  generatedAt = new Date().toISOString(),
): CliRetainedArtifactDiffDocument {
  if (Buffer.byteLength(leftRaw, 'utf8') + Buffer.byteLength(rightRaw, 'utf8') > MAX_RETAINED_ARTIFACT_DIFF_BYTES * 2) {
    throw new CliUsageError(`Retained diff input is limited to ${MAX_RETAINED_ARTIFACT_DIFF_BYTES * 2} bytes in total.`);
  }
  const left = parseDocument(leftRaw, 'Left retained diff input');
  const right = parseDocument(rightRaw, 'Right retained diff input');
  if (left.schema !== right.schema) throw new CliUsageError('diff requires two retained documents from the same supported artifact family.');
  if (left.schema === SAVED_LOOKUP_SCHEMA) {
    if (options.leftSessionId || options.rightSessionId) throw new CliUsageError('Saved-session selectors apply only to Bulk session exports.');
    return buildCliLookupDiff(leftRaw, rightRaw, generatedAt);
  }
  if (left.schema === BULK_SESSION_SCHEMA) return buildBulkLedger(leftRaw, rightRaw, left, right, options, generatedAt);
  if (left.schema === DOMAIN_PORTFOLIO_REVIEW_SCHEMA) {
    if (options.leftSessionId || options.rightSessionId) throw new CliUsageError('Saved-session selectors apply only to Bulk session exports.');
    return buildPortfolioLedger(leftRaw, rightRaw, left, right, generatedAt);
  }
  throw new CliUsageError('diff supports saved Lookups, Bulk session exports, or retained domain portfolio reviews.');
}

export function formatCliRetainedArtifactDiff(document: CliRetainedArtifactDiffDocument): string {
  if (document.schema !== CLI_COMPARISON_LEDGER_SCHEMA) return formatCliLookupDiff(document);
  const lines = [
    'Retained artifact comparison ledger',
    `Family           ${document.artifactFamily.replaceAll('_', ' ')}`,
    `Left             ${document.left.label} · ${document.left.id}`,
    `Right            ${document.right.label} · ${document.right.id}`,
    `Candidates       ${document.index.counts.retained}`,
    `Exact rows       ${document.details.rows.length} of ${document.details.totalRows}`,
    '',
  ];
  for (const row of document.details.rows) {
    lines.push(`${row.entityId} · ${row.field} [${row.state.replaceAll('_', ' ')}]`);
    lines.push(`  Earlier: ${row.earlier.value ?? 'not retained'} · ${row.earlier.sourceState}`);
    lines.push(`  Later:   ${row.later.value ?? 'not retained'} · ${row.later.sourceState}`);
  }
  if (document.details.omissions.detailRows) lines.push(`Omitted exact rows: ${document.details.omissions.detailRows}`);
  lines.push('', 'Limitations:');
  for (const limitation of document.limitations) lines.push(`  - ${limitation}`);
  return `${lines.join('\n')}\n`;
}
