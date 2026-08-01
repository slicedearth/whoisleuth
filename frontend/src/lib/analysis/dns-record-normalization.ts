// Protocol-level DNS scalar normalization shared by transient response and
// browser-local persistence projections. Keep it independent of either model.

export function normalizeCaaCritical(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= 255 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d{1,3}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed <= 255 ? parsed : null;
}
