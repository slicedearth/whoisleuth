import {
  ACQUISITION_MANUAL_CHECKS,
  buildAcquisitionDecisionPacket,
  readAcquisitionDecisionPacket,
  MAX_ACQUISITION_DECISION_PACKET_BYTES,
  type AcquisitionDecision,
  type AcquisitionManualCheck,
  type AcquisitionDecisionPacket,
} from '../../../../packages/investigation/acquisition-decision-packet.mts';
import type { AcquisitionDueDiligence } from '../../../../packages/investigation/acquisition-due-diligence.mts';

export type AcquisitionReviewDraft = Readonly<{
  decision: AcquisitionDecision;
  rationale: string;
  reviewedChecks: readonly AcquisitionManualCheck[];
}>;
export type AcquisitionReviewContext = Readonly<{
  target: string;
  synthetic: boolean;
  observedAt: string | null;
  review: AcquisitionDueDiligence;
}>;

/** Owns transient reopen intent only; historical evidence is never applied. */
export function createAcquisitionReviewWorkspace(
  options: Readonly<{
    readContext: () => AcquisitionReviewContext;
    readDraft: () => AcquisitionReviewDraft;
    writeDraft: (draft: AcquisitionReviewDraft) => void;
  }>,
) {
  let generation = 0;
  let pending: { packet: AcquisitionDecisionPacket; contextIdentity: string } | null = null;
  let reopened = false,
    confirmation: string | null = null;
  const contextIdentity = () => JSON.stringify(options.readContext());
  const intentIdentity = () =>
    JSON.stringify({ context: options.readContext(), draft: options.readDraft() });
  return Object.freeze({
    cancel() {
      generation++;
      pending = null;
    },
    async preview(file: Blob) {
      const request = ++generation;
      pending = null;
      if (
        !(file instanceof Blob) ||
        !file.size ||
        file.size > MAX_ACQUISITION_DECISION_PACKET_BYTES
      ) {
        throw new TypeError(
          'Select one acquisition decision packet within the 15 MiB input limit.',
        );
      }
      const body = file.slice();
      const context = options.readContext(),
        identity = contextIdentity();
      const expected = { target: context.target, synthetic: context.synthetic };
      const packet = await readAcquisitionDecisionPacket(await body.text(), expected);
      if (request !== generation) return null;
      if (identity !== contextIdentity())
        throw new Error(
          'The current Lookup evidence changed. Reopen the packet against the current target and evidence.',
        );
      pending = { packet, contextIdentity: identity };
      return packet;
    },
    accept() {
      if (!pending || pending.contextIdentity !== contextIdentity())
        throw new Error('The current Lookup evidence changed. Reopen and review the packet again.');
      const review = pending.packet.analystReview;
      options.writeDraft({
        decision: review.decision,
        rationale: review.rationale,
        reviewedChecks: [...review.reviewedChecks],
      });
      reopened = true;
      confirmation = null;
      pending = null;
      generation++;
    },
    reconfirm(selected: boolean) {
      confirmation = selected ? intentIdentity() : null;
    },
    isReconfirmed() {
      return confirmation !== null && confirmation === intentIdentity();
    },
    async prepareDownload() {
      const identity = intentIdentity();
      // JSON-owned bounded review fields detach Svelte proxies and freeze intent
      // before the digest await, without replacing current Lookup evidence.
      const snapshot = JSON.parse(identity) as {
        context: AcquisitionReviewContext;
        draft: AcquisitionReviewDraft;
      };
      const reviewed =
        snapshot.draft.decision !== 'unresolved' &&
        ACQUISITION_MANUAL_CHECKS.every((check) => snapshot.draft.reviewedChecks.includes(check));
      if (reopened && reviewed && confirmation !== identity)
        throw new Error(
          'Reconfirm the decision and selected manual checks against the current evidence before preparing a new reviewed packet.',
        );
      const exported = await buildAcquisitionDecisionPacket({
        ...snapshot.draft,
        target: snapshot.context.target,
        synthetic: snapshot.context.synthetic,
        evidenceObservedAt: snapshot.context.observedAt,
        review: snapshot.context.review,
      });
      if (identity !== intentIdentity())
        throw new Error(
          'The evidence or manual review changed while preparing the packet. Review the current inputs and prepare it again.',
        );
      return exported;
    },
  });
}
