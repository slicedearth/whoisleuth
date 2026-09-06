// Input conversion only; validation and mutation policy remain with the domain.
export function isoFromLocal(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function list(value: string): string[] {
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}
