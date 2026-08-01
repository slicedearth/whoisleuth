import {
  terminalPresentation,
  tone,
  type TerminalEnvironment,
  type WritableTerminal,
} from './terminal-presentation.mts';

type ProgressOptions = Readonly<{
  enabled: boolean;
  color: boolean;
  environment?: TerminalEnvironment;
  now?: () => number;
}>;

type TerminalProgress = Readonly<{
  enabled: boolean;
  start(message: string): void;
  update(message: string): void;
  stop(): void;
}>;

const PROGRESS_FRAMES = Object.freeze(['◐', '◓', '◑', '◒']);
const MAX_PROGRESS_MESSAGE_LENGTH = 160;

function safeProgressMessage(value: unknown): string {
  return String(value || 'Working')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_PROGRESS_MESSAGE_LENGTH) || 'Working';
}

function createTerminalProgress(
  stream: WritableTerminal | null | undefined,
  options: ProgressOptions,
): TerminalProgress {
  const environment = options.environment || process.env;
  const presentation = terminalPresentation(stream, options.color, environment);
  const enabled = options.enabled
    && presentation.interactive
    && environment.WHOISLEUTH_NO_PROGRESS !== '1';
  const now = options.now || Date.now;
  let startedAt = 0;
  let frame = 0;
  let message = '';
  let timer: NodeJS.Timeout | null = null;

  function render(): void {
    if (!enabled || !stream) return;
    const elapsedSeconds = Math.max(0, Math.floor((now() - startedAt) / 1000));
    const marker = tone(PROGRESS_FRAMES[frame % PROGRESS_FRAMES.length] || '·', 'accent', presentation.color);
    const elapsed = tone(`${elapsedSeconds}s`, 'dim', presentation.color);
    stream.write(`\r\u001b[2K${marker} ${message} · ${elapsed}`);
    frame += 1;
  }

  function start(nextMessage: string): void {
    if (!enabled || timer) return;
    startedAt = now();
    message = safeProgressMessage(nextMessage);
    render();
    timer = setInterval(render, 250);
    timer.unref?.();
  }

  function update(nextMessage: string): void {
    if (!enabled) return;
    message = safeProgressMessage(nextMessage);
    render();
  }

  function stop(): void {
    if (!enabled || !stream) return;
    if (timer) clearInterval(timer);
    timer = null;
    stream.write('\r\u001b[2K');
  }

  return Object.freeze({ enabled, start, update, stop });
}

export {
  createTerminalProgress,
  safeProgressMessage,
};
export type { ProgressOptions, TerminalProgress };
