import { exact, text } from '../evidence/artifact-structure.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { readEvidenceImageDimensions } from '../evidence/image-regions.mts';

export type CaptureConditions = Readonly<{
  browser: string; browserVersion: string; viewport: Readonly<{ width: number; height: number }>;
  deviceScaleFactor: number; locale: string; timezone: string; colourScheme: 'light' | 'dark';
}>;
export type ObservationContext = Readonly<{
  observedAt: string | null; observerLabel: string | null; vantageLabel: string | null;
  conditions?: CaptureConditions | null;
}>;

/** Optional declarations remain unknown for existing manifests; no inference from image dimensions. */
export function readCaptureConditions(raw: unknown): CaptureConditions | null {
  if (raw === undefined || raw === null) return null;
  const value = exact(raw, ['browser', 'browserVersion', 'viewport', 'deviceScaleFactor', 'locale', 'timezone', 'colourScheme'], 'Capture conditions');
  const viewport = exact(value.viewport, ['width', 'height'], 'Capture viewport');
  const dimensions = readEvidenceImageDimensions(viewport.width, viewport.height);
  if (typeof value.deviceScaleFactor !== 'number' || !Number.isFinite(value.deviceScaleFactor)
    || value.deviceScaleFactor < 0.25 || value.deviceScaleFactor > 8) throw new TypeError('Capture scale must be between 0.25 and 8.');
  if (value.colourScheme !== 'light' && value.colourScheme !== 'dark') throw new TypeError('Capture colour scheme is unsupported.');
  return Object.freeze({ browser: text(value.browser, 'Capture browser', 40), browserVersion: text(value.browserVersion, 'Capture browser version', 80),
    viewport: dimensions, deviceScaleFactor: value.deviceScaleFactor,
    locale: text(value.locale, 'Capture locale', 80), timezone: text(value.timezone, 'Capture timezone', 80), colourScheme: value.colourScheme });
}

export function readObservationLabel(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  return text(raw, 'Observation label', 80);
}

export function compareObservationContexts(input: readonly ObservationContext[]) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 20) throw new TypeError('Compare between 2 and 20 observation contexts.');
  const observations = input.map(value => {
    const observedAt = value.observedAt === null ? null : normalizeExplicitIsoTimestamp(value.observedAt);
    if (value.observedAt !== null && !observedAt) throw new TypeError('Observation time must include an explicit timezone.');
    return { observedAt, observerLabel: readObservationLabel(value.observerLabel), vantageLabel: readObservationLabel(value.vantageLabel), conditions: readCaptureConditions(value.conditions) };
  });
  const timestamps = observations.map(value => value.observedAt === null ? null : Date.parse(value.observedAt));
  const knownTimes = timestamps.filter((value): value is number => value !== null);
  const row = (id: string, label: string, values: readonly (string | null)[]) => ({ id, label, values,
    state: values.some(value => value === null) ? 'unknown' as const : new Set(values).size === 1 ? 'same' as const : 'different' as const });
  const conditions = observations.map(value => value.conditions);
  const rows = [
    row('observer', 'Declared observer', observations.map(value => value.observerLabel)),
    row('vantage', 'Declared vantage', observations.map(value => value.vantageLabel)),
    row('browser', 'Declared browser', conditions.map(value => value ? `${value.browser} ${value.browserVersion}` : null)),
    row('viewport', 'Declared viewport', conditions.map(value => value ? `${value.viewport.width} × ${value.viewport.height}` : null)),
    row('scale', 'Declared scale', conditions.map(value => value ? String(value.deviceScaleFactor) : null)),
    row('locale', 'Declared locale', conditions.map(value => value?.locale ?? null)),
    row('timezone', 'Declared timezone', conditions.map(value => value?.timezone ?? null)),
    row('colour', 'Declared colour scheme', conditions.map(value => value?.colourScheme ?? null)),
  ];
  const labelPairs = observations.map(value => value.observerLabel && value.vantageLabel ? JSON.stringify([value.observerLabel, value.vantageLabel]) : null);
  return {
    observations, rows, time: { state: knownTimes.length !== observations.length ? 'unknown' as const : new Set(knownTimes).size === 1 ? 'same_instant' as const : 'different_instants' as const,
      spanMilliseconds: knownTimes.length === observations.length ? Math.max(...knownTimes) - Math.min(...knownTimes) : null },
    labels: labelPairs.some(value => value === null) ? 'incomplete' as const : new Set(labelPairs).size === labelPairs.length ? 'distinct' as const : 'repeated' as const,
    independence: 'not_verified' as const,
    limitations: [
      'Observer, vantage and capture conditions are declarations, not verified network location or independent collection.',
      'Different capture times, browser versions, viewports, scale, locale and shared upstream caches can explain differences. Equal declarations do not establish identical environments.',
      'These selected observations do not establish worldwide availability, removal or takedown.',
    ],
  };
}
