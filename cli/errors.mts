import { stripVTControlCharacters } from 'node:util';
import type { WritableTerminal } from './terminal-presentation.mts';

const MAX_CLI_ERROR_MESSAGE_LENGTH = 300;
const MAX_CLI_DIAGNOSTIC_BYTES = 4_096;
const CLI_DEFAULT_IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/u;
const CLI_DEFAULT_IGNORABLE_GLOBAL_RE = /\p{Default_Ignorable_Code_Point}/gu;

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function errorMessage(error: unknown): unknown {
  if (error && typeof error === 'object' && 'message' in error) return error.message;
  return undefined;
}

function boundedCliErrorMessage(error: unknown, fallback = 'Unexpected command failure'): string {
  return String(errorMessage(error) || error || fallback)
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(CLI_DEFAULT_IGNORABLE_GLOBAL_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CLI_ERROR_MESSAGE_LENGTH) || fallback;
}

function hasUnsafeCliText(value: string): boolean {
  return /[\x00-\x1f\x7f-\x9f]/u.test(value) || CLI_DEFAULT_IGNORABLE_RE.test(value);
}

// A transient stderr preview, never a checkpoint field. Bound before collecting
// and redact request URLs and credential-shaped fields before shortening text.
function createCliDiagnosticOutput(): Readonly<{ stream: WritableTerminal; value(): string }> {
  const chunks: string[] = [];
  let remaining = MAX_CLI_DIAGNOSTIC_BYTES;
  return Object.freeze({
    stream: {
      isTTY: false,
      columns: 80,
      write(chunk: string) {
        if (remaining > 0 && chunk.length > 0) {
          const bytes = Buffer.from(chunk.slice(0, remaining), 'utf8').subarray(0, remaining);
          chunks.push(bytes.toString('utf8'));
          remaining -= bytes.byteLength;
        }
        return true;
      },
    },
    value() {
      const source = stripVTControlCharacters(chunks.join('')).replace(CLI_DEFAULT_IGNORABLE_GLOBAL_RE, '');
      if (!source.trim()) return '';
      const redacted = source
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']*/giu, '[URL omitted]')
        .replace(/\b(authorization|cookie|password|passphrase|token|secret|api[-_ ]?key)\s*[:=]\s*(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\r\n,;]*)/giu, '$1=[omitted]')
        .replace(/\b(?:bearer|basic)\s+[^\s,;]+/giu, '[credential omitted]');
      return boundedCliErrorMessage(redacted);
    },
  });
}

function boundedCliInputError(error: unknown, label: string): CliUsageError {
  if (error instanceof CliUsageError) return error;
  const safeLabel = label.replace(/[^A-Za-z0-9 ()_-]+/gu, '').trim().slice(0, 80) || 'Input';
  return new CliUsageError(`${safeLabel} could not be read as a bounded regular file.`);
}

export {
  CliUsageError,
  MAX_CLI_ERROR_MESSAGE_LENGTH,
  boundedCliErrorMessage,
  boundedCliInputError,
  createCliDiagnosticOutput,
  hasUnsafeCliText,
};
