import {
  requestLookup,
  type LookupRequestOutcome,
} from '../../../../lib/lookup-request.mts';

type LookupRequest = (
  url: string,
  options: Readonly<{ signal?: AbortSignal }>,
) => Promise<LookupRequestOutcome>;

type LookupControllerResult =
  | { readonly state: 'complete'; readonly outcome: LookupRequestOutcome }
  | { readonly state: 'stale' };

type LookupRequestControllerOptions = Readonly<{
  request?: LookupRequest;
  now?: () => number;
  progressIntervalMs?: number;
}>;

const DEFAULT_PROGRESS_INTERVAL_MS = 250;

class LookupRequestController {
  readonly #request: LookupRequest;
  readonly #now: () => number;
  readonly #progressIntervalMs: number;
  #sequence = 0;
  #activeController: AbortController | null = null;
  #progressTimer: ReturnType<typeof setInterval> | null = null;
  #disposed = false;

  constructor(options: LookupRequestControllerOptions = {}) {
    this.#request = options.request ?? requestLookup;
    this.#now = options.now ?? (() => performance.now());
    this.#progressIntervalMs = Number.isFinite(options.progressIntervalMs)
      ? Math.max(10, Math.round(Number(options.progressIntervalMs)))
      : DEFAULT_PROGRESS_INTERVAL_MS;
  }

  async run(
    url: string,
    onProgress: (elapsedMs: number) => void,
    prepare: () => Promise<void> = async () => {},
  ): Promise<LookupControllerResult> {
    if (this.#disposed) return { state: 'stale' };

    const sequence = ++this.#sequence;
    this.#activeController?.abort('superseded');
    this.#clearProgressTimer();
    const controller = new AbortController();
    this.#activeController = controller;
    const startedAt = this.#now();
    onProgress(0);
    this.#progressTimer = setInterval(() => {
      if (sequence === this.#sequence && !this.#disposed) {
        onProgress(Math.max(0, this.#now() - startedAt));
      }
    }, this.#progressIntervalMs);

    try {
      await prepare();
      if (sequence !== this.#sequence || this.#disposed) return { state: 'stale' };
      const outcome = await this.#request(url, { signal: controller.signal });
      if (sequence !== this.#sequence || this.#disposed) return { state: 'stale' };
      onProgress(Math.max(0, this.#now() - startedAt));
      return { state: 'complete', outcome };
    } finally {
      if (sequence === this.#sequence) {
        this.#activeController = null;
        this.#clearProgressTimer();
      }
    }
  }

  cancel(): void {
    this.#activeController?.abort('user_cancelled');
  }

  invalidate(): void {
    this.#sequence += 1;
    this.#activeController?.abort('superseded');
    this.#activeController = null;
    this.#clearProgressTimer();
  }

  dispose(): void {
    this.#disposed = true;
    this.#sequence += 1;
    this.#activeController?.abort('navigation');
    this.#activeController = null;
    this.#clearProgressTimer();
  }

  #clearProgressTimer(): void {
    if (this.#progressTimer !== null) {
      clearInterval(this.#progressTimer);
      this.#progressTimer = null;
    }
  }
}

export {
  DEFAULT_PROGRESS_INTERVAL_MS,
  LookupRequestController,
};
export type {
  LookupControllerResult,
  LookupRequest,
  LookupRequestControllerOptions,
};
