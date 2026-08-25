import type { EvidenceCoverageState } from './evidence-coverage-ledger.mts';

export type LookupTaskView = 'general' | 'acquisition' | 'brand' | 'incident' | 'owned';
export type LookupDecisionState = 'conflict' | 'uncertain';
export type LookupDecisionImportance = 'high' | 'medium' | 'low';

export type LookupTaskGuidance = Readonly<{
  task: LookupTaskView;
  label: string;
  summary: string;
  questions: readonly string[];
  prioritySections: readonly string[];
}>;

export type LookupDecisionEntry = Readonly<{
  id: string;
  state: LookupDecisionState;
  importance: LookupDecisionImportance;
  title: string;
  detail: string;
  sources: readonly string[];
  href: `#${string}`;
}>;

export type LookupNextAction = Readonly<{
  id: string;
  label: string;
  reason: string;
  expectedOutcome: string;
  href: `#${string}`;
  priority: LookupDecisionImportance;
}>;

export type LookupDecisionSupport = Readonly<{
  version: 1;
  guidance: LookupTaskGuidance;
  entries: readonly LookupDecisionEntry[];
  actions: readonly LookupNextAction[];
  counts: Readonly<{ conflicts: number; uncertainties: number }>;
}>;

export type LookupFreshnessPolicy = Readonly<{
  version: 1;
  id: 'task-default' | 'analyst-custom';
  task: LookupTaskView;
  thresholdsDays: Readonly<{ registration: number; network: number; web: number }>;
}>;

export type LookupEvidenceQualityEntry = Readonly<{
  id: string;
  label: string;
  category: string;
  endpointClass: string;
  description: string;
  state: EvidenceCoverageState;
  statusLabel: string;
  truncated: boolean;
  observedAt: string | null;
  ageDays: number | null;
  durationMs: number | null;
  timingOutcome: 'fulfilled' | 'rejected' | null;
  refreshAvailable: boolean;
  requestDisclosure: string | null;
  limitations: readonly string[];
  supports: readonly string[];
}>;

export type LookupEvidenceQualityMatrix = Readonly<{
  version: 1;
  observedAt: string | null;
  totalMs: number | null;
  entries: readonly LookupEvidenceQualityEntry[];
  completeCount: number;
  limitedCount: number;
  stale: boolean;
  ageDays: number | null;
  freshnessPolicy: LookupFreshnessPolicy;
}>;
