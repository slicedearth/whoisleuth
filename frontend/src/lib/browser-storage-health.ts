export type BrowserStorageHealth = Readonly<{ persisted: boolean | null; usage: number | null; quota: number | null; persistenceAvailable: boolean }>;
type StorageHealthSource = Partial<Pick<StorageManager, 'estimate' | 'persisted' | 'persist'>>;
const bytes = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export async function readBrowserStorageHealth(source: StorageHealthSource | undefined): Promise<BrowserStorageHealth> {
  const [persistence, estimate] = await Promise.allSettled([
    Promise.resolve().then(() => source?.persisted?.()), Promise.resolve().then(() => source?.estimate?.()),
  ]);
  const size = estimate.status === 'fulfilled' ? estimate.value : undefined;
  return {
    persisted: persistence.status === 'fulfilled' && typeof persistence.value === 'boolean' ? persistence.value : null,
    usage: bytes(size?.usage), quota: bytes(size?.quota), persistenceAvailable: typeof source?.persist === 'function',
  };
}

export async function requestBrowserPersistence(source: StorageHealthSource | undefined): Promise<boolean | null> {
  if (!source?.persist) return null;
  try { const result = await source.persist(); return typeof result === 'boolean' ? result : null; }
  catch { return null; }
}
