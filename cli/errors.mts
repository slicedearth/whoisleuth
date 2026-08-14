const MAX_CLI_ERROR_MESSAGE_LENGTH = 300;
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
  hasUnsafeCliText,
};
