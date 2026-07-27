// Pure, framework-neutral evidence-timeline display helpers. Consumes the
// committed case-model contract (CaseEvidenceSnapshot, compareCaseEvidence,
// latestCaseEvidence) and produces display-ready derivations and formatted
// values. No browser globals, no DOM access — Node-testable with node --test.

import { caseEvidenceIncomparableReasons, compareCaseEvidence, latestCaseEvidence } from './case-model.ts';
import type { CaseEvidenceSnapshot } from './case-model.ts';
import { httpSecurityHeaderLabel } from './http-summary.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Human labels for scanDepth machine values. */
const SCAN_DEPTH_LABELS = {
  fast: 'Fast scan',
  deep: 'Deep scan',
  unknown: 'Unknown depth',
};

/** Human labels for every known snapshot field. */
const FIELD_LABELS = {
  scanDepth: 'Scan depth',
  availability: 'Availability',
  confidence: 'Confidence',
  riskModelVersion: 'Risk model version',
  riskScore: 'Risk score',
  opportunityScore: 'Opportunity score',
  riskFactors: 'Risk factors',
  opportunityFactors: 'Opportunity factors',
  registrar: 'Registrar',
  createdDate: 'Creation date',
  expiryDate: 'Expiry date',
  nameservers: 'Nameservers',
  hasMx: 'MX',
  hasSpf: 'SPF',
  hasDmarc: 'DMARC',
  activityStatus: 'Website activity',
  websiteProbeDetail: 'Website check detail',
  pageTitle: 'Page title',
  httpEvidenceStatus: 'HTTP evidence status',
  httpFinalOrigin: 'Final website origin',
  httpResponseStatus: 'HTTP response status',
  httpTransportSecurity: 'Website transport',
  httpRedirectCount: 'HTTP redirect count',
  httpCrossOriginRedirect: 'Cross-origin redirect',
  httpHttpsDowngrade: 'HTTPS downgrade',
  httpContentType: 'Website content type',
  httpSecurityHeaders: 'Observed security headers',
  faviconMatch: 'Official favicon match',
  faviconNearMatch: 'Official favicon near-match',
  reusesOfficialAssets: 'Official asset reuse',
  hasPasswordField: 'Password form',
  phishingLanguageMatch: 'Phishing language',
  mutationTypes: 'Mutation types',
};

/** Fields grouped into display sections. Order within each group is deliberate. */
type SnapshotField = keyof CaseEvidenceSnapshot;
type EvidenceChange = ReturnType<typeof compareCaseEvidence>[number];
export type TimelineEntry = {
  snapshot: CaseEvidenceSnapshot;
  isBaseline: boolean;
  hasRepeatedObservation: boolean;
  changes: EvidenceChange[] | null;
  hasIncomparableChange: boolean;
  incomparableReasons: Array<'scan-depth' | 'risk-model' | 'other'>;
  displayIndex: number;
};
type SnapshotGroup = {
  name: string;
  rows: Array<{ field: SnapshotField; label: string; value: unknown }>;
};

const FIELD_GROUPS: Array<{ name: string; fields: SnapshotField[] }> = [
  {
    name: 'Registration',
    fields: ['availability', 'confidence', 'registrar', 'createdDate', 'expiryDate', 'nameservers'],
  },
  {
    name: 'Scoring',
    fields: ['riskModelVersion', 'riskScore', 'riskFactors', 'opportunityScore', 'opportunityFactors'],
  },
  {
    name: 'Mail and web',
    fields: ['hasMx', 'hasSpf', 'hasDmarc', 'activityStatus', 'websiteProbeDetail', 'pageTitle'],
  },
  {
    name: 'HTTP',
    fields: ['httpEvidenceStatus', 'httpFinalOrigin', 'httpResponseStatus', 'httpTransportSecurity', 'httpRedirectCount', 'httpCrossOriginRedirect', 'httpHttpsDowngrade', 'httpContentType', 'httpSecurityHeaders'],
  },
  {
    name: 'Impersonation',
    fields: ['faviconMatch', 'faviconNearMatch', 'reusesOfficialAssets', 'hasPasswordField', 'phishingLanguageMatch', 'mutationTypes'],
  },
];

// ---------------------------------------------------------------------------
// Public formatting helpers
// ---------------------------------------------------------------------------

/**
 * Human label for a scan depth machine value.
 * @param {string} depth
 * @returns {string}
 */
