import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import {
  boundedVisualizationId as boundedId,
  boundedVisualizationNumber as boundedNumber,
  boundedVisualizationText as boundedText,
  validVisualizationDate as validDate,
} from './visualization-bounds.ts';

export {
  FORCE_GRAPH_LINK_KINDS,
  MAX_FORCE_GRAPH_LINKS,
  MAX_FORCE_GRAPH_NODES,
  projectBoundedForceGraph,
} from './visualization-force-graph.ts';
export type {
  ForceGraphLinkKind,
  ForceGraphLinkInput,
  ForceGraphNodeInput,
} from './visualization-force-graph.ts';
export {
  MAX_VISUAL_MATRIX_CELLS,
  MAX_VISUAL_MATRIX_COLUMNS,
  MAX_VISUAL_MATRIX_ROWS,
  projectEvidenceMatrix,
} from './visualization-matrix.ts';
export type {
  MatrixCellState,
  MatrixCellTone,
  MatrixInput,
} from './visualization-matrix.ts';
export {
  MAX_COLLECTION_TIMING_SOURCES,
  MAX_LIFECYCLE_EVENTS,
  MAX_TREND_POINTS,
  projectCollectionTiming,
  projectLifecycleEvents,
  projectTrendPoints,
} from './visualization-time-series.ts';
export type {
  CollectionTimingInput,
  LifecycleEventInput,
  TrendPointInput,
} from './visualization-time-series.ts';

export const MAX_REDIRECT_NODES = 9;
export const MAX_TRIAGE_PLOT_POINTS = 300;
export const WATCHLIST_ACTIVITY_DAYS = 28;
export const MAX_SCORE_FACTORS = 16;
export const MAX_COVERAGE_BAR_GROUPS = 18;
export const MAX_MONITOR_TIMELINE_EVENTS = 12;
export const MAX_MONITOR_TIMELINE_LANES = 6;

export type RedirectInput = {
  status: string;
  from: string;
  to: string;
  queryOmitted?: boolean;
};

export type TriagePointInput = {
  domain: string;
  risk: number | null;
  opportunity: number | null;
  availability?: string;
  trusted?: boolean;
};

export type WatchlistActivityInput = {
  checkedAt: string;
  changeCount: number;
  resultCount?: number;
  conclusiveCount?: number;
};

export type ScoreFactorInput = {
  label: string;
  delta: number;
};

export type CoverageBarInput = {
  id: string;
  label: string;
  protected: number;
  registered: number;
  available: number;
  unknown: number;
};

export type MonitorTimelineInput = {
  id: string;
  checkedAt: string;
  mode: string;
  groups: Array<{
    key: string;
    label: string;
    changeCount: number;
  }>;
};

export type CertificateValidityInput = {
  validFrom: string | null | undefined;
  validTo: string | null | undefined;
  observedAt?: string | null | undefined;
};

