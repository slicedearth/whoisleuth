import type { CaseReportPreview } from './case-report-preview.mts';
import type { CaseResponsePacket } from './case-response-packet-types.mts';

type InternalReport = CaseReportPreview['report']['json'];
export type PreparedDisclosureSide = Readonly<{ present: boolean; ambiguous: boolean; value: unknown }>;
export type PreparedDisclosureRow = Readonly<{
  group: string; reference: string; internal: PreparedDisclosureSide; recipient: PreparedDisclosureSide;
  state: 'same_representation' | 'different_representation' | 'internal_only' | 'recipient_only' | 'not_represented' | 'ambiguous';
}>;
const absent: PreparedDisclosureSide = Object.freeze({ present: false, ambiguous: false, value: null });
function field(value: object, key: string): PreparedDisclosureSide {
  return Object.hasOwn(value, key) ? { present: true, ambiguous: false, value: Reflect.get(value, key) } : absent;
}
function row(group: string, reference: string, internal: PreparedDisclosureSide, recipient: PreparedDisclosureSide): PreparedDisclosureRow {
  return { group, reference, internal, recipient, state: internal.ambiguous || recipient.ambiguous ? 'ambiguous'
    : internal.present && recipient.present ? JSON.stringify(internal.value) === JSON.stringify(recipient.value) ? 'same_representation' : 'different_representation'
    : internal.present ? 'internal_only' : recipient.present ? 'recipient_only' : 'not_represented' };
}
function fields(group: string, internal: object, recipient: object): PreparedDisclosureRow[] {
  return [...new Set([...Object.keys(internal), ...Object.keys(recipient)])].map(key => row(group, key, field(internal, key), field(recipient, key)));
}
function references(group: string, internal: readonly object[], recipient: readonly object[], recipientKey = 'id'): PreparedDisclosureRow[] {
  const ids = [...new Set([...internal.map(value => String(Reflect.get(value, 'id'))), ...recipient.map(value => String(Reflect.get(value, recipientKey)))])];
  const side = (values: readonly object[], key: string, id: string): PreparedDisclosureSide => {
    const matches = values.filter(value => Reflect.get(value, key) === id);
    return matches.length ? { present: true, ambiguous: matches.length > 1, value: matches.length === 1 ? matches[0] : matches } : absent;
  };
  return ids.map(id => row(group, id, side(internal, 'id', id), side(recipient, recipientKey, id)));
}

/** Read actual prepared representations only; never recover omitted fields from a live Case. */
export function preparedDisclosureRows(internal: InternalReport, recipient: CaseResponsePacket): readonly PreparedDisclosureRow[] {
  if (internal.case.id !== recipient.case.id || internal.case.domain !== recipient.case.domain || internal.generatedAt !== recipient.generatedAt)
    throw new TypeError('Prepare both representations for the same Case and preparation time before comparing disclosures.');
  const response = internal.analystResponse;
  const rows = [
    ...fields('Case field', internal.case, recipient.case),
    ...references('Evidence reference', response.evidencePins, recipient.selectedEvidence),
    ...references('Assertion reference', response.assertions, recipient.contradictions),
    ...references('Decision reference', response.decisions, []),
    ...references('Response action reference', response.actions, recipient.escalationHistory, 'actionId'),
  ];
  const joined = new Set(['evidencePins', 'assertions', 'decisions', 'actions']);
  for (const key of Object.keys(response)) if (!joined.has(key)) rows.push(row('Internal response field', key, field(response, key), absent));
  const comparedInternal = new Set(['case', 'analystResponse']), comparedRecipient = new Set(['case', 'selectedEvidence', 'contradictions', 'escalationHistory']);
  const internalEnvelope = Object.fromEntries(Object.entries(internal).filter(([key]) => !comparedInternal.has(key)));
  const recipientEnvelope = Object.fromEntries(Object.entries(recipient).filter(([key]) => !comparedRecipient.has(key)));
  return [...rows, ...fields('Prepared envelope field', internalEnvelope, recipientEnvelope)];
}
