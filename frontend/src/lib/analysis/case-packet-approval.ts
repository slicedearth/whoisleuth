import type { CaseResponsePreflight, CaseResponseReadinessRow } from '../../../../packages/cases/case-response-packet-types.mts';

type Readiness = Readonly<{ rows: readonly CaseResponseReadinessRow[] }>;
export type PacketApprovalTarget = 'incident' | 'evidence' | 'recipient' | 'readiness' | 'review' | 'confirmations' | 'authorise' | 'export';

function missingReadiness(readiness: Readiness) {
  const missing = readiness.rows.find(row => row.requiredForAuthorisation && ['not_provided', 'unavailable'].includes(row.state));
  if (missing) return missing;
  const authority = readiness.rows.find(row => row.id === 'authority_review');
  return authority?.state === 'complete' ? undefined : authority ?? null;
}

/** UI projection only. Packet creation independently validates its inputs. */
export function readinessAllowsPacketAuthorisation(readiness: Readiness): boolean {
  return missingReadiness(readiness) === undefined;
}

export function casePacketApprovalState(input: Readonly<{
  preflight: Pick<CaseResponsePreflight, 'canExport' | 'checks'>;
  readiness: Readiness;
  reviewPresent: boolean;
  reviewCurrent: boolean;
  confirmationsComplete: boolean;
  confirmed: boolean;
  interrupted: boolean;
}>) {
  const missing = missingReadiness(input.readiness);
  const canAuthorise = input.preflight.canExport && input.reviewCurrent && input.confirmationsComplete && missing === undefined;
  const authorised = canAuthorise && input.confirmed;
  const stageStatus = authorised ? 'complete' as const
    : input.reviewPresent && !input.reviewCurrent ? 'attention' as const
      : input.preflight.canExport ? 'in_progress' as const : 'not_started' as const;
  const contextNotice = input.interrupted
    ? 'The previous authorisation stopped when its review context changed. It did not authorise these inputs.' : '';
  const state = (message: string, actionLabel: string, target: PacketApprovalTarget) => ({
    authorised, canAuthorise, stageStatus, contextNotice, message, actionLabel, target,
    readinessRow: missing?.id ?? null,
  });
  if (!input.preflight.canExport) {
    const blocked = input.preflight.checks.find(check => check.state === 'block');
    const target = ['recipient_route', 'profile_recipient', 'packet_action'].includes(blocked?.id ?? '') ? 'recipient' : 'incident';
    return state(blocked?.detail ?? 'Complete the required packet inputs before review.', 'Review required packet inputs', target);
  }
  if (missing !== undefined) {
    const target = missing && ['observed_behaviour', 'exact_url', 'observation_time'].includes(missing.id) ? 'incident'
      : missing && ['capture_provenance', 'selected_evidence'].includes(missing.id) ? 'evidence'
        : missing?.id === 'recipient_route' ? 'recipient' : 'readiness';
    return state(missing === null || missing.id === 'authority_review'
      ? 'Complete the analyst authority review before authorisation.'
      : `${missing.label} needs review before authorisation.`, 'Review missing readiness', target);
  }
  if (!input.reviewCurrent) return state(input.reviewPresent
    ? 'Material inputs changed; review and bind the current inputs again.'
    : 'Review the selected material and bind its exact inputs before confirming authorisation.', 'Go to exact-input review', 'review');
  if (!input.confirmationsComplete) return state('Complete each confirmation for the current reviewed inputs.', 'Go to confirmations', 'confirmations');
  if (!input.confirmed) return state('The inputs and confirmations are ready for your explicit authorisation.', 'Go to authorisation', 'authorise');
  return state('The current exact inputs are authorised for deliberate local export.', 'Go to local export', 'export');
}
