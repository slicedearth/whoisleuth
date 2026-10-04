import { DomainFeedIntakeOperation } from './domain-feed-intake.ts';
import {
  queryDomainFeedHistory,
  type PreparedDomainFeedHistory,
  type PreparedDomainFeedReview,
} from '../domain-feed-client.ts';
import {
  normalizeDomainFeedCursor,
  type DomainFeedCursor,
} from '../../../../packages/monitoring/domain-feed-history.mts';
import type { DomainFeedSelection } from '../../../../packages/monitoring/domain-feed.mts';

export type DomainFeedHistoryState = Readonly<{
  page: PreparedDomainFeedHistory | null;
  busy: boolean;
  message: string;
}>;
export function parseDomainFeedHistoryCursor(
  text: string,
  feedId: string,
  selection: DomainFeedSelection,
): DomainFeedCursor {
  if (typeof text !== 'string' || !text.trim() || text.length > 4096)
    throw new TypeError('Paste one bounded saved feed cursor (at most 4,096 characters).');
  return normalizeDomainFeedCursor(JSON.parse(text), feedId, selection);
}

/** Progress changes only after validation and successful local staging, never on a failed request. */
export class DomainFeedHistoryController {
  private operation = new DomainFeedIntakeOperation();
  private state: DomainFeedHistoryState = { page: null, busy: false, message: '' };
  private options: Readonly<{
    context: () => string;
    publish: (state: DomainFeedHistoryState) => void;
    stage: (reviews: readonly PreparedDomainFeedReview[], context: string) => void;
    query?: typeof queryDomainFeedHistory;
  }>;
  constructor(options: DomainFeedHistoryController['options']) {
    this.options = options;
  }
  private update(patch: Partial<DomainFeedHistoryState>) {
    this.state = { ...this.state, ...patch };
    this.options.publish(this.state);
  }
  changed() {
    this.operation.invalidate();
    this.update({ page: null, busy: false, message: '' });
  }
  cancel() {
    this.operation.invalidate();
    this.update({
      busy: false,
      message: 'History request cancelled. The last reviewed page and cursor are unchanged.',
    });
  }
  dispose() {
    this.operation.invalidate();
  }
  async load(feedId: string, selection: DomainFeedSelection, cursor: DomainFeedCursor | null) {
    const submitted = this.operation.begin(this.options.context());
    this.update({ busy: true, message: '' });
    try {
      const page = await (this.options.query ?? queryDomainFeedHistory)(
        feedId,
        selection,
        cursor,
        submitted.signal,
      );
      if (!this.operation.current(submitted, this.options.context())) return;
      this.options.stage(page.prepared ? [page.prepared] : [], submitted.context);
      if (!this.operation.current(submitted, this.options.context())) return;
      this.update({
        page,
        message:
          page.history.state === 'gap'
            ? 'An unavailable edition range needs explicit acknowledgement; no empty review was inferred.'
            : page.history.state === 'complete'
              ? 'The reviewed retained range is complete. Checking for newer editions is a separate action.'
              : `${page.prepared!.candidates.length} historical nominations staged. Review individual candidates before advancing.`,
      });
    } catch (cause) {
      if (this.operation.current(submitted, this.options.context()))
        this.update({
          message: `${cause instanceof Error ? cause.message : 'History could not be reviewed.'} The last reviewed cursor is unchanged.`,
        });
    } finally {
      if (this.operation.current(submitted, this.options.context())) this.update({ busy: false });
      this.operation.finish(submitted);
    }
  }
}