export function scanDepthLabel(depth: unknown): string {
  return typeof depth === 'string' && depth in SCAN_DEPTH_LABELS
    ? SCAN_DEPTH_LABELS[depth as keyof typeof SCAN_DEPTH_LABELS]
    : 'Unknown depth';
}

/**
 * Human label for a known snapshot field.
 * @param {string} field
 * @returns {string}
 */
export function fieldLabel(field: string): string {
  return field in FIELD_LABELS ? FIELD_LABELS[field as keyof typeof FIELD_LABELS] : field;
}

/**
 * Formats a single snapshot field value for display. Never returns raw `null`,
 * `undefined`, or `[object Object]`.
 * @param {string} field
 * @param {unknown} value
 * @returns {string}
 */
export function formatSnapshotValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return 'Not observed';
  if (typeof value === 'boolean') return value ? 'Detected' : 'Not detected';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (field === 'httpSecurityHeaders') return value.map(httpSecurityHeaderLabel).join(', ');
    // Factor arrays: each element is { label, points }.
    if (field === 'riskFactors' || field === 'opportunityFactors') {
      return value.map((factor) => {
        if (!factor || typeof factor !== 'object') return String(factor);
        const item = factor as Record<string, unknown>;
        const label = String(item.label ?? '');
        const points = typeof item.points === 'number' ? item.points : 0;
        return `${label} (${points > 0 ? '+' : ''}${points})`;
      }).join(', ');
    }
    return value.join(', ');
  }
  if (typeof value === 'number') return field === 'riskModelVersion' ? `v${value}` : String(value);
  return String(value);
}

/**
 * Groups a snapshot's fields into display sections, keeping only fields that
 * have a present (non-null, non-empty) value. Returns an array of groups; each
 * group has `name` and `rows` (array of `{ field, label, value }`). Empty
 * groups are excluded.
 * @param {import('./case-model.ts').CaseEvidenceSnapshot} snapshot
 * @returns {Array<{ name: string, rows: Array<{ field: string, label: string, value: unknown }> }>}
 */
export function snapshotFieldGroups(snapshot: CaseEvidenceSnapshot): SnapshotGroup[] {
  const groups: SnapshotGroup[] = [];
  for (const group of FIELD_GROUPS) {
    const rows: SnapshotGroup['rows'] = [];
    for (const field of group.fields) {
      const value = snapshot[field];
      if (isPresentValue(value)) {
        rows.push({ field, label: fieldLabel(field), value });
      }
    }
    if (rows.length) groups.push({ name: group.name, rows });
  }
  return groups;
}

function isPresentValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true; // finite numbers and booleans (incl. `false`) are present
}

// ---------------------------------------------------------------------------
// Change formatting
// ---------------------------------------------------------------------------

/**
 * Formats a single change from `compareCaseEvidence` into a display-ready
 * object with human-readable before/after text and a change kind.
 * @param {{ field: string, label: string, before: unknown, after: unknown, tone: string }} change
 * @returns {{ field: string, label: string, beforeText: string, afterText: string, tone: string, kind: string }}
 */
export function formatChangeEntry(change: EvidenceChange) {
  const beforeText = formatChangeValue(change.field, change.before);
  const afterText = formatChangeValue(change.field, change.after);
  const kind = classifyChangeKind(change.field, change.before, change.after);
  return { field: change.field, label: change.label, beforeText, afterText, tone: change.tone, kind };
}

function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return 'Not observed';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (field === 'httpSecurityHeaders') return value.map(httpSecurityHeaderLabel).join(', ');
    if (field === 'riskFactors' || field === 'opportunityFactors') {
      return value.map((f) => {
        if (typeof f === 'object' && f !== null && 'label' in f && 'points' in f) {
          const label = String(f.label);
          const points = typeof f.points === 'number' ? f.points : 0;
          return `${label} (${points > 0 ? '+' : ''}${points})`;
        }
        return String(f);
      }).join(', ');
    }
    return value.join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Detected' : 'Not detected';
  if (typeof value === 'number') return String(value);
  return String(value);
}

function classifyChangeKind(field: string, before: unknown, after: unknown): string {
  const bPresent = before !== null && before !== undefined && (!Array.isArray(before) || before.length > 0);
  const aPresent = after !== null && after !== undefined && (!Array.isArray(after) || after.length > 0);
  if (!bPresent && aPresent) return 'added';
  if (bPresent && !aPresent) return 'removed';
  if (field === 'riskFactors' || field === 'opportunityFactors') return 'factor-change';
  if (field === 'nameservers' || field === 'mutationTypes') return 'set-change';
  return 'changed';
}

