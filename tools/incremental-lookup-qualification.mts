#!/usr/bin/env node

// Deterministic qualification suite for the portable progress client. Core
// Express and Netlify adapters remain explicitly disabled until the same
// checks pass through their real staging proxies.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  qualifyLookupProgressResponse,
} from '../lib/lookup-progress-qualification.mts';
import {
  createLookupProgressFinal,
  createLookupProgressSource,
  createLookupProgressStart,
  encodeLookupProgressEvent,
} from '../lib/lookup-progress.mts';

type WritableLike = { write(value: string): unknown };

export const INCREMENTAL_LOOKUP_QUALIFICATION_SCHEMA = 'whoisleuth.incremental-lookup-qualification';
export const INCREMENTAL_LOOKUP_QUALIFICATION_VERSION = 1;

const SOURCES = ['rdap', 'whois'] as const;
const FINAL = Object.freeze({
  schema: 'fixture.lookup',
  version: 1,
  diagnostics: {
    rdap: { status: 'success' },
    whois: { status: 'partial' },
  },
});

function lines() {
  return [
    encodeLookupProgressEvent(createLookupProgressStart('deep', SOURCES)),
    encodeLookupProgressEvent(createLookupProgressSource(
      1,
      'rdap',
      'success',
      { state: 'success' },
      { complete: true },
    )),
    encodeLookupProgressEvent(createLookupProgressSource(
      2,
      'whois',
      'partial',
      { state: 'partial' },
      { truncated: true },
    )),
    encodeLookupProgressEvent(createLookupProgressFinal(3, SOURCES, FINAL)),
  ];
}

function steppedClock(stepMs: number): () => number {
  let current = 0;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

function responseFromChunks(
  chunks: readonly string[],
  options: Readonly<{
    stallAfter?: number;
    onCancel?: () => void;
    headers?: Readonly<Record<string, string>>;
  }> = {},
): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.stallAfter !== undefined && index >= options.stallAfter) return;
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else {
        controller.enqueue(encoder.encode(chunk));
      }
    },
    cancel() {
      options.onCancel?.();
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...options.headers,
    },
  });
}

async function rejected(operation: () => Promise<unknown>, pattern: RegExp): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch (error) {
    return pattern.test(error instanceof Error ? error.message : String(error));
  }
}

