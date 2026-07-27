type ErrorRecord = Readonly<Record<string, unknown>>;

function errorRecord(value: unknown): ErrorRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ErrorRecord
    : null;
}

function nonEmptyErrorMessage(value: unknown, fallback: string): string {
  const message = errorRecord(value)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export { nonEmptyErrorMessage };
