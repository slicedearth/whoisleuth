import type { MessageIntakeReport } from '../contracts/message-intake.mts';
import type { LocalCaseReviewSummary } from '../cases/case-review-summary.mts';

export function messageCaseEvidence(report: MessageIntakeReport, reportDigestSha256: string): LocalCaseReviewSummary {
  return { title: 'Analyst-selected message review', reviewedAt: report.reviewedAt, reportDigestSha256,
      completeness: report.coverage.state === 'partial' ? 'partial' : 'inconclusive',
      summary: `Offline ${report.source.kind} review: ${report.links.length} extracted links, ${report.identities.length} domain identity declarations, ${report.authenticationReview.headers.length} source-indexed authentication headers. Source bytes: ${report.source.digestSha256}. See the retained minimised review for individual destinations and header claims.`,
      limitations: ['The selected input is analyst-supplied; this is not live collection or independent sender authentication.', 'The timestamp is the local review time, not a verified event time.'],
    };
}
