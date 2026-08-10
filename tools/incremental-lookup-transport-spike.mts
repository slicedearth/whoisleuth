#!/usr/bin/env node

// Offline architecture spike for the shared bounded NDJSON Lookup transport.
// It is intentionally not wired to a deployment adapter or the browser.
// Partial events remain presentation-only.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_LOOKUP_PROGRESS_EVENTS,
  MAX_LOOKUP_PROGRESS_FINAL_BYTES,
  MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES,
  MAX_LOOKUP_PROGRESS_SOURCES,
  MAX_LOOKUP_PROGRESS_STREAM_BYTES,
  createLookupProgressFinal,
  createLookupProgressNdjsonDecoder,
  createLookupProgressReducer,
  createLookupProgressSource,
  createLookupProgressStart,
  encodeLookupProgressEvent,
  type LookupProgressEvent,
  type LookupProgressSource,
} from '../lib/lookup-progress.mts';
import { optionalJsonRecord as record } from './maintainer-tool-helpers.mts';

type WritableLike = { write(value: string): unknown };

export const INCREMENTAL_LOOKUP_TRANSPORT_SPIKE_SCHEMA = 'whoisleuth.incremental-lookup-transport-spike';
export const INCREMENTAL_LOOKUP_TRANSPORT_SPIKE_VERSION = 1;
type SpikeMainOptions = Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;
type UnknownRecord = Record<string, unknown>;

export function buildIncrementalLookupTransportSpikeReport() {
  const planned: LookupProgressSource[] = ['rdap', 'whois'];
  const events: LookupProgressEvent[] = [
    createLookupProgressStart('deep', planned),
    createLookupProgressSource(1, 'rdap', 'success', {
      schema: 'fixture.rdap-fragment',
      version: 1,
      status: 'success',
    }, { complete: true }),
    createLookupProgressSource(2, 'whois', 'partial', {
      schema: 'fixture.whois-fragment',
      version: 1,
      status: 'partial',
    }, { complete: false, truncated: true }),
    createLookupProgressFinal(3, planned, {
      schema: 'fixture.lookup-result',
      version: 1,
      diagnostics: {
        rdap: { status: 'success' },
        whois: { status: 'partial' },
      },
    }),
  ];
  const reducer = createLookupProgressReducer({
    validateFinalResult(result, settledSources) {
      const value = record(result);
      return value?.schema === 'fixture.lookup-result'
        && value.version === 1
        && settledSources.length === planned.length;
    },
  });
  const encoded = events.map(encodeLookupProgressEvent).join('');
  const decoded: LookupProgressEvent[] = [];
  const stream = createLookupProgressNdjsonDecoder((event) => decoded.push(event));
  const bytes = new TextEncoder().encode(encoded);
  for (let offset = 0; offset < bytes.length; offset += 17) {
    stream.push(bytes.subarray(offset, Math.min(offset + 17, bytes.length)));
  }
  stream.finish();
  for (const event of decoded) reducer.apply(event);
  const final = reducer.finish();
  return Object.freeze({
    schema: INCREMENTAL_LOOKUP_TRANSPORT_SPIKE_SCHEMA,
    version: INCREMENTAL_LOOKUP_TRANSPORT_SPIKE_VERSION,
    mode: 'offline_synthetic',
    ready: record(final)?.schema === 'fixture.lookup-result',
    events: decoded.length,
    sources: planned.length,
    encodedBytes: bytes.byteLength,
    productionEnabled: false,
    bounds: Object.freeze({
      sourceLimit: MAX_LOOKUP_PROGRESS_SOURCES,
      eventLimit: MAX_LOOKUP_PROGRESS_EVENTS,
      fragmentBytes: MAX_LOOKUP_PROGRESS_FRAGMENT_BYTES,
      finalResultBytes: MAX_LOOKUP_PROGRESS_FINAL_BYTES,
      streamBytes: MAX_LOOKUP_PROGRESS_STREAM_BYTES,
    }),
    guarantees: Object.freeze([
      'Every source settles once with an explicit state; a missing or failed source is never interpreted as absence.',
      'Partial fragments are presentation-only and cannot produce a persistable result.',
      'The ordinary final Lookup result remains authoritative and must pass the existing response validator.',
      'Cancellation or transport interruption before the final event yields no persistable result.',
    ]),
    remainingGates: Object.freeze([
      'Prove the real collector graph in a reviewed remote-runtime adapter without enabling production traffic.',
      'Integrate source-specific fragment normalizers and the authenticated frontend transport.',
      'Complete authenticated desktop and mobile cancellation, timeout, and fallback tests before exposing a production endpoint.',
    ]),
  });
}

export function main(options: SpikeMainOptions = {}): number {
  try {
    const report = buildIncrementalLookupTransportSpikeReport();
    (options.stdout ?? process.stdout).write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ready ? 0 : 1;
  } catch (error) {
    (options.stderr ?? process.stderr).write(
      `${error instanceof Error ? error.message : 'Incremental Lookup transport spike failed.'}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

export type { SpikeMainOptions };
