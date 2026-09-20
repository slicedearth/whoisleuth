import { createCase, updateCase } from '../../../../packages/cases/case-record-operations.mts';
import type { CasePatch, CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
import { emptyCaseDraftStore, normalizeCaseDraftStore, removeCaseDraft } from '../../../../packages/cases/case-drafts.mts';
import type { CaseDraftReceipt } from '../../../../packages/contracts/case-drafts.mts';
import type { DraftStorage } from '../controllers/case-draft-recovery.ts';

export const CASE_PRACTICE_OBSERVED_AT = '2026-09-01T12:00:00.000Z';
export const CASE_PRACTICE_LATER_AT = '2026-09-02T12:00:00.000Z';

/** Fixed fictional material, never loaded from a saved workspace or target. */
export function createCasePracticeRecord(): CaseRecord {
  const initial = createCase({ domain: 'case-practice.example', title: 'Fictional credential-form review',
    note: 'Practice material only. No domain was contacted and no external report was submitted.' }, CASE_PRACTICE_OBSERVED_AT);
  const observed = updateCase([initial], initial.id, { evidencePins: [
    { label: 'Earlier page', value: 'The fictional page asks for an email address and password. Its relationship to the claimed organisation has not been established.',
      source: 'Fictional supplied capture', observedAt: CASE_PRACTICE_OBSERVED_AT, observationHostname: initial.domain,
      completeness: 'complete', sourceState: 'complete', limitations: ['One supplied page observation; no ownership or intent finding.'] },
    { label: 'Later capture did not complete', value: 'The fictional later capture timed out before page content could be reviewed.',
      source: 'Fictional later capture', observedAt: CASE_PRACTICE_LATER_AT, observationHostname: initial.domain,
      completeness: 'partial', sourceState: 'unavailable', limitations: ['No later page content is available. This cannot establish absence.'] },
  ] }, CASE_PRACTICE_LATER_AT);
  return updateCase(observed.cases, initial.id, { assertion: { kind: 'next_step',
    statement: 'Is the credential form still present?', state: 'open',
    recheck: { targetHostname: initial.domain, baselinePinId: observed.record.evidencePins[0]!.id,
      conditions: 'Same unauthenticated page and viewport; require a complete later capture.' },
  } }, CASE_PRACTICE_LATER_AT).record;
}

/** One document owns the practice Case and its drafts as a single commit unit. */
export function createCasePracticeSession() {
  let record: CaseRecord | null = createCasePracticeRecord();
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
