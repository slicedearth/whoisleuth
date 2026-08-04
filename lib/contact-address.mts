const MAX_CONTACT_ADDRESS_LENGTH = 254;

function normalizeContactAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_CONTACT_ADDRESS_LENGTH) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || /[\u0000-\u0020\u007f]/u.test(normalized)) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(normalized)) {
    return null;
  }
  const [local = '', domain = ''] = normalized.split('@');
  if (!local || local.length > 64 || !domain || domain.length > 253 || !domain.includes('.')) return null;
  if (domain.split('.').some((label) => (
    !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
  ))) return null;
  return normalized;
}

export {
  MAX_CONTACT_ADDRESS_LENGTH,
  normalizeContactAddress,
};
