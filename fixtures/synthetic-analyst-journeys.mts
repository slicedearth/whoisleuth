// Versioned, privacy-safe task coverage for deterministic analyst journeys.
// These definitions describe user goals and observable milestones without
// retaining fixture targets, queries, page contents, traces, or identities.

export const SYNTHETIC_ANALYST_JOURNEY_SCHEMA = 'whoisleuth.synthetic-analyst-journeys';
export const SYNTHETIC_ANALYST_JOURNEY_VERSION = 1;

export type SyntheticAnalystDevice = 'desktop' | 'mobile';
export type SyntheticEvidenceState = 'fresh' | 'complete' | 'mixed' | 'partial' | 'restored';
export type SyntheticAnalystPersonaId =
  | 'first_time_analyst'
  | 'brand_reviewer'
  | 'incident_responder'
  | 'acquisition_reviewer';

export type SyntheticAnalystPersona = Readonly<{
  id: SyntheticAnalystPersonaId;
  startingContext: string;
  decisionBoundary: string;
}>;

export const SYNTHETIC_ANALYST_TASK_IDS = Object.freeze([
  'orient-console',
  'deep-lookup-first-pivot',
  'compare-registration-sources',
  'bulk-review-queue',
  'guided-new-domain-triage',
  'guided-infrastructure-pivot',
  'guided-brand-sweep',
  'case-decision-packet',
  'case-monitor-recheck',
  'archive-export-verify',
] as const);

export type SyntheticAnalystTaskId = (typeof SYNTHETIC_ANALYST_TASK_IDS)[number];

export type SyntheticAnalystJourney = Readonly<{
  id: string;
  personaId: SyntheticAnalystPersonaId;
  taskIds: readonly SyntheticAnalystTaskId[];
  devices: readonly SyntheticAnalystDevice[];
  evidenceStates: readonly SyntheticEvidenceState[];
  requiredMilestones: readonly string[];
  maxActions: number;
  maxBacktracks: number;
}>;

export const SYNTHETIC_ANALYST_PERSONAS: readonly SyntheticAnalystPersona[] = Object.freeze([
  Object.freeze({
    id: 'first_time_analyst',
    startingContext: 'Knows the investigation goal but has not used WHOISleuth before.',
    decisionBoundary: 'Must distinguish observed, partial, unavailable, and analyst-derived evidence.',
  }),
  Object.freeze({
    id: 'brand_reviewer',
    startingContext: 'Has an owned domain and a bounded candidate set to review.',
    decisionBoundary: 'Must prioritise review without treating similarity or shared infrastructure as attribution.',
  }),
  Object.freeze({
    id: 'incident_responder',
    startingContext: 'Has retained evidence that needs a reviewed decision and response handoff.',
    decisionBoundary: 'Must keep observations, assertions, decisions, and external actions separate.',
  }),
  Object.freeze({
    id: 'acquisition_reviewer',
    startingContext: 'Needs to assess registration and apparent-use uncertainty before a manual decision.',
    decisionBoundary: 'Must not interpret incomplete collection as availability or acquisition eligibility.',
  }),
]);

const BOTH_DEVICES = Object.freeze(['desktop', 'mobile'] as const);
const tasks = (...taskIds: SyntheticAnalystTaskId[]): readonly SyntheticAnalystTaskId[] => (
  Object.freeze(taskIds)
);

