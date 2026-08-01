import type { CliCommand } from './arguments.mts';
import type { WritableTerminal } from './terminal-presentation.mts';

export const CLI_PROGRESS_EVENT_SCHEMA = 'whoisleuth.cli.progress';
export const CLI_PROGRESS_EVENT_VERSION = 1;
export const MAX_CLI_PROGRESS_EVENTS = 2_100;
export const MAX_CLI_PROGRESS_EVENT_DETAIL_LENGTH = 120;

type ProgressEventFields = Readonly<{
  event: 'cancelled' | 'completed' | 'failed' | 'item_settled' | 'source_settled' | 'started' | 'warning';
  source?: unknown;
  state?: unknown;
  reason?: unknown;
  index?: unknown;
  ok?: unknown;
  exitCode?: unknown;
}>;

type CliProgressEvents = Readonly<{
  enabled: boolean;
  emit(fields: ProgressEventFields): void;
}>;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\x00-\x1f\x7f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_CLI_PROGRESS_EVENT_DETAIL_LENGTH);
  return normalized || null;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function createCliProgressEvents(
  stream: WritableTerminal | null | undefined,
  options: Readonly<{
    command: CliCommand;
    enabled: boolean;
    now?: () => string;
  }>,
): CliProgressEvents {
  const enabled = options.enabled === true && Boolean(stream);
  const now = options.now || (() => new Date().toISOString());
  let sequence = 0;
  return Object.freeze({
    enabled,
    emit(fields: ProgressEventFields): void {
      if (!enabled || !stream || sequence >= MAX_CLI_PROGRESS_EVENTS) return;
      const source = text(fields.source);
      const state = text(fields.state);
      const reason = text(fields.reason);
      const index = integer(fields.index, 0, 10_000);
      const exitCode = integer(fields.exitCode, 0, 255);
      const document = {
        schema: CLI_PROGRESS_EVENT_SCHEMA,
        version: CLI_PROGRESS_EVENT_VERSION,
        sequence,
        generatedAt: now(),
        command: options.command,
        event: fields.event,
        ...(source ? { source } : {}),
        ...(state ? { state } : {}),
        ...(reason ? { reason } : {}),
        ...(index !== null ? { index } : {}),
        ...(typeof fields.ok === 'boolean' ? { ok: fields.ok } : {}),
        ...(exitCode !== null ? { exitCode } : {}),
      };
      stream.write(`${JSON.stringify(document)}\n`);
      sequence += 1;
    },
  });
}

export { createCliProgressEvents };
export type { CliProgressEvents, ProgressEventFields };
