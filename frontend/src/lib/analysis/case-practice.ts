import { createCase, updateCase } from '../../../../packages/cases/case-record-operations.mts';
import type { CasePatch, CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
import { emptyCaseDraftStore, normalizeCaseDraftStore, removeCaseDraft } from '../../../../packages/cases/case-drafts.mts';
import type { CaseDraftReceipt } from '../../../../packages/contracts/case-drafts.mts';
import type { DraftStorage } from '../controllers/case-draft-recovery.ts';
import { appendCaseAction, appendCaseActionTransition } from '../../../../packages/cases/case-response-actions.mts';

export const CASE_PRACTICE_OBSERVED_AT = '2026-09-01T12:00:00.000Z';
export const CASE_PRACTICE_LATER_AT = '2026-09-02T12:00:00.000Z';

export const CASE_PRACTICE_SCENARIOS = [
  { id: 'credential-form', title: 'An ordinary-looking sign-in page',
    observation: 'The supplied fictional page asks for an email address and password. Its claimed identity and intent have not been verified.',
    assessment: 'A credential form can justify further review; it does not establish who operates the page or whether it is malicious.',
    recheck: 'The later capture timed out. Record what the later evidence actually establishes, not the outcome you expected.' },
  { id: 'contradictory-sources', title: 'Two sources disagree',
    observation: 'A complete fictional capture shows a credential form. A separate supplied review says no form was seen; its path and viewport were not recorded.',
    assessment: 'Link both sources to the conclusion. Their scope differs, so do not silently pick a winner or count them as independent corroboration.',
    recheck: 'The next capture timed out. It cannot resolve the earlier disagreement.' },
  { id: 'provider-resolved', title: 'A provider says the report is resolved',
    observation: 'A fictional provider acknowledged the earlier complaint and reported resolution. The only later capture timed out.',
    assessment: 'Keep the provider statement separate from the independent technical observation. A provider outcome is not evidence that the page was removed.',
    recheck: 'Review whether the original page condition was independently observed again. An incomplete capture cannot establish removal.' },
] as const;
export type CasePracticeScenario = typeof CASE_PRACTICE_SCENARIOS[number]['id'];

export function casePracticeFeedback(record: CaseRecord, initialPinIds: readonly string[], scenario: CasePracticeScenario) {
  const decision = record.decisions.at(-1);
  return [
    { label: 'A new fact has a source and observation time', complete: record.evidencePins.some(pin => !initialPinIds.includes(pin.id) && pin.observedAt !== null && pin.source.trim().length > 0) },
    { label: scenario === 'contradictory-sources' ? 'The decision links both supplied source accounts' : 'The decision links retained evidence',
      complete: !!decision && (scenario === 'contradictory-sources'
        ? [initialPinIds[0], initialPinIds[2]].every(id => id && decision.evidencePinIds.includes(id))
        : decision.evidencePinIds.some(id => record.evidencePins.some(pin => pin.id === id))) },
    { label: 'The incomplete later capture is recorded as unavailable', complete: record.observedEffects.reviews.some(review => review.evidencePinId === initialPinIds[1] && review.state === 'unavailable' && review.recheck != null) },
  ];
}

/** Fixed fictional material, never loaded from a saved workspace or target. */
export function createCasePracticeRecord(scenario: CasePracticeScenario = 'credential-form'): CaseRecord {
  const definition = CASE_PRACTICE_SCENARIOS.find(item => item.id === scenario);
  if (!definition) throw new TypeError('Unknown practice scenario.');
  const initial = createCase({ domain: 'case-practice.example', title: definition.title,
    note: 'Practice material only. No domain was contacted and no external report was submitted.' }, CASE_PRACTICE_OBSERVED_AT);
  const observed = updateCase([initial], initial.id, { evidencePins: [
    { label: 'Earlier page', value: 'The fictional page asks for an email address and password. Its relationship to the claimed organisation has not been established.',
      source: 'Fictional supplied capture', observedAt: CASE_PRACTICE_OBSERVED_AT, observationHostname: initial.domain,
      completeness: 'complete', sourceState: 'complete', limitations: ['One supplied page observation; no ownership or intent finding.'] },
    { label: 'Later capture did not complete', value: 'The fictional later capture timed out before page content could be reviewed.',
      source: 'Fictional later capture', observedAt: CASE_PRACTICE_LATER_AT, observationHostname: initial.domain,
      completeness: 'partial', sourceState: 'unavailable', limitations: ['No later page content is available. This cannot establish absence.'] },
  ] }, CASE_PRACTICE_LATER_AT);
  let result = updateCase(observed.cases, initial.id, { assertion: { kind: 'next_step',
    statement: 'Is the credential form still present?', state: 'open',
    recheck: { targetHostname: initial.domain, baselinePinId: observed.record.evidencePins[0]!.id,
      conditions: 'Same unauthenticated page and viewport; require a complete later capture.' },
  } }, CASE_PRACTICE_LATER_AT).record;
  if (scenario === 'contradictory-sources') result = updateCase([result], result.id, { evidencePin: {
    label: 'Separate review reported no credential form', value: 'The supplied review says no credential form was seen; its path and viewport are not recorded.',
    source: 'Fictional external review', observedAt: CASE_PRACTICE_OBSERVED_AT, completeness: 'partial',
    limitations: ['Observation scope differs or is unknown. This is not evidence that the complete capture is wrong.'],
  } }, CASE_PRACTICE_LATER_AT).record;
  if (scenario === 'provider-resolved') {
    let actions = appendCaseAction([], { type: 'platform_report', recipient: 'Fictional provider review desk' }, CASE_PRACTICE_OBSERVED_AT);
    const actionId = actions[0]!.id;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, actionId, { nextState, sourceClass: 'analyst', provenance: 'fictional_practice' },
        new Date(Date.parse(CASE_PRACTICE_OBSERVED_AT) + (index + 1) * 60_000).toISOString());
    }
    actions = appendCaseActionTransition(actions, actionId, { nextState: 'acknowledged', sourceClass: 'provider', provenance: 'fictional_provider_statement',
      providerOutcome: 'provider_reports_resolved', outcomeDetail: 'The fictional provider reported resolution; independent effects were not checked.' }, CASE_PRACTICE_LATER_AT);
    result = { ...result, actions };
  }
  return result;
}

/** One document owns the practice Case and its drafts as a single commit unit. */
export function createCasePracticeSession(scenario: CasePracticeScenario = 'credential-form') {
  let record: CaseRecord | null = createCasePracticeRecord(scenario);
  let drafts = emptyCaseDraftStore();
  const current = () => { if (!record) throw new Error('This practice session has closed.'); return record; };
  const storage: DraftStorage = {
    read: async () => { current(); return structuredClone(drafts); },
    update: async change => {
      const id = current().id;
      const next = normalizeCaseDraftStore(change(structuredClone(drafts)));
      if (next.records.some(draft => draft.caseId !== id)) throw new Error('Practice drafts belong only to the fictional Case.');
      drafts = next;
    },
  };
  return Object.freeze({
    storage,
    read: () => structuredClone(current()),
    edit(patch: CasePatch, receipt?: CaseDraftReceipt): CaseRecord {
      const before = current();
      const next = updateCase([before], before.id, patch, new Date().toISOString()).record;
      const nextDrafts = receipt ? removeCaseDraft(drafts, receipt, before.id) : drafts;
      record = next; drafts = nextDrafts;
      return structuredClone(next);
    },
    close() { record = null; drafts = emptyCaseDraftStore(); },
  });
}
