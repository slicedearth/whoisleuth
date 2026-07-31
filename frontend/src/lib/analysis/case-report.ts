// Pure, framework-neutral analyst-case report builder. Produces structured
// JSON and readable Markdown from a single CaseRecord, using the committed
// case-model contracts (CaseEvidenceSnapshot, compareCaseEvidence,
// latestCaseEvidence). No browser globals, no DOM access — Node-testable with
// node --test.
//
// The Lookup evidence export (evidence-export.ts) is a separate format that
// contains raw RDAP/WHOIS material. This module deliberately excludes all raw
// registry/web responses, contacts, cookies, screenshots, and authentication
// data. Reports contain only the normalized case record.

import { caseEvidenceIncomparableReasons, compareCaseEvidence, latestCaseEvidence } from './case-model.ts';
import type { CaseEvidenceSnapshot, CaseRecord, EvidenceFactor } from './case-model.ts';
import { httpSecurityHeaderLabel } from './http-summary.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CASE_REPORT_SCHEMA = 'whoisleuth.case-report';
export const CASE_REPORT_SCHEMA_VERSION = 3;

const APPLICATION_NAME = 'WHOISleuth';

const LIMITATIONS_TEXT = [
  'This report contains normalized browser-local observations from WHOISleuth analyst cases.',
  'It is not a live lookup and does not contain raw WHOIS, RDAP, DNS, HTML, or responses collected during website checks.',
  'Absence of a signal (e.g. no MX record observed) does not prove nonexistence. It may not have been evaluated.',
  'Snapshot fingerprints are deduplication identifiers, not cryptographic evidence hashes.',
  'Scan-depth and risk-model gates prevent misleading comparisons; "incomparable" means observations differ materially but one or more fields cannot be compared reliably.',
  'Generated locally in the browser. Review the package before sharing it.',
].join(' ');

// ---------------------------------------------------------------------------
// Markdown escaping — all stored strings are untrusted
// ---------------------------------------------------------------------------

/**
 * Escapes a single line of text so it cannot inject Markdown syntax
 * (headings, bold/italic, links, images, inline HTML, code spans, or fenced
 * blocks). Designed for short inline values like domains, tags, registrar
 * names, and field labels.
 * @param {string} text
 * @returns {string}
 */
type ReportOptions = { includeNotes?: boolean; generatedAt?: string };
type ReportReason = 'scan-depth' | 'risk-model' | 'other';
type ReportChange = ReturnType<typeof compareCaseEvidence>[number];
type ReportTimelineEntry = {
  snapshot: CaseEvidenceSnapshot;
  isBaseline: boolean;
  hasRepeatedObservation: boolean;
  changes: ReportChange[] | null;
  hasIncomparableChange: boolean;
  incomparableReasons: ReportReason[];
};
type CaseReportJson = {
  schema: typeof CASE_REPORT_SCHEMA;
  schemaVersion: typeof CASE_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  application: { name: string };
  case: {
    id: string;
    domain: string;
    status: string;
    disposition: string;
    tags: string[];
    source: string;
    openedAt: string;
    updatedAt: string;
    notesIncluded: boolean;
    notes?: Array<{ createdAt: string; body: string }>;
  };
  currentAssessment: CaseEvidenceSnapshot | null;
  evidenceTimeline: ReportTimelineEntry[];
  analystResponse: {
    evidencePins: CaseRecord['evidencePins'];
    decisions: CaseRecord['decisions'];
    actions: CaseRecord['actions'];
    assertions: CaseRecord['assertions'];
    manualTrail: CaseRecord['manualTrail'];
  };
  limitations: string;
};

