import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

export const MAX_LIFECYCLE_EVENTS = 8;
export const MAX_REDIRECT_NODES = 9;
export const MAX_TRIAGE_PLOT_POINTS = 300;
export const WATCHLIST_ACTIVITY_DAYS = 28;
export const MAX_COLLECTION_TIMING_SOURCES = 16;
export const MAX_SCORE_FACTORS = 16;
export const MAX_VISUAL_MATRIX_ROWS = 24;
export const MAX_VISUAL_MATRIX_COLUMNS = 6;
export const MAX_FORCE_GRAPH_NODES = 48;
export const MAX_FORCE_GRAPH_LINKS = 80;
export const MAX_COVERAGE_BAR_GROUPS = 18;
export const MAX_TREND_POINTS = 24;
export const MAX_MONITOR_TIMELINE_EVENTS = 12;
export const MAX_MONITOR_TIMELINE_LANES = 6;

type LifecycleKind = 'registry' | 'certificate' | 'observation';

export type LifecycleEventInput = {
  id: string;
  label: string;
  date: string | null | undefined;
  detail?: string;
  kind?: LifecycleKind;
};

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

export type CollectionTimingInput = {
  source: string;
  durationMs: number;
  completedAfterMs: number;
  outcome: string;
};

export type ScoreFactorInput = {
  label: string;
  delta: number;
};

export type MatrixCellState =
  | 'equal'
  | 'different'
  | 'conflict'
  | 'observed'
  | 'partial'
  | 'unavailable'
  | 'not_collected'
  | 'unknown';

export type MatrixInput = {
  id: string;
  label: string;
  cells: Array<{
    column: string;
    state: MatrixCellState | string;
    detail?: string;
  }>;
};

export type ForceGraphNodeInput = {
  id: string;
  label: string;
  kind: string;
  detail?: string;
  group?: string;
  groupLabel?: string;
};

export type ForceGraphLinkInput = {
  id: string;
  source: string;
  target: string;
  kind?: string;
  detail?: string;
};

export type CoverageBarInput = {
  id: string;
  label: string;
  protected: number;
  registered: number;
  available: number;
  unknown: number;
};

export type TrendPointInput = {
  id: string;
  date: string;
  total: number;
  added: number;
  partial?: boolean;
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

function boundedText(value: unknown, maxLength: number) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function boundedId(value: unknown) {
  return boundedText(value, 64)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function validDate(value: unknown) {
  const text = boundedText(value, 64);
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? { text: new Date(milliseconds).toISOString(), milliseconds } : null;
}

function boundedScore(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function normalizedMatrixState(value: unknown): MatrixCellState {
  const state = boundedText(value, 30).toLowerCase();
  if (state === 'equal' || state === 'equivalent' || state === 'same') return 'equal';
  if (state === 'different') return 'different';
  if (state === 'conflict' || state === 'conflicting') return 'conflict';
  if (state === 'observed' || state === 'complete' || state === 'success') return 'observed';
  if (state === 'partial' || state === 'inconclusive' || state === 'rate_limited' || state === 'missing') return 'partial';
  if (state === 'unavailable' || state === 'error' || state === 'failed') return 'unavailable';
  if (state === 'not_collected' || state === 'skipped' || state === 'disabled' || state === 'not_recorded') {
    return 'not_collected';
  }
  return 'unknown';
}

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

export function projectScoreFactors(rawFactors: readonly ScoreFactorInput[]) {
  const candidates = (Array.isArray(rawFactors) ? rawFactors : [])
    .map((factor, index) => ({
      id: `${boundedId(factor?.label) || 'factor'}-${index}`,
      label: boundedText(factor?.label, 56) || `Factor ${index + 1}`,
      delta: boundedNumber(factor?.delta, -100, 100),
    }))
    .filter((factor) => factor.delta !== 0);
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
        width: Math.max(2, Math.abs(valueX - zeroX)),
        y: 24 + index * rowHeight,
      };
    }),
    truncated: candidates.length > factors.length,
  };
}

