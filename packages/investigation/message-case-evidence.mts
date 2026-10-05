import type { MessageIntakeReport } from '../contracts/message-intake.mts';
import type { LocalCaseReviewSummary } from '../cases/case-review-summary.mts';
import { intakeIndicators } from './intake-indicators.mts';

export function messageCaseEvidence(report: MessageIntakeReport, reportDigestSha256: string): LocalCaseReviewSummary {
  return { title: report.identityEventReview ? 'Selected identity-event review' : 'Analyst-selected message review', reviewedAt: report.reviewedAt, reportDigestSha256,
      completeness: report.coverage.state === 'partial' ? 'partial' : 'inconclusive',
      summary: report.identityEventReview
        ? `Offline identity review: ${report.identityEventReview.events.length} supplied events${report.identityEventReview.comparison ? `, ${report.identityEventReview.comparison.events.filter(event => event.state === 'matched').length} matches within the selected field/time scope` : ', no field comparison selected'}. Source bytes: ${report.source.digestSha256}. Matching fields do not establish account compromise.`
        : report.schemaVersion === 1
          ? `Offline ${report.source.kind} review: ${report.links.length} extracted links, ${report.identities.length} domain identity declarations, ${report.authenticationReview.headers.length} source-indexed authentication headers. Source bytes: ${report.source.digestSha256}. See the retained minimised review for individual destinations and header claims.`
          : `Offline ${report.source.kind} review: ${report.links.length} extracted links, ${intakeIndicators(report).length} source-linked literal indicators, ${report.identities.length} domain identity declarations, ${report.authenticationReview.headers.length} source-indexed authentication headers. Source bytes: ${report.source.digestSha256}. See the retained minimised review for individual observations${report.distributionContext ? ' and separately declared distribution context' : ''}.`,
      limitations: ['The selected input is analyst-supplied; this is not live collection or independent sender authentication.', 'The timestamp is the local review time, not a verified event time.',
        ...(report.schemaVersion === 2 && report.selectedEvidence ? ['Selected phone values, source text and supplied destination-pair details are omitted from this Case summary. Phone selections have no supported STIX or MISP mapping; the private retained review carries their provenance and uncertainty.'] : [])],
    };
}
