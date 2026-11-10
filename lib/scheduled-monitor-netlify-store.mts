// Keep scheduled-monitor storage on its existing encrypted envelope bound.
import { MAX_ENVELOPE_BYTES } from './scheduled-monitor-crypto.mts';
import { createNetlifyBlobTextStore, type NetlifyBlobStore } from './netlify-versioned-text-store.mts';

export function createNetlifyBlobVersionedTextStore(store: NetlifyBlobStore) {
  return createNetlifyBlobTextStore(store, MAX_ENVELOPE_BYTES);
}

export { MAX_BLOB_KEY_BYTES } from './netlify-versioned-text-store.mts';
export type { NetlifyBlobStore } from './netlify-versioned-text-store.mts';