function boundedScore(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function redirectLabel(value: unknown) {
  const text = boundedText(value, 320);
  try {
    const parsed = new URL(text);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname}${path}`.slice(0, 72);
  } catch {
    return text.slice(0, 72);
  }
}

export function projectRedirectPath(rawRedirects: RedirectInput[]) {
  const redirects = (Array.isArray(rawRedirects) ? rawRedirects : [])
    .slice(0, MAX_REDIRECT_NODES - 1)
    .map((redirect) => ({
      status: boundedText(redirect?.status, 12) || '—',
      from: redirectLabel(redirect?.from),
      to: redirectLabel(redirect?.to),
      queryOmitted: Boolean(redirect?.queryOmitted),
    }))
    .filter((redirect) => redirect.from && redirect.to);
  const rawCount = Array.isArray(rawRedirects) ? rawRedirects.length : 0;
  if (!redirects.length) {
    return { width: 900, height: 150, nodes: [], edges: [], truncated: rawCount > 0 };
  }
  const firstRedirect = redirects[0];
  if (!firstRedirect) {
    return { width: 900, height: 150, nodes: [], edges: [], truncated: rawCount > 0 };
  }
  const nodes = [
    { id: 'redirect-start', label: firstRedirect.from, status: 'start', queryOmitted: false },
    ...redirects.map((redirect, index) => ({
      id: `redirect-${index + 1}`,
      label: redirect.to,
      status: redirect.status,
      queryOmitted: redirect.queryOmitted,
    })),
  ];
  const x = scalePoint<string>().domain(nodes.map((node) => node.id)).range([62, 838]).padding(0.35);
  const projected = nodes.map((node) => ({ ...node, x: x(node.id) ?? 450, y: 70 }));
  const edges = redirects.flatMap((redirect, index) => {
    const from = projected[index];
    const to = projected[index + 1];
    return from && to ? [{
      id: `redirect-edge-${index}`,
      fromX: from.x,
      toX: to.x,
      y: 70,
      status: redirect.status,
    }] : [];
  });
  return {
    width: 900,
    height: 150,
    nodes: projected,
    edges,
    truncated: rawCount > redirects.length,
  };
}

function deterministicSample<T>(items: T[], limit: number): T[] {
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (boundedLimit === 0) return [];
  if (items.length <= boundedLimit) return items;
  if (boundedLimit === 1) return items.slice(0, 1);
  return Array.from({ length: boundedLimit }, (_, index) => {
    const sourceIndex = Math.round(index * (items.length - 1) / (boundedLimit - 1));
    return items[sourceIndex];
  }).filter((item): item is T => item !== undefined);
}

export function projectTriagePoints(rawPoints: TriagePointInput[]) {
  const eligible = (Array.isArray(rawPoints) ? rawPoints : [])
    .map((point) => ({
      domain: boundedText(point?.domain, 253).toLowerCase(),
      risk: boundedScore(point?.risk),
      opportunity: boundedScore(point?.opportunity),
      availability: boundedText(point?.availability, 30).toLowerCase() || 'unknown',
      trusted: Boolean(point?.trusted),
    }))
    .filter((point) => point.domain && point.risk !== null && point.opportunity !== null)
    .sort((a, b) => a.domain.localeCompare(b.domain));
  const sampled = deterministicSample(eligible, MAX_TRIAGE_PLOT_POINTS);
  const quadrants = eligible.reduce((counts, point) => {
    if ((point.risk as number) >= 50) {
      if ((point.opportunity as number) >= 50) counts.priorityReview += 1;
      else counts.riskLedReview += 1;
    } else if ((point.opportunity as number) >= 50) {
      counts.availableReview += 1;
    } else {
      counts.lowerScores += 1;
    }
    return counts;
  }, {
    availableReview: 0,
    priorityReview: 0,
    lowerScores: 0,
    riskLedReview: 0,
  });
  const x = scaleLinear().domain([0, 100]).range([58, 842]).clamp(true);
  const y = scaleLinear().domain([0, 100]).range([308, 28]).clamp(true);
  const points = sampled.map((point) => ({
    ...point,
    risk: point.risk as number,
    opportunity: point.opportunity as number,
    x: x(point.risk as number),
    y: y(point.opportunity as number),
    tone: point.trusted
      ? 'trusted'
      : point.availability === 'available'
        ? 'available'
        : point.availability === 'error'
          ? 'error'
          : 'registered',
  }));
  return {
    width: 900,
    height: 360,
    points,
    eligibleCount: eligible.length,
    omittedCount: Math.max(0, (Array.isArray(rawPoints) ? rawPoints.length : 0) - eligible.length),
    sampled: eligible.length > sampled.length,
    quadrants,
  };
}

function utcDayKey(milliseconds: number) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function projectWatchlistActivity(rawEvents: WatchlistActivityInput[]) {
  const valid = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((event) => {
      const date = validDate(event?.checkedAt);
      if (!date) return null;
      const changeCount = Math.max(0, Math.min(10_000, Math.trunc(Number(event.changeCount) || 0)));
      const resultCount = Math.max(0, Math.min(10_000, Math.trunc(Number(event.resultCount) || 0)));
      const conclusiveCount = Math.max(0, Math.min(resultCount, Math.trunc(Number(event.conclusiveCount) || 0)));
      return { ...date, changeCount, resultCount, conclusiveCount };
    })
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  if (!valid.length) {
    return { width: 620, height: 190, days: [], maxChanges: 0, totalChecks: 0, totalChanges: 0 };
  }
  const latest = Math.max(...valid.map((event) => event.milliseconds));
  const latestDay = Date.UTC(
    new Date(latest).getUTCFullYear(),
    new Date(latest).getUTCMonth(),
    new Date(latest).getUTCDate(),
  );
  const start = latestDay - (WATCHLIST_ACTIVITY_DAYS - 1) * 86_400_000;
  const windowEnd = latestDay + 86_400_000;
  const windowEvents = valid.filter(
    (event) => event.milliseconds >= start && event.milliseconds < windowEnd,
  );
  const byDay = new Map<string, { checks: number; changes: number; results: number; conclusive: number }>();
  for (const event of windowEvents) {
    const key = utcDayKey(event.milliseconds);
    const current = byDay.get(key) ?? { checks: 0, changes: 0, results: 0, conclusive: 0 };
    current.checks += 1;
    current.changes += event.changeCount;
    current.results += event.resultCount;
    current.conclusive += event.conclusiveCount;
    byDay.set(key, current);
  }
  const weekScale = scaleBand<number>().domain([0, 1, 2, 3]).range([72, 580]).padding(0.12);
  const dayScale = scaleBand<number>().domain([0, 1, 2, 3, 4, 5, 6]).range([26, 165]).padding(0.12);
  const dayWidth = weekScale.bandwidth();
  const dayHeight = dayScale.bandwidth();
  const days = Array.from({ length: WATCHLIST_ACTIVITY_DAYS }, (_, index) => {
    const milliseconds = start + index * 86_400_000;
    const key = utcDayKey(milliseconds);
    const activity = byDay.get(key) ?? { checks: 0, changes: 0, results: 0, conclusive: 0 };
    return {
      date: key,
      label: new Date(milliseconds).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      week: Math.floor(index / 7),
      weekday: index % 7,
      x: weekScale(Math.floor(index / 7)) ?? 0,
      y: dayScale(index % 7) ?? 0,
      width: dayWidth,
      height: dayHeight,
      ...activity,
    };
  });
  return {
    width: 620,
    height: 190,
    days,
    maxChanges: Math.max(0, ...days.map((day) => day.changes)),
    totalChecks: windowEvents.length,
    totalChanges: windowEvents.reduce((sum, event) => sum + event.changeCount, 0),
  };
}

export function projectScoreFactors(rawFactors: readonly ScoreFactorInput[]) {
  const candidates = (Array.isArray(rawFactors) ? rawFactors : [])
    .map((factor, index) => ({
      id: `${boundedId(factor?.label) || 'factor'}-${index}`,
      label: boundedText(factor?.label, 56) || `Factor ${index + 1}`,
      delta: boundedNumber(factor?.delta, -100, 100),
    }));
  const factors = candidates.slice(0, MAX_SCORE_FACTORS);
  const maximum = Math.max(1, ...factors.map((factor) => Math.abs(factor.delta)));
  const x = scaleLinear().domain([-maximum, maximum]).range([220, 860]).clamp(true);
  const zeroX = x(0);
  const rowHeight = 28;
  return {
    width: 900,
    height: Math.max(74, 42 + factors.length * rowHeight),
    zeroX,
    maximum,
    factors: factors.map((factor, index) => {
      const valueX = x(factor.delta);
      return {
        ...factor,
        x: Math.min(zeroX, valueX),
        width: factor.delta === 0 ? 0 : Math.max(2, Math.abs(valueX - zeroX)),
        y: 24 + index * rowHeight,
      };
    }),
    truncated: candidates.length > factors.length,
  };
}

export function projectCoverageBars(rawGroups: readonly CoverageBarInput[]) {
  const candidates = (Array.isArray(rawGroups) ? rawGroups : [])
    .map((group, index) => {
      const values = {
        protected: Math.trunc(boundedNumber(group?.protected, 0, 100_000)),
        registered: Math.trunc(boundedNumber(group?.registered, 0, 100_000)),
        available: Math.trunc(boundedNumber(group?.available, 0, 100_000)),
        unknown: Math.trunc(boundedNumber(group?.unknown, 0, 100_000)),
      };
      return {
        id: boundedId(group?.id) || `group-${index}`,
        label: boundedText(group?.label, 56) || `Group ${index + 1}`,
        ...values,
        total: Object.values(values).reduce((sum, value) => sum + value, 0),
      };
    })
    .filter((group) => group.total > 0)
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const groups = candidates.slice(0, MAX_COVERAGE_BAR_GROUPS);
  const maximum = Math.max(1, ...groups.map((group) => group.total));
  const x = scaleLinear().domain([0, maximum]).range([210, 860]).clamp(true);
  const rowHeight = 31;
  return {
    width: 900,
    height: Math.max(76, 40 + groups.length * rowHeight),
    groups: groups.map((group, index) => {
      let offset = 0;
      const segments = (['protected', 'registered', 'available', 'unknown'] as const).map((state) => {
        const value = group[state];
        const start = offset;
        offset += value;
        return {
          state,
          value,
          x: x(start),
          width: Math.max(value ? 1 : 0, x(offset) - x(start)),
        };
      });
      return { ...group, y: 20 + index * rowHeight, segments };
    }),
    truncated: candidates.length > groups.length,
  };
}

export function projectMonitorTimeline(rawEvents: readonly MonitorTimelineInput[]) {
  const candidates = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((event, index) => {
      const date = validDate(event?.checkedAt);
      const id = boundedId(event?.id) || `event-${index}`;
      if (!date) return null;
      return {
        id,
        checkedAt: date.text,
        milliseconds: date.milliseconds,
        mode: boundedText(event?.mode, 20).toLowerCase() || 'saved',
        groups: ((Array.isArray(event.groups) ? event.groups : []) as MonitorTimelineInput['groups'])
          .map((group) => ({
            key: boundedId(group?.key),
            label: boundedText(group?.label, 40),
            changeCount: Math.trunc(boundedNumber(group?.changeCount, 0, 10_000)),
          }))
          .filter((group) => group.key && group.label),
      };
    })
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .sort((a, b) => a.milliseconds - b.milliseconds || a.id.localeCompare(b.id));
  const events = candidates.slice(-MAX_MONITOR_TIMELINE_EVENTS);
  const laneMap = new Map<string, string>();
  for (const event of events) {
    for (const group of event.groups) {
      if (!laneMap.has(group.key) && laneMap.size < MAX_MONITOR_TIMELINE_LANES) {
        laneMap.set(group.key, group.label);
      }
    }
  }
  const lanes = [...laneMap].map(([key, label]) => ({ key, label }));
  const x = scaleBand<string>().domain(events.map((event) => event.id)).range([170, 865]).padding(0.18);
  const y = scaleBand<string>().domain(lanes.map((lane) => lane.key)).range([42, 42 + lanes.length * 40]).padding(0.18);
  const maxChanges = Math.max(1, ...events.flatMap((event) => event.groups.map((group) => group.changeCount)));
  return {
    width: 900,
    height: Math.max(110, 64 + lanes.length * 40),
    maxChanges,
    events: events.map((event) => ({
      ...event,
      x: x(event.id) ?? 170,
      width: x.bandwidth(),
      cells: lanes.map((lane) => ({
        key: lane.key,
        label: lane.label,
        count: event.groups.find((group) => group.key === lane.key)?.changeCount ?? 0,
        y: y(lane.key) ?? 42,
        height: y.bandwidth(),
      })),
    })),
    lanes: lanes.map((lane) => ({ ...lane, y: y(lane.key) ?? 42, height: y.bandwidth() })),
    truncated: candidates.length > events.length
      || events.some((event) => event.groups.some((group) => !laneMap.has(group.key))),
  };
}

export function projectCertificateValidity(input: CertificateValidityInput) {
  const validFrom = validDate(input.validFrom);
  const validTo = validDate(input.validTo);
  const observed = validDate(input.observedAt);
  if (!validFrom || !validTo || validTo.milliseconds <= validFrom.milliseconds) {
    return { available: false as const, width: 900, height: 110 };
  }
  const observedMilliseconds = observed?.milliseconds ?? validFrom.milliseconds;
  const span = validTo.milliseconds - validFrom.milliseconds;
  const padding = Math.max(86_400_000, span * 0.08);
  const x = scaleLinear()
    .domain([validFrom.milliseconds - padding, validTo.milliseconds + padding])
    .range([72, 828])
    .clamp(true);
  return {
    available: true as const,
    width: 900,
    height: 110,
    validFrom: validFrom.text,
    validTo: validTo.text,
    observedAt: observed?.text ?? '',
    hasObservation: Boolean(observed),
    fromX: x(validFrom.milliseconds),
    toX: x(validTo.milliseconds),
    observedX: x(observedMilliseconds),
    observedWithinValidity: observedMilliseconds >= validFrom.milliseconds
      && observedMilliseconds <= validTo.milliseconds,
    elapsedPercent: Math.max(0, Math.min(100,
      ((observedMilliseconds - validFrom.milliseconds) / span) * 100)),
  };
}
