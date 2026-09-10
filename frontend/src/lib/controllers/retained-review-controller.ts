import { runRetainedReviewWorker } from '../retained-review-worker.ts';
import type { RetainedReviewInputs, RetainedReviewKind, RetainedReviewResults } from '../retained-review-worker-model.ts';

export type RetainedReviewPreparation<Kind extends RetainedReviewKind> = Readonly<{
  state: 'idle' | 'loading' | 'ready' | 'unavailable';
  input: RetainedReviewInputs[Kind] | null;
  result: RetainedReviewResults[Kind] | null;
  error: string;
}>;

/** One current immutable input and result per view; no durable data or timers. */
export function createRetainedReviewController<Kind extends RetainedReviewKind>(
  kind: Kind,
  changed: (state: RetainedReviewPreparation<Kind>) => void,
  options: Readonly<{
    now?: () => string;
    run?: (kind: Kind, input: RetainedReviewInputs[Kind], evaluatedAt: string, options: Readonly<{ signal: AbortSignal }>) => Promise<RetainedReviewResults[Kind]>;
  }> = {},
) {
  let generation = 0;
  let active: AbortController | null = null;
  let current: RetainedReviewPreparation<Kind> = { state: 'idle', input: null, result: null, error: '' };
  let disposed = false;
  const run: NonNullable<typeof options.run> = options.run ?? runRetainedReviewWorker;
  function publish(next: RetainedReviewPreparation<Kind>) { current = next; changed(next); }
  function cancel() { generation += 1; active?.abort(); active = null; }
  function prepare(input: RetainedReviewInputs[Kind], refresh = false) {
    if (disposed || (!refresh && current.input === input && (current.state === 'ready' || current.state === 'loading'))) return;
    const previous = current.input === input ? current.result : null;
    cancel();
    const expected = generation;
    const controller = new AbortController();
    active = controller;
    publish({ state: 'loading', input, result: previous, error: '' });
    void Promise.resolve().then(() => {
      if (disposed || controller.signal.aborted || generation !== expected) throw new DOMException('Retained review was cancelled.', 'AbortError');
      return run(kind, input, (options.now ?? (() => new Date().toISOString()))(), { signal: controller.signal });
    })
      .then((result) => {
        if (disposed || controller.signal.aborted || generation !== expected) return;
        active = null;
        publish({ state: 'ready', input, result, error: '' });
      }).catch((error: unknown) => {
        if (disposed || controller.signal.aborted || generation !== expected) return;
        active = null;
        publish({ state: 'unavailable', input, result: previous, error: error instanceof Error ? error.message : 'Retained review could not be prepared.' });
      });
  }
  function suspend() {
    if (!active) return;
    cancel();
    publish({ ...current, state: current.result ? 'ready' : 'idle', error: '' });
  }
  return Object.freeze({
    prepare,
    select(input: RetainedReviewInputs[Kind] | null, enabled: boolean) {
      if (disposed) return;
      if (input !== current.input) {
        cancel();
        publish({ state: 'idle', input, result: null, error: '' });
      }
      if (!enabled) suspend();
      else if (input && current.state === 'idle') prepare(input);
    },
    suspend,
    dispose() { disposed = true; cancel(); current = { state: 'idle', input: null, result: null, error: '' }; },
  });
}
