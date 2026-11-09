export type VersionedTextStore = {
  read: (key: string, options?: { signal?: AbortSignal }) => Promise<{ value: string | null; version: string | null }>;
  compareAndSet: (key: string, expectedVersion: string | null, nextValue: string, options?: { signal?: AbortSignal }) => Promise<boolean>;
};
