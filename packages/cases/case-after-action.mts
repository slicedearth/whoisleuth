import { MAX_NOTE_LENGTH } from '../contracts/case-portability.mts';

export const CASE_AFTER_ACTION_FIELDS = [
  { id: 'delay', label: 'What delayed the investigation?' },
  { id: 'usefulEvidence', label: 'Which evidence was useful?' },
  { id: 'misleadingEvidence', label: 'Which evidence was misleading or inconclusive?' },
  { id: 'returnedComplaint', label: 'Why was a complaint returned?' },
  { id: 'nextTime', label: 'What should change next time?' },
] as const;
export type CaseAfterActionDraft = Record<typeof CASE_AFTER_ACTION_FIELDS[number]['id'], string>;

/** A readable note, not a second stored record or a provider-performance verdict. */
export function buildCaseAfterActionNote(draft: CaseAfterActionDraft): string {
  const sections = CASE_AFTER_ACTION_FIELDS.flatMap(({ id, label }) => {
    const value = draft[id];
    if (typeof value !== 'string') throw new TypeError('After-action answers must be text.');
    const body = value.trim();
    return body ? [`${label}\n${body}`] : [];
  });
  if (!sections.length) throw new TypeError('Record at least one lesson before saving the review.');
  const note = ['After-action review', ...sections].join('\n\n');
  if (note.length > MAX_NOTE_LENGTH) throw new TypeError(`The review exceeds the ${MAX_NOTE_LENGTH}-character Case note limit. Shorten it or record separate notes; no answer has been discarded.`);
  return note;
}
