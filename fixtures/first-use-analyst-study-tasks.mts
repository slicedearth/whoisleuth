// Privacy-safe task definitions for moderated first-use studies. These tasks
// describe analyst outcomes without prescribing a particular target or
// collecting participant identity, queries, recordings, or free-form notes.

export const FIRST_USE_STUDY_TASK_SCHEMA = 'whoisleuth.first-use-study-tasks';
export const FIRST_USE_STUDY_TASK_VERSION = 2;

export type FirstUseStudyTask = Readonly<{
  id: string;
  area: 'orientation' | 'lookup' | 'bulk' | 'guided_investigation' | 'case_workflow' | 'portability' | 'cli';
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
    objective: 'Pin one observed fact, write an assessment while reviewing its evidence, record a next action, and preview a recipient-specific printable packet.',
    completionEvidence: 'Evidence and assessment stay distinct, a section change preserves the draft, and the participant checks what the recipient will receive.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'archive-export-verify',
    area: 'portability',
    title: 'Export and verify a workspace archive',
    objective: 'Download workspace metadata and its referenced file packages, then explain which contents each contains and verify the selected files offline.',
    completionEvidence: 'The participant distinguishes a download from verified recovery and recognises that separate evidence packages are not encrypted by workspace JSON encryption.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'resume-saved-case-review',
    area: 'case_workflow',
    title: 'Return to a saved review question',
    objective: 'Save a useful Case filter, open a matching Case, review its evidence, and return to the same filtered list.',
    completionEvidence: 'The filter and return focus are retained; the participant understands that a saved view is a query, not a frozen result set or a collection permission.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'compare-original-and-derived-image',
    area: 'case_workflow',
    title: 'Review an image without losing its original',
    objective: 'Compare two supplied images, identify a capture-condition difference, create a redacted derivative and choose which exact files to export.',
    completionEvidence: 'The original remains retrievable, the derivative is separately labelled, and the participant does not mistake an image difference for proof of maliciousness.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'rehearse-workspace-recovery',
    area: 'portability',
    title: 'Prove a backup can be restored',
    objective: 'Restore supplied metadata into a separate rehearsal workspace, resolve a missing original file, verify the result, and deliberately keep or delete the rehearsal.',
    completionEvidence: 'The active workspace remains unchanged; the participant distinguishes missing files, a committed write and successful verification, and can find a retained rehearsal.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'interpret-recheck-question',
    area: 'case_workflow',
    title: 'Decide what a recheck establishes',
    objective: 'Review a supplied recheck question with a comparable observation and a later failed collection, then decide which result supports an outcome.',
    completionEvidence: 'The participant explains comparison conditions and does not treat a failed collection as removal or success.',
    allowedDevices: Object.freeze(['desktop', 'mobile'] as const),
  }),
  Object.freeze({
    id: 'cli-recipe-resume',
    area: 'cli',
    title: 'Resume a fixed workflow from retained output',
    objective: 'Inspect a fixed recipe, connect supplied retained outputs to a later step, resume from its checkpoint, and verify the resulting local package.',
    completionEvidence: 'The participant identifies unresolved selections and network approval boundaries, and does not repeat a completed collection merely to continue offline work.',
    allowedDevices: Object.freeze(['desktop'] as const),
  }),
]);

export default Object.freeze({
  schema: FIRST_USE_STUDY_TASK_SCHEMA,
  version: FIRST_USE_STUDY_TASK_VERSION,
  tasks: FIRST_USE_ANALYST_STUDY_TASKS,
});
