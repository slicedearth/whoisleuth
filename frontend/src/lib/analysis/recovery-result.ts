import type { RecoveryFile } from '../../../../packages/workspace/workspace-recovery.mts';
import type { WorkspaceRecoveryReport } from '../workspace-recovery.ts';

/** Advice describes only the last completed read; it never authorises a write. */
export function recoveryFileGuidance(file: Pick<RecoveryFile, 'state' | 'failure'>) {
  if (file.state === 'missing') return {
    label: 'Missing original',
    next: 'Locate the original in your backup set and restore files with this exact SHA-256 and byte length. A matching filename is not enough.',
  };
  if (file.failure === 'integrity') return {
    label: 'Unverified — integrity check failed in this group',
    next: 'At least one file in this read group failed an integrity check; this result does not identify which one. Keep the existing data, locate exact originals and verify again. Do not substitute a similar file.',
  };
  if (file.failure === 'unsupported') return {
    label: 'Unverified — file storage not supported',
    next: 'Use a compatible workspace reader before verifying again. Unsupported storage does not establish that these originals are missing.',
  };
  return {
    label: 'Unverified — read did not complete',
    next: 'Check workspace access, then verify restored data again. A failed read does not establish that the original is missing.',
  };
}

export function recoveryResultBrief(report: WorkspaceRecoveryReport) {
  return Object.freeze({
    heading: report.verified ? 'Selected backup recovered and verified' : 'Recovery still needs attention',
    sectionsNeedReview: !report.metadataMatches || report.omissions > 0,
    originalsNeeded: report.files.missing > 0,
    unverified: report.files.unverified > 0,
    integrityFailure: report.files.checklist.some(file => file.state === 'unverified' && file.failure === 'integrity'),
    unsupported: report.files.checklist.some(file => file.state === 'unverified' && file.failure === 'unsupported'),
  });
}
