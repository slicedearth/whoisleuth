import {
  buildCaseResponseReadiness, buildCaseResponseReviewDigest,
  RESPONSE_AUTHORISATION_CONFIRMATION_IDS,
  type CaseResponsePacketInput, type ResponseAuthorisationConfirmationId,
} from '../../../../packages/cases/case-response-packet.mts';
import type { CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
import { readinessAllowsPacketAuthorisation } from '../analysis/case-packet-approval.ts';

export type CasePacketReviewState = Readonly<{
  digest: string;
  signature: string;
  confirmedAt: string | null;
  interrupted: boolean;
  confirmations: Readonly<Record<ResponseAuthorisationConfirmationId, boolean>>;
}>;
type Context = Readonly<{ record: CaseRecord; input: CaseResponsePacketInput; signature: string }>;
const emptyConfirmations = () => Object.freeze(Object.fromEntries(
  RESPONSE_AUTHORISATION_CONFIRMATION_IDS.map(id => [id, false]),
) as Record<ResponseAuthorisationConfirmationId, boolean>);

/** Owns a transient review decision, not persistence or operation lifetime. */
export function createCasePacketReviewSession<Operation>(options: Readonly<{
  context: () => Context;
  canAuthorise: () => boolean;
  operations: Readonly<{
    begin: (kind: 'authorisation' | 'other') => Operation | null;
    current: (operation: Operation) => boolean;
    finish: (operation: Operation) => void;
  }>;
  changed: (state: CasePacketReviewState) => void;
  message: (message: string) => void;
  phase: (phase: 2 | 3) => Promise<void>;
  now?: () => string;
  digest?: typeof buildCaseResponseReviewDigest;
}>) {
  let state: CasePacketReviewState = Object.freeze({ digest: '', signature: '', confirmedAt: null,
    interrupted: false, confirmations: emptyConfirmations() });
  let confirmationRevision = 0;
  const now = options.now ?? (() => new Date().toISOString());
  const digest = options.digest ?? buildCaseResponseReviewDigest;
  function update(change: Partial<CasePacketReviewState>) {
    state = Object.freeze({ ...state, ...change });
    options.changed(state);
  }
  return Object.freeze({
    snapshot: () => state,
    interrupt() { update({ interrupted: true }); },
    confirm(id: ResponseAuthorisationConfirmationId, checked: boolean) {
      confirmationRevision++;
      update({ confirmations: Object.freeze({ ...state.confirmations, [id]: checked }), confirmedAt: null });
    },
    async review() {
      const operation = options.operations.begin('other');
      if (!operation) return;
      update({ interrupted: false });
      try {
        const context = options.context();
        const reviewedDigest = await digest(context.record, context.input, now());
        if (!options.operations.current(operation)) return;
        if (context.signature !== options.context().signature) {
          update({ confirmedAt: null });
          options.message('The local packet inputs changed while the review digest was being prepared. Review and bind the current inputs again.');
          return;
        }
        confirmationRevision++;
        update({ digest: reviewedDigest, signature: context.signature, confirmations: emptyConfirmations(), confirmedAt: null });
        options.message('Bound the current draft to a review digest. Complete the review, then confirm each authorisation statement.');
        options.operations.finish(operation);
        await options.phase(2);
      } catch (cause) {
        if (options.operations.current(operation)) options.message(cause instanceof Error ? cause.message : 'Could not bind the current packet inputs for review.');
      } finally { options.operations.finish(operation); }
    },
    async authorise() {
      if (!options.canAuthorise()) return;
      const operation = options.operations.begin('authorisation');
      if (!operation) return;
      const revision = confirmationRevision;
      update({ confirmedAt: null, interrupted: false });
      try {
        const context = options.context();
        const currentDigest = await digest(context.record, context.input, now());
        if (!options.operations.current(operation)) return;
        if (revision !== confirmationRevision || !RESPONSE_AUTHORISATION_CONFIRMATION_IDS.every(id => state.confirmations[id])) {
          options.message('The confirmation decision changed during authorisation. Review your current confirmations and authorise again.');
          return;
        }
        const current = options.context();
        if (context.signature !== current.signature || context.signature !== state.signature || currentDigest !== state.digest) {
          options.message('The reviewed inputs or their freshness state changed. Review and bind the current packet again before authorisation.');
          return;
        }
        if (!readinessAllowsPacketAuthorisation(buildCaseResponseReadiness(current.record, current.input, now()))) {
          options.message('Required readiness inputs are no longer complete. Review readiness before authorising the current packet.');
          return;
        }
        update({ confirmedAt: now() });
        options.message('Authorised the exact reviewed inputs. Nothing was submitted.');
        options.operations.finish(operation);
        await options.phase(3);
      } catch (cause) {
        if (options.operations.current(operation)) {
          update({ confirmedAt: null });
          options.message(cause instanceof Error ? cause.message : 'Could not verify the exact packet review before authorisation.');
        }
      } finally { options.operations.finish(operation); }
    },
  });
}
