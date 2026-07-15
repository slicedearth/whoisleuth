// Shared validation for abuse.ch Auth-Keys. The credential is accepted from a
// provider-neutral variable first while retaining the original URLhaus name
// for compatible deployments. Callers must send it only to a fixed abuse.ch
// HTTPS endpoint and must never include it in returned configuration data.

type EnvironmentInput = Record<string, unknown>;

const MAX_ABUSECH_AUTH_KEY_LENGTH = 256;

function normalizeAbusechAuthKey(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length < 8
    || value.length > MAX_ABUSECH_AUTH_KEY_LENGTH
    || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  return value;
}

function abusechAuthKey(env: EnvironmentInput | null | undefined = process.env): string | null {
  const source = env && typeof env === 'object' ? env : {};
  return normalizeAbusechAuthKey(source.ABUSECH_AUTH_KEY)
    || normalizeAbusechAuthKey(source.URLHAUS_AUTH_KEY);
}

export {
  MAX_ABUSECH_AUTH_KEY_LENGTH,
  normalizeAbusechAuthKey,
  abusechAuthKey,
};
export type { EnvironmentInput };