function escapeMarkdownInline(text: unknown): string {
  return String(text)
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/([\\`*_{}\[\]<>()#+!|~])/g, '\\$1')
    // GFM autolinks bare URLs independently of ordinary link syntax. Break
    // the scheme or the first `www.` separator without making normal domains,
    // dates, and prose noisy in the report source.
    .replace(/\b([a-z][a-z0-9+.-]{1,31}):(?=\/\/)/gi, '$1\\:')
    .replace(/\bwww\.(?=\S)/gi, 'www\\.');
}

/**
 * Escapes a multiline note body for safe inclusion in a Markdown blockquote.
 * Each line is individually escaped and prefixed with `> `.
 * @param {string} text
 * @returns {string}
 */
function escapeMarkdownNote(text: unknown): string {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `> ${escapeMarkdownInline(line)}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Value formatting for reports
// ---------------------------------------------------------------------------

/**
 * Formats a snapshot field value for report output. Never returns raw `null`,
 * `undefined`, or `[object Object]`.
 * @param {unknown} value
 * @param {string} [field]
 * @returns {string}
 */
function formatReportValue(value: unknown, field?: string): string {
  if (value === null || value === undefined) return 'Not observed';
  if (typeof value === 'boolean') return value ? 'Detected' : 'Not detected';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (field === 'riskFactors' || field === 'opportunityFactors') {
      return value.map((f) => {
        if (typeof f === 'object' && f !== null && 'label' in f && 'points' in f) {
          return `${f.label} (${f.points > 0 ? '+' : ''}${f.points})`;
        }
        return String(f);
      }).join(', ');
    }
    return value.join(', ');
  }
  if (typeof value === 'number') return String(value);
  return String(value);
}

/**
 * Returns a shallow clone of a snapshot containing only known schema fields.
 * Unknown/imported keys are never included.
 * @param {import('./case-model.ts').CaseEvidenceSnapshot} snapshot
 * @returns {object}
 */
function pickKnownSnapshotFields(snapshot: CaseEvidenceSnapshot): CaseEvidenceSnapshot {
  const factors = (value: unknown): EvidenceFactor[] => Array.isArray(value)
    ? value.map((factor) => {
      const item = factor && typeof factor === 'object' ? factor as Record<string, unknown> : {};
      return { label: String(item.label ?? ''), points: Number(item.points) || 0 };
    })
    : [];
  return {
    id: snapshot.id,
    fingerprint: snapshot.fingerprint,
    firstCapturedAt: snapshot.firstCapturedAt,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    scanDepth: snapshot.scanDepth,
    availability: snapshot.availability,
    confidence: snapshot.confidence,
    riskModelVersion: snapshot.riskModelVersion,
    riskScore: snapshot.riskScore,
    opportunityScore: snapshot.opportunityScore,
    riskFactors: factors(snapshot.riskFactors),
    opportunityFactors: factors(snapshot.opportunityFactors),
    registrar: snapshot.registrar,
    createdDate: snapshot.createdDate,
    expiryDate: snapshot.expiryDate,
    nameservers: Array.isArray(snapshot.nameservers) ? [...snapshot.nameservers] : [],
    hasMx: snapshot.hasMx,
    hasSpf: snapshot.hasSpf,
    hasDmarc: snapshot.hasDmarc,
    activityStatus: snapshot.activityStatus,
    websiteProbeDetail: snapshot.websiteProbeDetail,
    pageTitle: snapshot.pageTitle,
    httpSummaryVersion: snapshot.httpSummaryVersion,
    httpEvidenceStatus: snapshot.httpEvidenceStatus,
    httpFinalOrigin: snapshot.httpFinalOrigin,
    httpResponseStatus: snapshot.httpResponseStatus,
    httpTransportSecurity: snapshot.httpTransportSecurity,
    httpRedirectCount: snapshot.httpRedirectCount,
    httpCrossOriginRedirect: snapshot.httpCrossOriginRedirect,
    httpHttpsDowngrade: snapshot.httpHttpsDowngrade,
    httpContentType: snapshot.httpContentType,
    httpSecurityHeaders: Array.isArray(snapshot.httpSecurityHeaders) ? [...snapshot.httpSecurityHeaders] : null,
    faviconMatch: snapshot.faviconMatch,
    faviconNearMatch: snapshot.faviconNearMatch,
    reusesOfficialAssets: snapshot.reusesOfficialAssets,
    hasPasswordField: snapshot.hasPasswordField,
    hasExternalFormAction: snapshot.hasExternalFormAction,
    phishingLanguageMatch: snapshot.phishingLanguageMatch,
    mutationTypes: Array.isArray(snapshot.mutationTypes) ? [...snapshot.mutationTypes] : [],
  };
}

// ---------------------------------------------------------------------------
// Report schema construction
// ---------------------------------------------------------------------------

/**
 * Builds a case report object and its Markdown representation from a single
 * CaseRecord. The returned object is a plain JSON-safe value; the Markdown is
 * a single string. Does not mutate the source record.
 *
 * @param {CaseRecord} caseRecord
 * @param {ReportOptions} [options]
 * @returns {{ json: object, markdown: string }}
 */
export function buildCaseReport(
  caseRecord: CaseRecord,
  options: ReportOptions = {},
): { json: CaseReportJson; markdown: string } {
  const { generatedAt } = options;
  const includeNotes = options.includeNotes === true;
  const now = generatedAt || new Date().toISOString();

  // --- Build JSON report ---

  const timelineEntries: ReportTimelineEntry[] = [];

  if (Array.isArray(caseRecord.evidenceHistory) && caseRecord.evidenceHistory.length > 0) {
    const chronological = [...caseRecord.evidenceHistory];
    for (let i = 0; i < chronological.length; i++) {
      const snapshot = chronological[i];
      if (!snapshot) continue;
      const isBaseline = i === 0;
      const hasRepeatedObservation = snapshot.firstCapturedAt !== snapshot.capturedAt;

      let changes: ReportChange[] | null = null;
      let hasIncomparableChange = false;
      let incomparableReasons: ReportReason[] = [];

      if (!isBaseline) {
        const previous = chronological[i - 1];
        if (!previous) continue;
        const rawChanges = compareCaseEvidence(previous, snapshot);
        incomparableReasons = caseEvidenceIncomparableReasons(previous, snapshot);
        if (rawChanges.length > 0) {
          changes = rawChanges.map((change) => ({
            field: change.field,
            label: change.label,
            before: change.before,
            after: change.after,
            tone: change.tone,
          }));
        } else if (snapshot.fingerprint !== previous.fingerprint && incomparableReasons.length === 0) {
          incomparableReasons = ['other'];
        }
        hasIncomparableChange = incomparableReasons.length > 0;
      }

      timelineEntries.push({
        snapshot: pickKnownSnapshotFields(snapshot),
        isBaseline,
        hasRepeatedObservation,
        changes,
        hasIncomparableChange,
        incomparableReasons,
      });
    }
  }

  const latest = latestCaseEvidence({ evidenceHistory: caseRecord.evidenceHistory ?? undefined });
  const currentAssessment = latest ? pickKnownSnapshotFields(latest) : null;

  const json: CaseReportJson = {
    schema: CASE_REPORT_SCHEMA,
    schemaVersion: CASE_REPORT_SCHEMA_VERSION,
    generatedAt: now,
    application: { name: APPLICATION_NAME },
    case: {
      id: caseRecord.id,
      domain: caseRecord.domain,
      status: caseRecord.status,
      disposition: caseRecord.disposition,
      tags: Array.isArray(caseRecord.tags) ? [...caseRecord.tags] : [],
      source: caseRecord.source,
      openedAt: caseRecord.createdAt,
      updatedAt: caseRecord.updatedAt,
      notesIncluded: includeNotes,
      ...(includeNotes && Array.isArray(caseRecord.notes) ? { notes: caseRecord.notes.map((n) => ({ createdAt: n.createdAt, body: n.body })) } : {}),
    },
    currentAssessment,
    evidenceTimeline: timelineEntries,
    analystResponse: {
      evidencePins: caseRecord.evidencePins.map((item) => ({ ...item, limitations: [...item.limitations] })),
      decisions: caseRecord.decisions.map((item) => ({ ...item, evidencePinIds: [...item.evidencePinIds] })),
      actions: caseRecord.actions.map((item) => ({ ...item, contactLimitations: [...item.contactLimitations] })),
      assertions: caseRecord.assertions.map((item) => ({
        ...item,
        evidencePinIds: [...item.evidencePinIds],
        ...(item.provenance ? {
          provenance: {
            ...item.provenance,
            labels: [...item.provenance.labels],
            markings: [...item.provenance.markings],
          },
        } : {}),
      })),
      manualTrail: caseRecord.manualTrail.map((item) => ({ ...item })),
    },
    limitations: LIMITATIONS_TEXT,
  };

  // --- Build Markdown ---

  const md = buildMarkdown(json);

  return { json, markdown: md };
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

/**
 * Builds a Markdown string from a case report JSON object.
 * @param {object} report
 * @returns {string}
 */
function buildMarkdown(report: CaseReportJson): string {
  const lines: string[] = [];

  // Title
  const domain = escapeMarkdownInline(report.case.domain || 'unknown');
  lines.push(`# Case Report: ${domain}`);
  lines.push('');

  // Metadata
  lines.push(`**Generated:** ${escapeMarkdownInline(report.generatedAt)}`);
  lines.push(`**Report schema:** ${escapeMarkdownInline(report.schema)} v${report.schemaVersion}`);
  lines.push('');

  // Status summary
  lines.push('## Status');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Status | ${escapeMarkdownInline(report.case.status)} |`);
  lines.push(`| Disposition | ${escapeMarkdownInline(report.case.disposition)} |`);
  lines.push(`| Source | ${escapeMarkdownInline(report.case.source)} |`);
  lines.push(`| Opened | ${escapeMarkdownInline(report.case.openedAt)} |`);
  lines.push(`| Updated | ${escapeMarkdownInline(report.case.updatedAt)} |`);
  if (report.case.tags.length > 0) {
    lines.push(`| Tags | ${escapeMarkdownInline(report.case.tags.join(', '))} |`);
  }
  lines.push(`| Notes included | ${report.case.notesIncluded ? 'Yes' : 'No'} |`);
  lines.push('');

  // Current assessment
  lines.push('## Current Assessment');
  lines.push('');
  if (report.currentAssessment) {
    const a = report.currentAssessment;
    lines.push(`- **Availability:** ${escapeMarkdownInline(formatReportValue(a.availability))}`);
    lines.push(`- **Risk score:** ${escapeMarkdownInline(formatReportValue(a.riskScore))}`);
    lines.push(`- **Risk model:** ${a.riskModelVersion === null ? 'Unversioned' : `v${escapeMarkdownInline(formatReportValue(a.riskModelVersion))}`}`);
    lines.push(`- **Registrar:** ${escapeMarkdownInline(formatReportValue(a.registrar))}`);
    lines.push(`- **Website activity:** ${escapeMarkdownInline(formatReportValue(a.activityStatus))}`);
    if (a.httpResponseStatus != null) lines.push(`- **HTTP response:** ${escapeMarkdownInline(formatReportValue(a.httpResponseStatus))}`);
    if (a.httpFinalOrigin) lines.push(`- **Final website origin:** ${escapeMarkdownInline(a.httpFinalOrigin)}`);
    lines.push(`- **Last captured:** ${escapeMarkdownInline(a.capturedAt)}`);
    lines.push(`- **Scan depth:** ${escapeMarkdownInline(formatReportValue(a.scanDepth))}`);
    lines.push(`- **Source:** ${escapeMarkdownInline(formatReportValue(a.source))}`);
  } else {
    lines.push('No evidence captured.');
  }
  lines.push('');

  // Evidence timeline
  lines.push('## Evidence Timeline');
  lines.push('');
  const timeline = report.evidenceTimeline || [];
  if (timeline.length === 0) {
    lines.push('No evidence snapshots recorded.');
    lines.push('');
  } else {
    lines.push(`${timeline.length} snapshot${timeline.length === 1 ? '' : 's'} (chronological order):`);
    lines.push('');

    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      if (!entry) continue;
      const snap = entry.snapshot;
      const index = i + 1;

      lines.push(`### ${index}. ${entry.isBaseline ? 'Baseline' : 'Observation'}: ${escapeMarkdownInline(snap.capturedAt)}`);
      lines.push('');

      if (entry.hasRepeatedObservation) {
        lines.push(`- **First observed:** ${escapeMarkdownInline(snap.firstCapturedAt)}`);
        lines.push(`- **Last observed:** ${escapeMarkdownInline(snap.capturedAt)}`);
      }
      lines.push(`- **Source:** ${escapeMarkdownInline(snap.source)}`);
      lines.push(`- **Scan depth:** ${escapeMarkdownInline(formatReportValue(snap.scanDepth))}`);

      if (entry.isBaseline) {
        lines.push(`- **Baseline:** first recorded observation`);
      }
      lines.push('');

      // Key evidence fields
      lines.push('**Key evidence:**');
      lines.push('');
      lines.push(`- Availability: ${escapeMarkdownInline(formatReportValue(snap.availability))}`);
      lines.push(`- Risk score: ${escapeMarkdownInline(formatReportValue(snap.riskScore))}`);
      lines.push(`- Risk model: ${snap.riskModelVersion === null ? 'Unversioned' : `v${escapeMarkdownInline(formatReportValue(snap.riskModelVersion))}`}`);
      lines.push(`- Registrar: ${escapeMarkdownInline(formatReportValue(snap.registrar))}`);
      lines.push(`- Website activity: ${escapeMarkdownInline(formatReportValue(snap.activityStatus))}`);
      if (snap.httpResponseStatus != null) lines.push(`- HTTP response: ${escapeMarkdownInline(formatReportValue(snap.httpResponseStatus))}`);
      if (snap.httpFinalOrigin) lines.push(`- Final website origin: ${escapeMarkdownInline(snap.httpFinalOrigin)}`);
      if (snap.httpTransportSecurity) lines.push(`- Website transport: ${escapeMarkdownInline(snap.httpTransportSecurity.toUpperCase())}`);
      if (snap.httpRedirectCount != null) lines.push(`- HTTP redirects: ${escapeMarkdownInline(formatReportValue(snap.httpRedirectCount))}`);
      if (snap.httpHttpsDowngrade === true) lines.push('- HTTPS downgrade: Detected');
      if (Array.isArray(snap.httpSecurityHeaders)) {
        const labels = snap.httpSecurityHeaders.map(httpSecurityHeaderLabel);
        lines.push(`- Observed security headers: ${escapeMarkdownInline(labels.length ? labels.join(', ') : 'None')}`);
      }
      if (snap.pageTitle) {
        lines.push(`- Page title: ${escapeMarkdownInline(formatReportValue(snap.pageTitle))}`);
      }
      if (Array.isArray(snap.nameservers) && snap.nameservers.length > 0) {
        lines.push(`- Nameservers: ${escapeMarkdownInline(snap.nameservers.join(', '))}`);
      }
      if (snap.hasMx !== null && snap.hasMx !== undefined) {
        lines.push(`- MX: ${escapeMarkdownInline(formatReportValue(snap.hasMx))}`);
      }
      if (snap.hasSpf !== null && snap.hasSpf !== undefined) {
        lines.push(`- SPF: ${escapeMarkdownInline(formatReportValue(snap.hasSpf))}`);
      }
      if (snap.hasDmarc !== null && snap.hasDmarc !== undefined) {
        lines.push(`- DMARC: ${escapeMarkdownInline(formatReportValue(snap.hasDmarc))}`);
      }
      if (snap.faviconMatch !== null && snap.faviconMatch !== undefined) {
        lines.push(`- Official favicon match: ${escapeMarkdownInline(formatReportValue(snap.faviconMatch))}`);
      }
      if (Array.isArray(snap.mutationTypes) && snap.mutationTypes.length > 0) {
        lines.push(`- Mutation types: ${escapeMarkdownInline(snap.mutationTypes.join(', '))}`);
      }
      if (Array.isArray(snap.riskFactors) && snap.riskFactors.length > 0) {
        lines.push(`- Risk factors: ${escapeMarkdownInline(formatReportValue(snap.riskFactors, 'riskFactors'))}`);
      }
      lines.push('');

      // Material changes
      if (entry.changes && entry.changes.length > 0) {
        lines.push('**Material changes from previous observation:**');
        lines.push('');
        for (const change of entry.changes) {
          const beforeText = formatReportValue(change.before, change.field);
          const afterText = formatReportValue(change.after, change.field);
          lines.push(`- **${escapeMarkdownInline(change.label)}** (${escapeMarkdownInline(change.tone)}): ${escapeMarkdownInline(beforeText)} → ${escapeMarkdownInline(afterText)}`);
        }
        lines.push('');
      }
      if (entry.hasIncomparableChange) {
        const reasons = Array.isArray(entry.incomparableReasons) ? entry.incomparableReasons : [];
        if (reasons.includes('risk-model')) lines.push('> Risk scores and factors use different or unversioned models, so their numeric difference is not treated as a domain change.');
        if (reasons.includes('scan-depth')) lines.push('> Capture depths differ, so unevaluated deep signals are not treated as additions or removals.');
        if (reasons.length === 0 || reasons.includes('other')) lines.push('> The observations differ materially, but no reliable field-level comparison is available.');
        lines.push('');
      }
    }
  }

  lines.push('## Analyst Decision Packet');
  lines.push('');
  const response = report.analystResponse;
  if (!response.evidencePins.length && !response.decisions.length && !response.actions.length && !response.assertions.length && !response.manualTrail.length) {
    lines.push('No evidence pins, structured assertions, decision records, case actions, or manual investigation steps recorded.');
    lines.push('');
  } else {
    lines.push('### Evidence pins');
    lines.push('');
    if (!response.evidencePins.length) lines.push('No evidence pins recorded.');
    for (const pin of response.evidencePins) {
      lines.push(`- **${escapeMarkdownInline(pin.label)}:** ${escapeMarkdownInline(pin.value)}`);
      lines.push(`  Source: ${escapeMarkdownInline(pin.source)}; observed ${escapeMarkdownInline(pin.observedAt)}; completeness ${escapeMarkdownInline(pin.completeness)}.`);
      if (pin.limitations.length) lines.push(`  Limitations: ${escapeMarkdownInline(pin.limitations.join('; '))}`);
    }
    lines.push('');
    for (const section of [
      { kind: 'verified_fact', heading: 'Verified facts' },
      { kind: 'hypothesis', heading: 'Hypotheses' },
      { kind: 'unknown', heading: 'Unknowns' },
      { kind: 'contradiction', heading: 'Contradictory evidence' },
      { kind: 'next_step', heading: 'Recommended next manual steps' },
    ] as const) {
      lines.push(`### ${section.heading}`);
      lines.push('');
      const assertions = response.assertions.filter((item) => item.kind === section.kind);
      if (!assertions.length) lines.push(`No ${section.heading.toLowerCase()} recorded.`);
      for (const assertion of assertions) {
        lines.push(`- **${escapeMarkdownInline(assertion.state)}:** ${escapeMarkdownInline(assertion.statement)}`);
        if (assertion.rationale) lines.push(`  ${escapeMarkdownInline(assertion.rationale)}`);
        if (assertion.provenance) {
          lines.push(`  External provenance: ${escapeMarkdownInline(assertion.provenance.format.toUpperCase())}; source ${escapeMarkdownInline(assertion.provenance.sourceName)}; file SHA-256 ${escapeMarkdownInline(assertion.provenance.sourceDigestSha256)}.`);
          if (assertion.provenance.publisher) lines.push(`  Publisher: ${escapeMarkdownInline(assertion.provenance.publisher)}`);
          if (assertion.provenance.externalId) lines.push(`  External ID: ${escapeMarkdownInline(assertion.provenance.externalId)}`);
          if (assertion.provenance.observedAt) lines.push(`  Externally reported observation time: ${escapeMarkdownInline(assertion.provenance.observedAt)}`);
          if (assertion.provenance.labels.length) lines.push(`  Labels: ${escapeMarkdownInline(assertion.provenance.labels.join(', '))}`);
          if (assertion.provenance.markings.length) lines.push(`  Markings: ${escapeMarkdownInline(assertion.provenance.markings.join(', '))}`);
        }
        if (assertion.evidencePinIds.length) lines.push(`  Evidence pins: ${escapeMarkdownInline(assertion.evidencePinIds.join(', '))}`);
      }
      lines.push('');
    }
    lines.push('### Decisions');
    lines.push('');
    if (!response.decisions.length) lines.push('No decision records recorded.');
    for (const decision of response.decisions) {
      lines.push(`- **${escapeMarkdownInline(decision.summary)}** (${escapeMarkdownInline(decision.createdAt)})`);
      lines.push(`  ${escapeMarkdownInline(decision.rationale)}`);
      if (decision.evidencePinIds.length) lines.push(`  Evidence pins: ${escapeMarkdownInline(decision.evidencePinIds.join(', '))}`);
    }
    lines.push('');
    lines.push('### Actions and outcomes');
    lines.push('');
    if (!response.actions.length) lines.push('No case actions recorded.');
    for (const action of response.actions) {
      lines.push(`- **${escapeMarkdownInline(action.type.replaceAll('_', ' '))}:** ${escapeMarkdownInline(action.recipient)} (${escapeMarkdownInline(action.state)})`);
      lines.push(`  Contact source: ${escapeMarkdownInline(action.contactSource)}; updated ${escapeMarkdownInline(action.updatedAt)}.`);
      if (action.dueAt) lines.push(`  Due: ${escapeMarkdownInline(action.dueAt)}`);
      if (action.followUpAt) lines.push(`  Follow-up: ${escapeMarkdownInline(action.followUpAt)}`);
      if (action.reference) lines.push(`  Reference: ${escapeMarkdownInline(action.reference)}`);
      if (action.outcome) lines.push(`  Outcome: ${escapeMarkdownInline(action.outcome)}`);
      if (action.contactLimitations.length) lines.push(`  Contact limitations: ${escapeMarkdownInline(action.contactLimitations.join('; '))}`);
    }
    lines.push('');
    lines.push('### Explicit investigation trail');
    lines.push('');
    if (!response.manualTrail.length) lines.push('No manual pivots, handoffs, or review steps recorded. Browser navigation is not tracked.');
    for (const item of response.manualTrail) {
      lines.push(`- **${escapeMarkdownInline(item.kind)}** (${escapeMarkdownInline(item.createdAt)}): ${escapeMarkdownInline(item.summary)}`);
      if (item.target) lines.push(`  Target: ${escapeMarkdownInline(item.target)}`);
    }
    lines.push('');
  }

  // Analyst notes (only when included)
  if (report.case.notesIncluded && Array.isArray(report.case.notes) && report.case.notes.length > 0) {
    lines.push('## Analyst Notes');
    lines.push('');
    lines.push('> **Warning:** Notes may contain sensitive investigation detail. Review before sharing.');
    lines.push('');
    for (const note of report.case.notes) {
      lines.push(`**${escapeMarkdownInline(note.createdAt)}**`);
      lines.push('');
      lines.push(escapeMarkdownNote(note.body));
      lines.push('');
    }
  }

  // Limitations
  lines.push('---');
  lines.push('');
  lines.push('## Limitations & Provenance');
  lines.push('');
  lines.push(LIMITATIONS_TEXT);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Filename generation
// ---------------------------------------------------------------------------

/**
 * Produces a safe, bounded filesystem name for a case report download.
 * Contains no path separators, control characters, or unbounded user content.
 * @param {string} domain - the case domain
 * @param {'json' | 'md'} format
 * @param {string} [generatedAt] - ISO timestamp (injectable for tests)
 * @returns {string}
 */
export function caseReportFilename(
  domain: unknown,
  format: 'json' | 'md',
  generatedAt?: string,
): string {
  const safeDomain = String(domain || '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'case';

  const ext = format === 'md' ? 'md' : 'json';
  const ts = String(generatedAt || new Date().toISOString());
  const safeTs = ts
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'undated';

  return `whoisleuth-case-${safeDomain}-${safeTs}.${ext}`;
}