// ---------------------------------------------------------------------------
// Timeline derivation
// ---------------------------------------------------------------------------

/**
 * Derives a display-ready timeline from a case's evidence history. Returns
 * entries in newest-first display order. Does not mutate the input array.
 *
 * - The first chronological snapshot is marked `isBaseline` and has no changes.
 * - Every subsequent snapshot is compared against its immediate chronological
 *   predecessor via `compareCaseEvidence`.
 * - When two snapshots are materially distinct but `compareCaseEvidence`
 *   has fields suppressed by the depth or score-model gates,
 *   `hasIncomparableChange` and `incomparableReasons` explain why.
 * - `hasRepeatedObservation` is true when `firstCapturedAt !== capturedAt`.
 *
 * @param {import('./case-model.ts').CaseEvidenceSnapshot[]} evidenceHistory
 * @returns {TimelineEntry[]}
 */
export function deriveTimeline(evidenceHistory: CaseEvidenceSnapshot[] | null | undefined): TimelineEntry[] {
  if (!Array.isArray(evidenceHistory) || evidenceHistory.length === 0) return [];

  // Work on a copy; chronological order is the stored order.
  const chronological = [...evidenceHistory];

  const entries: TimelineEntry[] = [];

  for (let i = 0; i < chronological.length; i++) {
    const snapshot = chronological[i];
    const isBaseline = i === 0;
    const hasRepeatedObservation = snapshot.firstCapturedAt !== snapshot.capturedAt;

    let changes: TimelineEntry['changes'] = null;
    let hasIncomparableChange = false;
    let incomparableReasons: TimelineEntry['incomparableReasons'] = [];

    if (!isBaseline) {
      const previous = chronological[i - 1];
      const rawChanges = compareCaseEvidence(previous, snapshot);
      incomparableReasons = caseEvidenceIncomparableReasons(previous, snapshot);
      if (rawChanges.length > 0) {
        changes = rawChanges;
      } else if (snapshot.fingerprint !== previous.fingerprint && incomparableReasons.length === 0) {
        incomparableReasons = ['other'];
      }
      hasIncomparableChange = incomparableReasons.length > 0;
    }

    entries.push({
      snapshot,
      isBaseline,
      hasRepeatedObservation,
      changes,
      hasIncomparableChange,
      incomparableReasons,
      displayIndex: 0, // assigned after reversal
    });
  }

  // Reverse for newest-first display, then assign display indices.
  entries.reverse();
  for (let i = 0; i < entries.length; i++) {
    entries[i].displayIndex = i + 1;
  }

  return entries;
}

/**
 * Filters timeline entries for the "changed only" view. Always retains the
 * baseline (first chronological) snapshot. Retains entries with reliable
 * non-empty changes. Deliberately excludes depth-incomparable entries
 * (`hasIncomparableChange` but no `changes`) because their field-level
 * differences cannot be reliably compared across scan depths.
 * @param {TimelineEntry[]} entries
 * @returns {TimelineEntry[]}
 */
export function filterChangedOnly(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.filter((e) => e.isBaseline || (e.changes && e.changes.length > 0));
}

/**
 * Human label for an evidence snapshot's capture source. Distinct from the
 * case-level source label (which uses sourceLabel from case-model).
 * @param {string} source
 * @returns {string}
 */
export function evidenceSourceLabel(source: unknown): string {
  const labels = { lookup: 'Lookup', bulk: 'Bulk', monitor: 'Monitor', import: 'Import', unknown: 'Unknown' };
  return typeof source === 'string' && source in labels
    ? labels[source as keyof typeof labels]
    : String(source || '');
}

/**
 * The most recent snapshot's concise summary fields, or null when there is no
 * evidence. Used for the compact current-evidence summary near the top of an
 * expanded case.
 * @param {import('./case-model.ts').CaseEvidenceSnapshot[] | null | undefined} evidenceHistory
 * @returns {{ availability: string | null, riskModelVersion: number | null, riskScore: number | null, registrar: string | null, activityStatus: string | null, capturedAt: string | null } | null}
 */
export function currentEvidenceSummary(evidenceHistory: CaseEvidenceSnapshot[] | null | undefined) {
  const latest = latestCaseEvidence({ evidenceHistory: evidenceHistory ?? undefined });
  if (!latest) return null;
  return {
    availability: latest.availability,
    riskModelVersion: latest.riskModelVersion,
    riskScore: latest.riskScore,
    registrar: latest.registrar,
    activityStatus: latest.activityStatus,
    capturedAt: latest.capturedAt,
  };
}
