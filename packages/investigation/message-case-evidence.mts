import type { MessageIntakeReport } from '../contracts/message-intake.mts';
import { EXTERNAL_FINDINGS_SCHEMA, EXTERNAL_FINDINGS_VERSION, parseExternalFindingsDocument } from '../interchange/external-findings-import.mts';

export function messageCaseEvidence(report: MessageIntakeReport, caseDomain: string) {
  return parseExternalFindingsDocument({ schema: EXTERNAL_FINDINGS_SCHEMA, schemaVersion: EXTERNAL_FINDINGS_VERSION,
    source: { name: 'Analyst-selected message review', reference: null, collectedAt: report.reviewedAt }, findings: [{ domain: caseDomain,
      category: 'other', evidenceClass: 'provider_report', observedAt: report.reviewedAt,
      completeness: report.coverage.state === 'partial' ? 'partial' : 'inconclusive',
      summary: `Offline ${report.source.kind} review: ${report.links.length} extracted links, ${report.identities.length} domain identity declarations, ${report.authenticationClaims.length} reported authentication results. Source bytes: ${report.source.digestSha256}. See the retained minimised review for individual destinations.`,
      limitations: ['The selected input is analyst-supplied; this is not live collection or independent sender authentication.', 'The timestamp is the local review time, not a verified event time.'],
      reference: null, structuredObservation: null }] });
}
