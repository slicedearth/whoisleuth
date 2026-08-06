const MAX_CLI_ERROR_MESSAGE_LENGTH = 300;

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
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CLI_ERROR_MESSAGE_LENGTH) || fallback;
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
};
