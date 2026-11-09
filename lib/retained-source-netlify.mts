import { getStore } from '@netlify/blobs';
import { boundedNetlifyBlobFetch, createNetlifyBlobTextStore } from './netlify-versioned-text-store.mts';
import { MAX_EDITION_STATE_BYTES, RETAINED_SOURCE_STORE } from './retained-source-channel.mts';

export function retainedSourcesEnabled(context: { deploy?: { context?: unknown } } | undefined, enabled: unknown): boolean {
  return context?.deploy?.context === 'production' && enabled === '1';
}

export function openRetainedSourceStore(signal: AbortSignal) {
  return createNetlifyBlobTextStore(getStore(RETAINED_SOURCE_STORE, {
    fetch: boundedNetlifyBlobFetch(signal),
  }), MAX_EDITION_STATE_BYTES);
}