export const SYNTHETIC_ANALYST_JOURNEYS: readonly SyntheticAnalystJourney[] = Object.freeze([
  Object.freeze({
    id: 'first-domain-assessment',
    personaId: 'first_time_analyst',
    taskIds: tasks(
      'orient-console',
      'deep-lookup-first-pivot',
      'compare-registration-sources',
    ),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['fresh', 'partial'] as const),
    requiredMilestones: Object.freeze([
      'task-entry-found',
      'deep-collection-completed',
      'source-state-reviewed',
      'next-pivot-identified',
    ]),
    maxActions: 18,
    maxBacktracks: 2,
  }),
  Object.freeze({
    id: 'bulk-peer-triage',
    personaId: 'brand_reviewer',
    taskIds: tasks('bulk-review-queue'),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['mixed'] as const),
    requiredMilestones: Object.freeze([
      'candidate-entry-found',
      'bounded-scan-completed',
      'review-filter-applied',
      'priority-candidate-retained',
    ]),
    maxActions: 20,
    maxBacktracks: 2,
  }),
  Object.freeze({
    id: 'guided-new-domain-triage',
    personaId: 'first_time_analyst',
    taskIds: tasks('guided-new-domain-triage'),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['partial'] as const),
    requiredMilestones: Object.freeze([
      'guide-started',
      'request-boundary-reviewed',
      'comparison-reviewed',
      'terminal-state-reached',
    ]),
    maxActions: 32,
    maxBacktracks: 4,
  }),
  Object.freeze({
    id: 'guided-infrastructure-pivot',
    personaId: 'first_time_analyst',
    taskIds: tasks('guided-infrastructure-pivot'),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['mixed'] as const),
    requiredMilestones: Object.freeze([
      'guide-started',
      'request-boundary-reviewed',
      'peer-set-reviewed',
      'attribution-limit-retained',
    ]),
    maxActions: 34,
    maxBacktracks: 4,
  }),
  Object.freeze({
    id: 'guided-brand-sweep',
    personaId: 'brand_reviewer',
    taskIds: tasks('guided-brand-sweep'),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['mixed'] as const),
    requiredMilestones: Object.freeze([
      'guide-started',
      'candidate-selected',
      'selection-carried-forward',
      'terminal-state-reached',
    ]),
    maxActions: 38,
    maxBacktracks: 5,
  }),
  Object.freeze({
    id: 'reviewed-response-decision',
    personaId: 'incident_responder',
    taskIds: tasks('case-decision-packet'),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['restored'] as const),
    requiredMilestones: Object.freeze([
      'saved-case-found',
      'observed-fact-pinned',
      'analyst-decision-recorded',
      'reviewed-packet-created',
    ]),
    maxActions: 28,
    maxBacktracks: 3,
  }),
  Object.freeze({
    id: 'workspace-portability-review',
    personaId: 'incident_responder',
    taskIds: tasks('archive-export-verify'),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['restored'] as const),
    requiredMilestones: Object.freeze([
      'workspace-tools-found',
      'archive-exported',
      'integrity-boundary-identified',
      'offline-verification-identified',
    ]),
    maxActions: 16,
    maxBacktracks: 2,
  }),
  Object.freeze({
    id: 'response-monitoring-recheck',
    personaId: 'incident_responder',
    taskIds: tasks('case-monitor-recheck'),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['partial', 'fresh'] as const),
    requiredMilestones: Object.freeze([
      'partial-evidence-reviewed',
      'analyst-classification-recorded',
      'exact-hostname-baseline-retained',
      'deliberate-recheck-completed',
      'material-change-reviewed',
    ]),
    maxActions: 24,
    maxBacktracks: 2,
  }),
  Object.freeze({
    id: 'acquisition-uncertainty-review',
    personaId: 'acquisition_reviewer',
    taskIds: tasks('deep-lookup-first-pivot', 'compare-registration-sources'),
    devices: BOTH_DEVICES,
    evidenceStates: Object.freeze(['partial'] as const),
    requiredMilestones: Object.freeze([
      'acquisition-entry-found',
      'deep-collection-completed',
      'registration-uncertainty-reviewed',
      'manual-next-step-identified',
    ]),
    maxActions: 18,
    maxBacktracks: 2,
  }),
]);

export default Object.freeze({
  schema: SYNTHETIC_ANALYST_JOURNEY_SCHEMA,
  version: SYNTHETIC_ANALYST_JOURNEY_VERSION,
  personas: SYNTHETIC_ANALYST_PERSONAS,
  journeys: SYNTHETIC_ANALYST_JOURNEYS,
});
