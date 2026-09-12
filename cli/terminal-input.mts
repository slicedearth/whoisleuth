import { StringDecoder } from 'node:string_decoder';
import { CliUsageError, hasUnsafeCliText } from './errors.mts';
import type { TerminalEnvironment, WritableTerminal } from './terminal-presentation.mts';

export type TerminalInput = {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(enabled: boolean): unknown;
  resume?(): unknown;
  pause?(): unknown;
  isPaused?(): boolean;
  on?(event: 'data' | 'end', listener: (chunk?: unknown) => void): unknown;
  off?(event: 'data' | 'end', listener: (chunk?: unknown) => void): unknown;
};

type TerminalQuestionOptions = Readonly<{ input: TerminalInput; output: WritableTerminal; signal?: AbortSignal }>;

export function canReadInteractiveLine(input: TerminalInput | null | undefined, output: WritableTerminal | null | undefined, environment: TerminalEnvironment = process.env): boolean {
  return input?.isTTY === true && output?.isTTY === true
    && typeof input.setRawMode === 'function' && typeof input.resume === 'function'
    && typeof input.pause === 'function' && typeof input.on === 'function'
    && typeof input.off === 'function' && typeof output.write === 'function'
    && !environment.CI;
}

const MAX_INTERACTIVE_ANSWER_SCALARS = 1_024;
const MAX_INTERACTIVE_ANSWER_BYTES = 4_096;

function boundedInteractiveAnswer(value: unknown): string {
  const supplied = typeof value === 'string' ? value : '';
  if (Buffer.byteLength(supplied, 'utf8') > MAX_INTERACTIVE_ANSWER_BYTES
    || Array.from(supplied).length > MAX_INTERACTIVE_ANSWER_SCALARS
    || hasUnsafeCliText(supplied)) {
    throw new CliUsageError('Interactive input must be bounded text without control characters.');
  }
  return supplied.trim();
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function readBoundedInteractiveLine(
  prompt: string,
  options: TerminalQuestionOptions,
): Promise<string> {
  const { input, output, signal } = options;
  if (signal?.aborted) return Promise.reject(signal.reason || abortError());
  const previousRaw = input.isRaw === true;
  const wasPaused = input.isPaused?.() === true;
  let receivedBytes = 0;
  let receivedScalars = 0;
  let settled = false;
  let characters: string[] = [];
  const decoder = new StringDecoder('utf8');

  return new Promise<string>((resolve, reject) => {
    const cleanup = (): Error | null => {
      let failure: Error | null = null;
      const attempt = (operation: () => unknown) => {
        try { operation(); } catch (error) {
          failure ||= error instanceof Error ? error : new Error('Interactive terminal cleanup failed.');
        }
      };
      attempt(() => input.off?.('data', onData));
      attempt(() => input.off?.('end', onEnd));
      attempt(() => signal?.removeEventListener('abort', onAbort));
      attempt(() => input.setRawMode?.(previousRaw));
      if (wasPaused) attempt(() => input.pause?.());
      return failure;
    };
    const finish = (value?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      const cleanupFailure = cleanup();
      characters = [];
      if (error && cleanupFailure) {
        reject(new AggregateError(
          [error, cleanupFailure],
          `${error.message}; terminal cleanup also failed: ${cleanupFailure.message}`,
        ));
      } else if (error || cleanupFailure) reject(error || cleanupFailure!);
      else resolve(value || '');
    };
    const rejectUsage = () => finish(undefined, new CliUsageError(
      'Interactive input must be bounded text without control characters.',
    ));
    const onData = (chunk: unknown) => {
      if (settled) return;
      let rawChunk: Buffer;
      if (Buffer.isBuffer(chunk)) {
        if (chunk.length > MAX_INTERACTIVE_ANSWER_BYTES - receivedBytes) {
          rejectUsage();
          return;
        }
        rawChunk = chunk;
      } else {
        const supplied = String(chunk ?? '');
        if (supplied.length > MAX_INTERACTIVE_ANSWER_BYTES - receivedBytes
          || Buffer.byteLength(supplied, 'utf8') > MAX_INTERACTIVE_ANSWER_BYTES - receivedBytes) {
          rejectUsage();
          return;
        }
        rawChunk = Buffer.from(supplied, 'utf8');
      }
      receivedBytes += rawChunk.length;
      const value = decoder.write(rawChunk);
      receivedScalars += Array.from(value).length;
      if (receivedBytes > MAX_INTERACTIVE_ANSWER_BYTES
        || receivedScalars > MAX_INTERACTIVE_ANSWER_SCALARS
        || value.includes('\ufffd')) {
        rejectUsage();
        return;
      }
      for (const character of value) {
        if (character === '\r' || character === '\n') {
          try { output.write('\n'); } catch (error) {
            finish(undefined, error instanceof Error ? error : new Error('Interactive terminal output failed.'));
            return;
          }
          finish(characters.join(''));
          return;
        }
        if (character === '\u0003' || character === '\u0004' || character === '\u001b') {
          finish(undefined, abortError());
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          if (characters.length) {
            characters.pop();
            try { output.write('\b \b'); } catch (error) {
              finish(undefined, error instanceof Error ? error : new Error('Interactive terminal output failed.'));
              return;
            }
          }
          continue;
        }
        if (hasUnsafeCliText(character)) {
          rejectUsage();
          return;
        }
        characters.push(character);
        try { output.write(character); } catch (error) {
          finish(undefined, error instanceof Error ? error : new Error('Interactive terminal output failed.'));
          return;
        }
      }
    };
    const onEnd = () => {
      const remainder = decoder.end();
      if (remainder) rejectUsage();
      else finish(undefined, abortError());
    };
    const onAbort = () => finish(undefined, signal?.reason instanceof Error ? signal.reason : abortError());

    try {
      output.write(prompt);
      input.on?.('data', onData);
      input.on?.('end', onEnd);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      input.setRawMode?.(true);
      if (settled) return;
      input.resume?.();
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error('Interactive terminal input failed.'));
    }
  });
}

export { MAX_INTERACTIVE_ANSWER_BYTES, MAX_INTERACTIVE_ANSWER_SCALARS, boundedInteractiveAnswer, readBoundedInteractiveLine };
