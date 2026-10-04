import { DOMAIN_FEED_LIMITS, scanDomainFeed, type DomainFeedReview, type DomainFeedSelection } from '../../../packages/monitoring/domain-feed.mts';

export type DomainFeedWorkerRequest = Readonly<{
  kind: 'scan';
  file: Blob;
  feedId: string;
  selection: DomainFeedSelection;
  importedAt: string;
}>;
export type DomainFeedWorkerResponse = { kind: 'scan'; review: DomainFeedReview } | { kind: 'error'; detail: string };

/** The worker retains bounded matches, never the complete feed or its filename. */
export async function runDomainFeedWorkerOperation(request: DomainFeedWorkerRequest): Promise<DomainFeedWorkerResponse> {
  try {
    if (request?.kind !== 'scan' || !(request.file instanceof Blob)) throw new TypeError('Choose a domain-only feed file for local review.');
    if (request.file.size > DOMAIN_FEED_LIMITS.bytes) throw new RangeError('The supplied feed exceeds the bounded file size.');
    async function* chunks(): AsyncGenerator<Uint8Array> {
      const reader = request.file.stream().getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          yield next.value;
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    const review = await scanDomainFeed(chunks(), { feedId: request.feedId, selection: request.selection, importedAt: request.importedAt });
    return { kind: 'scan', review };
  } catch (cause) {
    return { kind: 'error', detail: cause instanceof Error ? cause.message.slice(0, 300) : 'The feed could not be reviewed. No candidates were retained.' };
  }
}
