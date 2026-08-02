import { scaleLinear, scalePoint } from 'd3-scale';
import {
  boundedVisualizationId as boundedId,
  boundedVisualizationNumber as boundedNumber,
  boundedVisualizationText as boundedText,
  validVisualizationDate as validDate,
} from './visualization-bounds.ts';

export const MAX_LIFECYCLE_EVENTS = 8;
export const MAX_COLLECTION_TIMING_SOURCES = 16;
export const MAX_TREND_POINTS = 24;

type LifecycleKind = 'registry' | 'certificate' | 'observation';

export type LifecycleEventInput = {
  id: string;
  label: string;
  date: string | null | undefined;
  detail?: string;
  kind?: LifecycleKind;
};

export type CollectionTimingInput = {
  source: string;
  durationMs: number;
  completedAfterMs: number;
  outcome: string;
};

export type TrendPointInput = {
  id: string;
  date: string;
  total: number;
  added: number;
  partial?: boolean;
};

export function projectLifecycleEvents(rawEvents: readonly LifecycleEventInput[]) {
  const seen = new Set<string>();
  const candidates = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((event) => {
      const id = boundedId(event?.id);
      const label = boundedText(event?.label, 40);
      const date = validDate(event?.date);
      if (!id || !label || !date) return null;
      const kind: LifecycleKind = event.kind === 'certificate' || event.kind === 'observation'
        ? event.kind
        : 'registry';
      return {
        id,
        label,
        date: date.text,
        milliseconds: date.milliseconds,
        detail: boundedText(event.detail, 100),
        kind,
      };
    })
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .sort((a, b) => a.milliseconds - b.milliseconds || a.id.localeCompare(b.id))
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  const accepted = candidates.slice(0, MAX_LIFECYCLE_EVENTS);
  const x = scalePoint<string>()
    .domain(accepted.map((event) => event.id))
    .range([70, 830])
    .padding(accepted.length > 1 ? 0.35 : 0.5);
  const laneY = [48, 158, 27];
  const events = accepted.map((event, index) => ({
    ...event,
    x: x(event.id) ?? 450,
    labelY: laneY[index % laneY.length] ?? 102,
    anchor: index === 0 ? 'start' : index === accepted.length - 1 ? 'end' : 'middle',
  }));
  return {
    width: 900,
    height: 205,
    axisY: 102,
    events,
    truncated: candidates.length > accepted.length,
  };
}

export function projectCollectionTiming(
  rawSources: readonly CollectionTimingInput[],
  rawTotalMs: number,
) {
  const candidates = (Array.isArray(rawSources) ? rawSources : [])
    .map((source, index) => {
      const id = boundedId(source?.source) || `source-${index}`;
      const durationMs = boundedNumber(source?.durationMs, 0, 300_000);
      const completedAfterMs = boundedNumber(source?.completedAfterMs, 0, 300_000);
      return {
        id,
        label: boundedText(source?.source, 48) || `Source ${index + 1}`,
        outcome: boundedText(source?.outcome, 24).toLowerCase() || 'unknown',
        durationMs,
        completedAfterMs,
        startedAfterMs: Math.max(0, completedAfterMs - durationMs),
      };
    })
    .sort((a, b) => a.completedAfterMs - b.completedAfterMs || a.id.localeCompare(b.id));
  const sources = candidates.slice(0, MAX_COLLECTION_TIMING_SOURCES);
  const longestSource = [...sources]
    .sort((a, b) => b.durationMs - a.durationMs
      || b.completedAfterMs - a.completedAfterMs
      || a.id.localeCompare(b.id))[0] ?? null;
  const lastSettledSource = sources.at(-1) ?? null;
  const requestErrorCount = sources.filter((source) => source.outcome === 'rejected').length;
  const totalMs = Math.max(
    1,
    boundedNumber(rawTotalMs, 0, 300_000),
    ...sources.map((source) => source.completedAfterMs),
  );
  const x = scaleLinear().domain([0, totalMs]).range([190, 860]).clamp(true);
  const rowHeight = 30;
  return {
    width: 900,
    height: Math.max(92, 50 + sources.length * rowHeight),
    totalMs,
    longestSource,
    lastSettledSource,
    requestErrorCount,
    ticks: x.ticks(5).map((value) => ({ value, x: x(value) })),
    sources: sources.map((source, index) => ({
      ...source,
      x: x(source.startedAfterMs),
      width: Math.max(3, x(source.completedAfterMs) - x(source.startedAfterMs)),
      y: 30 + index * rowHeight,
    })),
    truncated: candidates.length > sources.length,
  };
}

export function projectTrendPoints(rawPoints: readonly TrendPointInput[]) {
  const seen = new Set<string>();
  const candidates = (Array.isArray(rawPoints) ? rawPoints : [])
    .map((point, index) => {
      const date = validDate(point?.date);
      const id = boundedId(point?.id) || `point-${index}`;
      if (!date || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        date: date.text,
        milliseconds: date.milliseconds,
        total: Math.trunc(boundedNumber(point?.total, 0, 100_000)),
        added: Math.trunc(boundedNumber(point?.added, 0, 100_000)),
        partial: Boolean(point?.partial),
      };
    })
    .filter((point): point is NonNullable<typeof point> => Boolean(point))
    .sort((a, b) => a.milliseconds - b.milliseconds || a.id.localeCompare(b.id));
  const points = candidates.slice(-MAX_TREND_POINTS);
  const x = scalePoint<string>().domain(points.map((point) => point.id)).range([64, 850]).padding(0.45);
  const maximum = Math.max(1, ...points.map((point) => point.total));
  const y = scaleLinear().domain([0, maximum]).range([190, 24]).nice().clamp(true);
  const first = points[0] ?? null;
  const latest = points.at(-1) ?? null;
  return {
    width: 900,
    height: 225,
    maximum,
    ticks: y.ticks(4).map((value) => ({ value, y: y(value) })),
    points: points.map((point) => ({
      ...point,
      x: x(point.id) ?? 450,
      y: y(point.total),
      addedY: y(point.added),
    })),
    summary: {
      firstTotal: first?.total ?? 0,
      latestTotal: latest?.total ?? 0,
      peakTotal: points.reduce((peak, point) => Math.max(peak, point.total), 0),
      newlyObserved: points.reduce((total, point) => total + point.added, 0),
      partialChecks: points.filter((point) => point.partial).length,
    },
    truncated: candidates.length > points.length,
  };
}
