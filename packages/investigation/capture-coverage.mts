import { array, boolean, enumeration, exact, integer, text } from '../evidence/artifact-structure.mts';

export const MAX_CAPTURE_CHANNEL_OBSERVATIONS = 500;
export const CAPTURE_REQUEST_CHANNELS = ['navigation', 'document', 'frame', 'script', 'stylesheet', 'image', 'font', 'media', 'xhr', 'fetch', 'beacon', 'event_source', 'other'] as const;
export type CaptureRequestChannel = typeof CAPTURE_REQUEST_CHANNELS[number];
export const CAPTURE_DISABLED_SURFACES = ['service_workers', 'dedicated_workers', 'shared_workers', 'websockets', 'webrtc', 'webtransport', 'downloads'] as const;
export type CaptureRequestAttempt = Readonly<{
  position: number;
  channel: CaptureRequestChannel;
  method: 'read' | 'non_read' | 'unknown';
  origin: string | null;
  state: 'observed' | 'refused' | 'unavailable';
  reason: 'method' | 'request_bound' | 'host_bound' | 'response_bound' | 'shutdown' | 'address_or_transport' | null;
  collectionStarted: boolean;
}>;
export type CaptureCoverage = Readonly<{
  attempts: readonly CaptureRequestAttempt[];
  omittedAttempts: number;
  disabledSurfaces: readonly typeof CAPTURE_DISABLED_SURFACES[number][];
  interactions: 'not_exercised';
  websocketRefusals: number;
  directConnectionRefusals: number;
}>;

export function emptyCaptureCoverage(): CaptureCoverage {
  return { attempts: [], omittedAttempts: 0, disabledSurfaces: [...CAPTURE_DISABLED_SURFACES], interactions: 'not_exercised', websocketRefusals: 0, directConnectionRefusals: 0 };
}
export function captureCoverageIsPartial(value: CaptureCoverage): boolean {
  return Boolean(value.omittedAttempts || value.websocketRefusals || value.directConnectionRefusals || value.attempts.some(row => row.state !== 'observed'));
}
export function readCaptureCoverage(raw: unknown): CaptureCoverage {
  const value = exact(raw, ['attempts', 'omittedAttempts', 'disabledSurfaces', 'interactions', 'websocketRefusals', 'directConnectionRefusals'], 'Capture coverage');
  const disabledSurfaces = array(value.disabledSurfaces, 'Disabled capture surfaces', CAPTURE_DISABLED_SURFACES.length).map(value => enumeration(value, CAPTURE_DISABLED_SURFACES, 'Disabled capture surface'));
  if (new Set(disabledSurfaces).size !== CAPTURE_DISABLED_SURFACES.length) throw new TypeError('Capture coverage must identify every required disabled surface.');
  const attempts = array(value.attempts, 'Capture request attempts', MAX_CAPTURE_CHANNEL_OBSERVATIONS).map(raw => {
    const row = exact(raw, ['position', 'channel', 'method', 'origin', 'state', 'reason', 'collectionStarted'], 'Capture request attempt');
    const state = enumeration(row.state, ['observed', 'refused', 'unavailable'] as const, 'Capture request state');
    const method = enumeration(row.method, ['read', 'non_read', 'unknown'] as const, 'Capture method category');
    const reason = row.reason === null ? null : enumeration(row.reason, ['method', 'request_bound', 'host_bound', 'response_bound', 'shutdown', 'address_or_transport'] as const, 'Capture request qualification');
    boolean(row.collectionStarted, 'Collector-started flag');
    let origin: string | null = null;
    if (row.origin !== null) {
      const candidate = text(row.origin, 'Capture request origin', 500), parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== candidate || parsed.username || parsed.password) throw new TypeError('Capture request coverage retains origins only.');
      origin = candidate;
    }
    if (state === 'observed' && (reason !== null || method !== 'read' || !origin || row.collectionStarted !== true)
      || state !== 'observed' && reason === null
      || reason === 'method' && (method === 'read' || row.collectionStarted)
      || ['request_bound', 'host_bound', 'shutdown'].includes(reason ?? '') && row.collectionStarted
      || state === 'unavailable' && reason !== 'address_or_transport') throw new TypeError('Capture request coverage has contradictory collection states.');
    return { position: integer(row.position, 'Capture request position', 1, 1_000_000), channel: enumeration(row.channel, CAPTURE_REQUEST_CHANNELS, 'Capture request channel'),
      method, origin, state, reason, collectionStarted: row.collectionStarted as boolean };
  });
  if (attempts.some((row, index) => index > 0 && row.position <= attempts[index - 1]!.position)) throw new TypeError('Capture request positions must be unique and ordered.');
  return { attempts, omittedAttempts: integer(value.omittedAttempts, 'Omitted capture attempts', 0, 1_000_000), disabledSurfaces: [...CAPTURE_DISABLED_SURFACES],
    interactions: enumeration(value.interactions, ['not_exercised'] as const, 'Capture interaction coverage'),
    websocketRefusals: integer(value.websocketRefusals, 'WebSocket refusals', 0, 1_000_000), directConnectionRefusals: integer(value.directConnectionRefusals, 'Direct-connection refusals', 0, 1_000_000) };
}

export function captureAttemptDescription(value: CaptureRequestAttempt): string {
  const status = value.state === 'observed' ? 'Response supplied' : value.state === 'refused' ? 'Response refused' : 'Response unavailable';
  const reason = { method: 'non-read method', request_bound: 'request limit', host_bound: 'host limit', response_bound: 'response byte limit', shutdown: 'capture closing', address_or_transport: 'address or transport check' };
  return `${status}${value.reason ? ` · ${reason[value.reason]}` : ''} · collector ${value.collectionStarted ? 'started' : 'not started'}`;
}

/** Unseen in a bounded capture is not the same as disabled or absent. */
export function captureChannelSummary(value: CaptureCoverage) {
  return CAPTURE_REQUEST_CHANNELS.map(channel => {
    const rows = value.attempts.filter(row => row.channel === channel);
    return { channel, observed: rows.filter(row => row.state === 'observed').length, refused: rows.filter(row => row.state === 'refused').length,
      unavailable: rows.filter(row => row.state === 'unavailable').length,
      coverage: rows.length ? 'recorded' as const : value.omittedAttempts ? 'unknown' as const : 'not_observed' as const };
  });
}
