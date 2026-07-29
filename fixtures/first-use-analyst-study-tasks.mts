// Privacy-safe task definitions for moderated first-use studies. These tasks
// describe analyst outcomes without prescribing a particular target or
// collecting participant identity, queries, recordings, or free-form notes.

export const FIRST_USE_STUDY_TASK_SCHEMA = 'whoisleuth.first-use-study-tasks';
export const FIRST_USE_STUDY_TASK_VERSION = 1;

export type FirstUseStudyTask = Readonly<{
  id: string;
  area: 'orientation' | 'lookup' | 'bulk' | 'guided_investigation' | 'case_workflow' | 'portability';
  title: string;
  objective: string;
  completionEvidence: string;
  allowedDevices: readonly ('desktop' | 'mobile')[];
}>;

export const FIRST_USE_ANALYST_STUDY_TASKS: readonly FirstUseStudyTask[] = Object.freeze([
  Object.freeze({
    id: 'orient-console',
    area: 'orientation',
    title: 'Find the appropriate starting workflow',
    objective: 'From the Console, identify where to investigate one supplied in-scope domain and explain the difference between Fast and Deep collection.',
    completionEvidence: 'The participant opens Lookup and can describe when Deep collection is appropriate.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'deep-lookup-first-pivot',
    area: 'lookup',
    title: 'Find the first useful pivot',
    objective: 'Run one supplied in-scope Deep lookup, identify a useful observed fact, and open one analyst-controlled pivot without treating it as attribution.',
    completionEvidence: 'The participant identifies the source, observation state, limitation, and next manual pivot.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'compare-registration-sources',
    area: 'lookup',
    title: 'Interpret source agreement',
    objective: 'Review RDAP and WHOIS registration evidence and explain one agreement, conflict, or incomplete source state.',
    completionEvidence: 'The participant distinguishes unavailable evidence from a negative finding.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'bulk-review-queue',
    area: 'bulk',
    title: 'Triage a bounded domain set',
    objective: 'Run a supplied bounded Bulk set, apply a useful filter and sort, then identify which result should be reviewed first and why.',
    completionEvidence: 'The participant can recover the filtered review state and explain the selected result using visible factors.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'guided-new-domain-triage',
    area: 'guided_investigation',
    title: 'Complete new-domain triage',
    objective: 'Start the New domain triage recipe, complete every applicable stage, and mark optional or incomplete work explicitly.',
    completionEvidence: 'The recipe reaches a terminal reviewed state with partial and skipped stages preserved.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'guided-infrastructure-pivot',
    area: 'guided_investigation',
    title: 'Complete an infrastructure pivot',
    objective: 'Start the Infrastructure pivot recipe, compare a focused peer set, and retain the limitations of shared infrastructure.',
    completionEvidence: 'The participant reaches the case-review stage without claiming shared control or ownership.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'guided-brand-sweep',
    area: 'guided_investigation',
    title: 'Complete a brand sweep',
    objective: 'Start the Brand sweep recipe, choose a generated candidate deliberately, and carry that selection through Lookup and case review.',
    completionEvidence: 'The selected candidate remains visible across stages and the participant completes or explicitly qualifies each stage.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'case-decision-packet',
    area: 'case_workflow',
    title: 'Build a reviewable case decision',
    objective: 'Pin one observed fact, add a separate analyst assertion, record a next action, and prepare a decision packet.',
    completionEvidence: 'Observed evidence, analyst reasoning, unknowns, and the action remain separately labelled.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'archive-export-verify',
    area: 'portability',
    title: 'Export and verify a workspace archive',
    objective: 'Create a workspace archive and identify how its version and checksums can be verified without exposing stored contents.',
    completionEvidence: 'The participant identifies the archive as a portability boundary and completes an offline verification.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
]);

export default Object.freeze({
  schema: FIRST_USE_STUDY_TASK_SCHEMA,
  version: FIRST_USE_STUDY_TASK_VERSION,
  tasks: FIRST_USE_ANALYST_STUDY_TASKS,
});