export async function buildIncrementalLookupQualificationReport() {
  const eventLines = lines();
  const normal = await qualifyLookupProgressResponse(
    responseFromChunks(eventLines),
    {
      expectedFinal: FINAL,
      timeoutMs: 1000,
      readDelayMs: 1,
      maximumFirstEventMs: 100,
      minimumEventSpanMs: 10,
      now: steppedClock(5),
      sleep: async () => {},
    },
  );
  const buffered = await qualifyLookupProgressResponse(
    responseFromChunks([eventLines.join('')]),
    {
      expectedFinal: FINAL,
      timeoutMs: 1000,
      maximumFirstEventMs: 100,
      minimumEventSpanMs: 10,
      now: () => 0,
    },
  );
  const authenticationExpiry = await rejected(
    () => qualifyLookupProgressResponse(
      new Response('', { status: 401 }),
      { expectedFinal: FINAL, timeoutMs: 1000 },
    ),
    /authentication expiry/iu,
  );
  const duplicateLines = [
    eventLines[0] as string,
    eventLines[1] as string,
    encodeLookupProgressEvent(createLookupProgressSource(2, 'rdap', 'success', {})),
  ];
  const duplicateEvents = await rejected(
    () => qualifyLookupProgressResponse(
      responseFromChunks(duplicateLines),
      { expectedFinal: FINAL, timeoutMs: 1000 },
    ),
    /duplicate, unplanned, or out of order/iu,
  );
  let timeoutCancelled = false;
  const timeout = await rejected(
    () => qualifyLookupProgressResponse(
      responseFromChunks([eventLines[0] as string], {
        stallAfter: 1,
        onCancel: () => { timeoutCancelled = true; },
      }),
      { expectedFinal: FINAL, timeoutMs: 10 },
    ),
    /timed out/iu,
  );
  let abortCancelled = false;
  const abortController = new AbortController();
  const abortPromise = qualifyLookupProgressResponse(
    responseFromChunks([eventLines[0] as string], {
      stallAfter: 1,
      onCancel: () => { abortCancelled = true; },
    }),
    { expectedFinal: FINAL, timeoutMs: 1000, signal: abortController.signal },
  );
  abortController.abort();
  const abortPropagation = await rejected(() => abortPromise, /aborted/iu);
  const finalEnvelopeEquivalence = await rejected(
    () => qualifyLookupProgressResponse(
      responseFromChunks(eventLines),
      { expectedFinal: { schema: 'fixture.lookup', version: 2 }, timeoutMs: 1000 },
    ),
    /ordinary response validator|not equivalent/iu,
  );
  const unsafeCaching = await rejected(
    () => qualifyLookupProgressResponse(
      new Response(eventLines.join(''), {
        status: 200,
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'public, max-age=60',
        },
      }),
      { expectedFinal: FINAL, timeoutMs: 1000 },
    ),
    /no-store/iu,
  );
  const compressedResponse = await rejected(
    () => qualifyLookupProgressResponse(
      responseFromChunks(eventLines, { headers: { 'content-encoding': 'gzip' } }),
      { expectedFinal: FINAL, timeoutMs: 1000 },
    ),
    /compressed responses/iu,
  );
  const mimeSniffing = await rejected(
    () => qualifyLookupProgressResponse(
      responseFromChunks(eventLines, { headers: { 'x-content-type-options': '' } }),
      { expectedFinal: FINAL, timeoutMs: 1000 },
    ),
    /nosniff/iu,
  );
  const fixedLengthResponse = await rejected(
    () => qualifyLookupProgressResponse(
      responseFromChunks(eventLines, { headers: { 'content-length': '1024' } }),
      { expectedFinal: FINAL, timeoutMs: 1000 },
    ),
    /fixed-length/iu,
  );
  const checks = Object.freeze({
    chunkedDeliveryObserved: normal.bufferingDetected === false && normal.chunks === eventLines.length,
    proxyBufferingDetected: buffered.bufferingDetected === true,
    slowConsumerCompleted: normal.slowConsumerDelayMs === 1 && normal.finalEquivalent,
    authenticationExpiry,
    duplicateEvents,
    timeout: timeout && timeoutCancelled,
    abortPropagation: abortPropagation && abortCancelled,
    finalEnvelopeEquivalence,
    unsafeCaching,
    compressedResponse,
    mimeSniffing,
    fixedLengthResponse,
  });
  return Object.freeze({
    schema: INCREMENTAL_LOOKUP_QUALIFICATION_SCHEMA,
    version: INCREMENTAL_LOOKUP_QUALIFICATION_VERSION,
    mode: 'offline_synthetic',
    ready: Object.values(checks).every(Boolean),
    productionReady: false,
    checks,
    adapters: Object.freeze([
      Object.freeze({ id: 'express', state: 'not_enabled', productionQualified: false }),
      Object.freeze({ id: 'netlify', state: 'not_enabled', productionQualified: false }),
    ]),
    productionGate: Object.freeze([
      'Run these checks through each real authenticated staging adapter and its production proxy or CDN.',
      'Reject an adapter if the first event is buffered until the final event, cancellation does not reach the collector, or the final envelope differs from ordinary Lookup.',
      'Require no-store, nosniff, uncompressed responses without a fixed content length and measure first-event latency plus an intentional server-side event gap rather than relying on Fetch chunk boundaries.',
      'Keep the ordinary non-streaming Lookup path as a fallback until desktop and mobile staging runs are clean.',
      'Verify fresh same-build Express and Netlify evidence with lookup:staging-evidence; a passing summary does not enable a route.',
    ]),
  });
}

export async function main(
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
  args: readonly string[] = process.argv.slice(2),
): Promise<number> {
  try {
    if (args.length === 1 && args[0] === '--help') {
      output.write('Usage: npm run lookup:transport-qualify\n');
      return 0;
    }
    if (args.length) throw new TypeError('lookup:transport-qualify does not accept arguments. Use --help for usage.');
    const report = await buildIncrementalLookupQualificationReport();
    output.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ready ? 0 : 1;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'Incremental Lookup qualification failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
