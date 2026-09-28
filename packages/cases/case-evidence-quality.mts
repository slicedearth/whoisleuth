import type { CaseEvidencePin } from './case-response-records.mts';

/** Collection completeness does not establish a usable date, comparison or conclusion. */
export function casePinHasCompleteObservation(
  pin: Pick<CaseEvidencePin, 'completeness' | 'truncated' | 'sourceState'>,
): boolean {
  return pin.completeness === 'complete' && !pin.truncated
    && ['complete', 'success', 'reviewed', 'not_found'].includes(pin.sourceState ?? '');
}
