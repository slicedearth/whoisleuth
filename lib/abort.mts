function abortReason(signal: AbortSignal): unknown {
  return signal.reason || new DOMException('Aborted', 'AbortError');
}

function abortable<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve().then(operation);
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortReason(signal));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
  });
}

function withTimeout<T>(
  operation: () => T | Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out.',
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return Promise.reject(new TypeError('Timeout must be a positive integer.'));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), timeoutMs);
  return abortable(operation, controller.signal).finally(() => clearTimeout(timer));
}

export { abortable, withTimeout };