export function projectEvidenceMatrix(
  rawColumns: readonly string[],
  rawRows: readonly MatrixInput[],
) {
  const columns = [...new Set((Array.isArray(rawColumns) ? rawColumns : [])
    .map((column) => boundedText(column, 40))
    .filter(Boolean))]
    .slice(0, MAX_VISUAL_MATRIX_COLUMNS);
  const columnSet = new Set(columns);
  const seenRows = new Set<string>();
  const candidates = (Array.isArray(rawRows) ? rawRows : [])
    .map((row, index) => {
      const id = boundedId(row?.id) || `row-${index}`;
      const label = boundedText(row?.label, 56);
      if (!label || seenRows.has(id)) return null;
      seenRows.add(id);
      const rowCells = (Array.isArray(row.cells) ? row.cells : []) as MatrixInput['cells'];
      const byColumn = new Map(rowCells
        .map((cell) => {
          const column = boundedText(cell?.column, 40);
          return [column, {
            state: normalizedMatrixState(cell?.state),
            detail: boundedText(cell?.detail, 120),
          }] as const;
        })
        .filter(([column]) => columnSet.has(column)));
      return {
        id,
        label,
        cells: columns.map((column) => ({
          column,
          state: byColumn.get(column)?.state ?? 'not_collected',
          detail: byColumn.get(column)?.detail ?? '',
        })),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const rows = candidates.slice(0, MAX_VISUAL_MATRIX_ROWS);
  const width = 900;
  const top = 54;
  const left = 210;
  const rowHeight = 30;
  const x = scaleBand<string>().domain(columns).range([left, 870]).padding(0.12);
  const y = scaleBand<string>().domain(rows.map((row) => row.id))
    .range([top, top + Math.max(1, rows.length) * rowHeight])
    .padding(0.12);
  return {
    width,
    height: Math.max(104, top + rows.length * rowHeight + 22),
    columns: columns.map((column) => ({
      label: column,
      x: x(column) ?? left,
      width: x.bandwidth(),
    })),
    rows: rows.map((row) => ({
      ...row,
      y: y(row.id) ?? top,
      height: y.bandwidth(),
      cells: row.cells.map((cell) => ({
        ...cell,
        x: x(cell.column) ?? left,
        width: x.bandwidth(),
      })),
    })),
    truncated: candidates.length > rows.length || rawColumns.length > columns.length,
  };
}

type ProjectedForceNode = SimulationNodeDatum & {
  id: string;
  label: string;
  labelLines: string[];
  labelWidth: number;
  kind: string;
  detail: string;
  group: string;
  groupLabel: string;
  clusterIndex: number;
  collisionRadius: number;
  x: number;
  y: number;
};

type ProjectedForceLink = SimulationLinkDatum<ProjectedForceNode> & {
  id: string;
  source: string | ProjectedForceNode;
  target: string | ProjectedForceNode;
  kind: string;
  detail: string;
};

const FORCE_GRAPH_GROUPS: Readonly<Record<string, Readonly<{ id: string; label: string }>>> = {
  address: { id: 'network', label: 'Network' },
  certificate: { id: 'certificate', label: 'Certificates' },
  domain: { id: 'hosts', label: 'Domains and hosts' },
  hostname: { id: 'hosts', label: 'Domains and hosts' },
  identity: { id: 'identity', label: 'Identity' },
  issuer: { id: 'certificate', label: 'Certificates' },
  key: { id: 'certificate', label: 'Certificates' },
  network: { id: 'network', label: 'Network' },
  observation: { id: 'observations', label: 'Source observations' },
  origin: { id: 'identity', label: 'Identity' },
  prefix: { id: 'network', label: 'Network' },
  registrar: { id: 'registration', label: 'Registration' },
  relationship: { id: 'relationships', label: 'Shared evidence' },
  service: { id: 'services', label: 'Services' },
  summary: { id: 'summary', label: 'Grouped evidence' },
  target: { id: 'focus', label: 'Lookup target' },
  technology: { id: 'technology', label: 'Technology' },
  tracker: { id: 'identity', label: 'Identity' },
};

function forceGraphGroup(kind: string, rawGroup: unknown, rawGroupLabel: unknown) {
  const requested = boundedId(rawGroup);
  const requestedLabel = boundedText(rawGroupLabel, 40);
  if (requested) {
    return {
      id: requested,
      label: requestedLabel || requested.replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase()),
    };
  }
  return FORCE_GRAPH_GROUPS[kind] ?? {
    id: kind || 'evidence',
    label: (kind || 'evidence').replaceAll('-', ' ').replace(/\b\w/gu, (character) => character.toUpperCase()),
  };
}

function wrapForceGraphLabel(value: string, maximumLineLength = 20): string[] {
  const lines: string[] = [];
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    const pieces: string[] = [];
    let remaining = word;
    while (remaining.length > maximumLineLength) {
      let splitAt = maximumLineLength;
      for (let index = maximumLineLength; index >= Math.floor(maximumLineLength * 0.55); index -= 1) {
        if (/[./:_-]/u.test(remaining[index - 1] ?? '')) {
          splitAt = index;
          break;
        }
      }
      pieces.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    if (remaining) pieces.push(remaining);
    for (const [pieceIndex, piece] of pieces.entries()) {
      const current = lines.at(-1);
      if (pieceIndex === 0 && current && current.length + piece.length + 1 <= maximumLineLength) {
        lines[lines.length - 1] = `${current} ${piece}`;
      } else {
        lines.push(piece);
      }
    }
  }
  return lines.length ? lines : [value];
}

function forceGraphClusterCenters(
  groups: readonly string[],
  width: number,
  height: number,
  hasFocus: boolean,
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const centers = new Map<string, { x: number; y: number }>();
  if (!groups.length) return centers;
  if (!hasFocus && groups.length === 1) {
    centers.set(groups[0] ?? '', { x: centerX, y: centerY });
    return centers;
  }
  if (!hasFocus && groups.length === 2) {
    centers.set(groups[0] ?? '', { x: width * 0.29, y: centerY });
    centers.set(groups[1] ?? '', { x: width * 0.71, y: centerY });
    return centers;
  }
  if (hasFocus && groups.length === 1) {
    centers.set(groups[0] ?? '', { x: width * 0.72, y: centerY });
    return centers;
  }
  if (hasFocus && groups.length === 2) {
    centers.set(groups[0] ?? '', { x: width * 0.25, y: centerY });
    centers.set(groups[1] ?? '', { x: width * 0.75, y: centerY });
    return centers;
  }
  const radiusX = hasFocus ? width * 0.33 : width * 0.27;
  const radiusY = hasFocus ? Math.max(150, height * 0.36) : Math.max(125, height * 0.3);
  for (const [index, group] of groups.entries()) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / groups.length;
    centers.set(group, {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  }
  return centers;
}

function forceGraphNodeBounds(node: ProjectedForceNode) {
  if (node.kind === 'target') {
    const halfWidth = (node.labelWidth + 20) / 2;
    const halfHeight = (node.labelLines.length * 13 + 17) / 2;
    return { halfWidth, above: halfHeight, below: halfHeight };
  }
  return {
    halfWidth: Math.max(20, node.labelWidth / 2),
    above: 22,
    below: 33 + node.labelLines.length * 13,
  };
}

function resolveForceGraphLabelCollisions(
  nodes: ProjectedForceNode[],
  width: number,
  height: number,
  focusNodeId: string | undefined,
) {
  const margin = 7;
  for (let iteration = 0; iteration < 120; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (!left) continue;
      const leftBounds = forceGraphNodeBounds(left);
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (!right) continue;
        const rightBounds = forceGraphNodeBounds(right);
        const overlapX = leftBounds.halfWidth + rightBounds.halfWidth + margin - Math.abs(left.x - right.x);
        const overlapY = Math.min(
          left.y + leftBounds.below,
          right.y + rightBounds.below,
        ) - Math.max(
          left.y - leftBounds.above,
          right.y - rightBounds.above,
        ) + margin;
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        const leftFixed = left.id === focusNodeId;
        const rightFixed = right.id === focusNodeId;
        if (overlapX / (leftBounds.halfWidth + rightBounds.halfWidth) < overlapY / Math.max(
          leftBounds.above + leftBounds.below,
          rightBounds.above + rightBounds.below,
        )) {
          const direction = left.x <= right.x ? -1 : 1;
          const shift = overlapX / (leftFixed || rightFixed ? 1 : 2) + 0.5;
          if (!leftFixed) left.x += direction * shift;
          if (!rightFixed) right.x -= direction * shift;
        } else {
          const direction = left.y <= right.y ? -1 : 1;
          const shift = overlapY / (leftFixed || rightFixed ? 1 : 2) + 0.5;
          if (!leftFixed) left.y += direction * shift;
          if (!rightFixed) right.y -= direction * shift;
        }
      }
    }
    for (const node of nodes) {
      const bounds = forceGraphNodeBounds(node);
      node.x = Math.max(bounds.halfWidth + margin, Math.min(width - bounds.halfWidth - margin, node.x));
      node.y = Math.max(bounds.above + margin, Math.min(height - bounds.below - margin, node.y));
    }
    if (!moved) break;
  }
}

export function projectBoundedForceGraph(
  rawNodes: readonly ForceGraphNodeInput[],
  rawLinks: readonly ForceGraphLinkInput[],
  options: Readonly<{ focusNodeId?: string }> = {},
) {
  const rawNodeCount = Array.isArray(rawNodes) ? rawNodes.length : 0;
  const rawLinkCount = Array.isArray(rawLinks) ? rawLinks.length : 0;
  const seen = new Set<string>();
  const candidates = (Array.isArray(rawNodes) ? rawNodes : [])
    .slice(0, MAX_FORCE_GRAPH_NODES * 2)
    .map((node, index) => {
      const id = boundedText(node?.id, 80);
      const label = boundedText(node?.label, 64);
      if (!id || !label || seen.has(id)) return null;
      seen.add(id);
      const kind = boundedId(node?.kind) || 'evidence';
      const group = forceGraphGroup(kind, node?.group, node?.groupLabel);
      const labelLines = wrapForceGraphLabel(label);
      const labelWidth = Math.max(54, Math.min(142, Math.max(...labelLines.map((line) => line.length)) * 6.2 + 16));
      return {
        id,
        label,
        labelLines,
        labelWidth,
        kind,
        detail: boundedText(node?.detail, 100),
        group: group.id,
        groupLabel: group.label,
        clusterIndex: 0,
        collisionRadius: Math.max(38, labelWidth / 2 + 8, 30 + labelLines.length * 6),
        x: 0,
        y: 0,
      } satisfies ProjectedForceNode;
    })
    .filter((node): node is ProjectedForceNode => Boolean(node))
    .sort((a, b) => a.id.localeCompare(b.id));
  const nodes = candidates.slice(0, MAX_FORCE_GRAPH_NODES);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenLinks = new Set<string>();
  const links = (Array.isArray(rawLinks) ? rawLinks : [])
    .slice(0, MAX_FORCE_GRAPH_LINKS * 2)
    .map((link, index) => ({
      id: boundedText(link?.id, 80) || `link-${index}`,
      source: boundedText(link?.source, 80),
      target: boundedText(link?.target, 80),
      kind: boundedId(link?.kind) || 'observed',
      detail: boundedText(link?.detail, 100),
    }))
    .filter((link) => {
      if (
        link.source === link.target
        || !nodeIds.has(link.source)
        || !nodeIds.has(link.target)
        || seenLinks.has(link.id)
      ) {
        return false;
      }
      seenLinks.add(link.id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_FORCE_GRAPH_LINKS) satisfies ProjectedForceLink[];

  const requestedFocusId = boundedText(options.focusNodeId, 80);
  const focusNode = nodes.find((node) => node.id === requestedFocusId)
    ?? nodes.find((node) => node.kind === 'target');
  const groupLabels = new Map<string, string>();
  for (const node of nodes) {
    if (node.id !== focusNode?.id && !groupLabels.has(node.group)) groupLabels.set(node.group, node.groupLabel);
  }
  const groupIds = [...groupLabels.keys()].sort((left, right) => {
    const leftLabel = groupLabels.get(left) ?? left;
    const rightLabel = groupLabels.get(right) ?? right;
    return leftLabel.localeCompare(rightLabel) || left.localeCompare(right);
  });
  const height = Math.max(500, Math.min(700, 450 + Math.max(0, nodes.length - 14) * 16));
  const width = 900;
  const centerX = width / 2;
  const centerY = height / 2;
  const clusterCenters = forceGraphClusterCenters(groupIds, width, height, Boolean(focusNode));
  const clusterIndex = new Map(groupIds.map((group, index) => [group, index % 8]));
  for (const node of nodes) node.clusterIndex = clusterIndex.get(node.group) ?? 0;

  if (nodes.length) {
    if (focusNode) {
      focusNode.fx = centerX;
      focusNode.fy = centerY;
    }
    const simulation = forceSimulation(nodes)
      .force('link', forceLink<ProjectedForceNode, ProjectedForceLink>(links)
        .id((node) => node.id)
        .distance((link) => link.kind === 'derived' ? 145 : 125)
        .strength(0.22))
      .force('charge', forceManyBody().strength(-330))
      .force('center', forceCenter(centerX, centerY))
      .force('cluster-x', forceX<ProjectedForceNode>((node) =>
        node.id === focusNode?.id ? centerX : clusterCenters.get(node.group)?.x ?? centerX).strength(0.3))
      .force('cluster-y', forceY<ProjectedForceNode>((node) =>
        node.id === focusNode?.id ? centerY : clusterCenters.get(node.group)?.y ?? centerY).strength(0.3))
      .force('collide', forceCollide<ProjectedForceNode>()
        .radius((node) => node.kind === 'target' ? Math.max(66, node.collisionRadius) : node.collisionRadius)
        .strength(1)
        .iterations(5))
      .stop();
    simulation.tick(360);
    for (const node of nodes) {
      const horizontalInset = Math.max(38, Math.min(82, node.collisionRadius));
      const topInset = node.kind === 'target' ? 28 : 34;
      const bottomInset = Math.max(52, 34 + node.labelLines.length * 13);
      node.x = Math.max(horizontalInset, Math.min(width - horizontalInset, Number(node.x) || centerX));
      node.y = Math.max(topInset, Math.min(height - bottomInset, Number(node.y) || centerY));
    }
    resolveForceGraphLabelCollisions(nodes, width, height, focusNode?.id);
  }

  const projectedLinks = links.flatMap((link) => {
    const source = typeof link.source === 'string' ? nodes.find((node) => node.id === link.source) : link.source;
    const target = typeof link.target === 'string' ? nodes.find((node) => node.id === link.target) : link.target;
    return source && target ? [{
      id: link.id,
      sourceId: source.id,
      targetId: target.id,
      sourceX: source.x,
      sourceY: source.y,
      targetX: target.x,
      targetY: target.y,
      kind: link.kind,
      detail: link.detail,
    }] : [];
  });
  return {
    width,
    height,
    nodes: nodes.map(({ id, label, labelLines, labelWidth, kind, detail, group, groupLabel, clusterIndex, x, y }) => ({
      id,
      label,
      labelLines,
      labelWidth,
      kind,
      detail,
      group,
      groupLabel,
      clusterIndex,
      x,
      y,
    })),
    links: projectedLinks,
    clusters: groupIds.map((group, index) => ({
      id: group,
      label: groupLabels.get(group) ?? group,
      count: nodes.filter((node) => node.id !== focusNode?.id && node.group === group).length,
      index: index % 8,
    })),
    truncated: rawNodeCount > candidates.length
      || candidates.length > nodes.length
      || rawLinkCount > links.length,
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
    truncated: candidates.length > points.length,
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
