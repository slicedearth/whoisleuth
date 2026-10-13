import {
  LOOKUP_SOURCE_IDS,
  LOOKUP_CHOICE_KEYS,
  LOOKUP_CHOICE_SOURCES,
  LOOKUP_SOURCE_STATES,
  LOOKUP_COLLECTION_RECEIPT_VERSION,
  lookupCollectionChoices,
  parseLookupCollectionReceipt,
  type LookupCollectionReceipt,
  type LookupCollectionSource,
  type LookupSourceId,
  type LookupSourceState,
} from '../packages/evidence/lookup-collection-receipt.mts';
import { plannedLookupSources } from './lookup-progress.mts';
import { normalizeLookupSourceSettlement } from './lookup-source-progress.mts';
import type { ClassifiedQuery } from './classify.mts';

/** Operation-local observer. It neither admits nor starts collection. */
export function createLookupCollectionReceiptTracker(
  classified: ClassifiedQuery,
  options: Readonly<{
    fast?: boolean; selectedUrl?: string; securityTxt?: boolean;
    externalIntelligence?: boolean; malwareHostIntelligence?: boolean; malwareIocIntelligence?: boolean;
  }>,
) {
  const requestedDepth = options.fast ? 'fast' : 'deep';
  const originalChoices = lookupCollectionChoices(options);
  const eligible = new Set(plannedLookupSources(classified.type, requestedDepth, originalChoices));
  const requested = new Set(eligible);
  for (const choice of LOOKUP_CHOICE_KEYS) if (originalChoices[choice]) requested.add(LOOKUP_CHOICE_SOURCES[choice]);
  const sources = new Map<LookupSourceId, LookupCollectionSource>(LOOKUP_SOURCE_IDS.map(source => [source, {
    source,
    intent: requested.has(source) ? 'requested' : 'not_requested',
    admission: eligible.has(source) ? 'unknown' : 'not_applicable',
    attempt: 'not_started', settlement: 'unknown', complete: null, truncated: null,
  }]));
  function admission(source: LookupSourceId, value: LookupCollectionSource['admission']) {
    const current = sources.get(source)!;
    if (current.attempt !== 'started') sources.set(source, { ...current, admission: value });
  }
  function started(source: LookupSourceId) {
    sources.set(source, { ...sources.get(source)!, admission: 'admitted', attempt: 'started' });
  }
  function settled(source: LookupSourceId, outcome: 'fulfilled' | 'rejected', value: unknown) {
    const current = sources.get(source)!;
    if (current.attempt !== 'started') return;
    const summary = normalizeLookupSourceSettlement(source, outcome, value,
      classified.type === 'domain' ? classified.registrableDomain ?? classified.value : undefined);
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    // Preserve final distinctions that the provisional progress vocabulary folds
    // into skipped. The current source's explicit quality still takes precedence.
    const status: LookupSourceState | null = typeof raw.status === 'string'
      && LOOKUP_SOURCE_STATES.includes(raw.status as LookupSourceState) ? raw.status as LookupSourceState : null;
    const settlement = outcome === 'fulfilled' && status && ['disabled', 'not_applicable', 'stale'].includes(status)
      ? status : summary.state;
    sources.set(source, { ...current, settlement,
      complete: value == null ? null : ['success', 'complete', 'not_found'].includes(settlement) && summary.complete && !summary.truncated,
      truncated: value == null || outcome === 'rejected' ? null : summary.truncated,
    });
  }
  function finish(): LookupCollectionReceipt {
    return parseLookupCollectionReceipt({
      version: LOOKUP_COLLECTION_RECEIPT_VERSION, requestedDepth, targetClass: classified.type,
      webSelection: classified.type !== 'domain' ? 'not_applicable' : options.selectedUrl ? 'selected_url' : 'hostname',
      originalChoices, sources: [...sources.values()],
    })!;
  }
  return Object.freeze({ admission, started, settled, finish });
}
