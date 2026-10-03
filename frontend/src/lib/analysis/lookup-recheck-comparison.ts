import {
  compareCaseEvidence,
  caseEvidenceIncomparableReasons,
} from '../../../../packages/cases/case-evidence-model.mts';
import type { CaseEvidenceSnapshot } from '../../../../packages/cases/case-record-contracts.mts';
import type { LookupRecheckComparison } from '../controllers/lookup-case-controller.ts';

export function compareLookupRecheck(
  before: CaseEvidenceSnapshot | null,
  after: CaseEvidenceSnapshot | null,
): LookupRecheckComparison {
  const observedAt = after?.capturedAt ?? '';
  if (!before || !after)
    return {
      available: false,
      changes: [],
      observedAt,
      detail:
        'A uniquely latest prior and current Case observation are required. Review any equal-time or undated snapshots before comparing.',
    };
  if (Date.parse(after.capturedAt) <= Date.parse(before.capturedAt))
    return {
      available: false,
      changes: [],
      observedAt,
      detail:
        'No later Case capture is available. Equal or earlier capture times cannot establish a recheck outcome.',
    };
  const changes = compareCaseEvidence(before, after);
  if (caseEvidenceIncomparableReasons(before, after).includes('observation-context'))
    return {
      available: false,
      changes,
      observedAt,
      detail:
        'These captures concern different or unknown hostnames. Only registration fields can be compared; recheck the same hostname before recording an observed-effect outcome.',
    };
  return {
    available: true,
    changes,
    observedAt,
    detail: changes.length
      ? `${changes.length} comparable material change${changes.length === 1 ? ' was' : 's were'} found.`
      : 'No comparable material field change was found. This does not prove the page or behaviour is absent.',
  };
}
