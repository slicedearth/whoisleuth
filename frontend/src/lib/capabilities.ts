export type CapabilityStatus = 'supported' | 'disabled' | 'unavailable' | 'local_only';
export type Capability = {
  id: string;
  status: CapabilityStatus;
  execution: string;
  scanModes: Array<'fast' | 'deep'>;
  reason: string | null;
};
export type ConcurrencyClass = { id: string; sessionLimit: number; runtimeLimit: number };
export type ConcurrencyControls = {
  mode: 'in_memory';
  scope: string;
  distributed: false;
  classes: ConcurrencyClass[];
};
export type CapabilityReport = {
  version: 1;
  runtime: 'express' | 'netlify' | 'unknown';
  authoritative: true;
  features: Capability[];
  controls: { concurrency: ConcurrencyControls } | null;
  limitations: string[];
};

const statuses = new Set<CapabilityStatus>(['supported', 'disabled', 'unavailable', 'local_only']);
const modes = new Set(['fast', 'deep']);
const bounded = (value: unknown, max: number) => typeof value === 'string'
  ? value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max)
  : '';
const boundedLimit = (value: unknown) => typeof value === 'number'
  && Number.isSafeInteger(value)
  && value > 0
  && value <= 1000
  ? value
  : null;

function normalizeConcurrency(raw: unknown): ConcurrencyControls | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.mode !== 'in_memory' || value.distributed !== false || !Array.isArray(value.classes)) return null;

  const classes: ConcurrencyClass[] = [];
  const seen = new Set<string>();
  for (const item of value.classes.slice(0, 20)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = bounded(record.id, 50);
    const sessionLimit = boundedLimit(record.sessionLimit);
    const runtimeLimit = boundedLimit(record.runtimeLimit);
    if (!id
      || !/^[a-z0-9_]+$/.test(id)
      || seen.has(id)
      || sessionLimit === null
      || runtimeLimit === null
      || runtimeLimit < sessionLimit) continue;
    seen.add(id);
    classes.push({ id, sessionLimit, runtimeLimit });
  }
  return classes.length
    ? {
        mode: 'in_memory',
        scope: bounded(value.scope, 40) || 'runtime_instance',
        distributed: false,
        classes,
      }
    : null;
}

export function normalizeCapabilities(raw: unknown): CapabilityReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || value.authoritative !== true || !Array.isArray(value.features)) return null;
  const runtime = ['express', 'netlify'].includes(String(value.runtime))
    ? value.runtime as 'express' | 'netlify'
    : 'unknown';
  const seen = new Set<string>();
  const features: Capability[] = [];
  for (const item of value.features.slice(0, 50)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = bounded(record.id, 50);
    const status = record.status as CapabilityStatus;
    if (!id || !/^[a-z0-9_]+$/.test(id) || seen.has(id) || !statuses.has(status)) continue;
    seen.add(id);
    features.push({
      id,
      status,
      execution: bounded(record.execution, 30) || 'unknown',
      scanModes: Array.isArray(record.scanModes)
        ? [...new Set(record.scanModes.filter((mode): mode is 'fast' | 'deep' => typeof mode === 'string' && modes.has(mode)))].slice(0, 2)
        : [],
      reason: bounded(record.reason, 240) || null,
    });
  }
  const concurrency = normalizeConcurrency(
    value.controls && typeof value.controls === 'object' && !Array.isArray(value.controls)
      ? (value.controls as Record<string, unknown>).concurrency
      : null,
  );
  return {
    version: 1,
    runtime,
    authoritative: true,
    features,
    controls: concurrency ? { concurrency } : null,
    limitations: Array.isArray(value.limitations)
      ? value.limitations.map((item) => bounded(item, 300)).filter(Boolean).slice(0, 10)
      : [],
  };
}

export async function fetchCapabilities(fetcher: typeof fetch = fetch): Promise<CapabilityReport | null> {
  try {
    const response = await fetcher('/api/capabilities');
    if (!response.ok) return null;
    return normalizeCapabilities(await response.json());
  } catch {
    return null;
  }
}

export function featureCapability(report: CapabilityReport | null, id: string): Capability | null {
  return report?.features.find((feature) => feature.id === id) || null;
}
