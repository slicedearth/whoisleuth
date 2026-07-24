import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';

export const MAX_LIFECYCLE_EVENTS = 8;
export const MAX_REDIRECT_NODES = 9;
export const MAX_TRIAGE_PLOT_POINTS = 300;
export const WATCHLIST_ACTIVITY_DAYS = 28;

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

export function projectLifecycleEvents(rawEvents: LifecycleEventInput[]) {
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
    labelY: laneY[index % laneY.length],
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
  const nodes = [
    { id: 'redirect-start', label: redirects[0].from, status: 'start', queryOmitted: false },
    ...redirects.map((redirect, index) => ({
      id: `redirect-${index + 1}`,
      label: redirect.to,
      status: redirect.status,
      queryOmitted: redirect.queryOmitted,
    })),
  ];
  const x = scalePoint<string>().domain(nodes.map((node) => node.id)).range([62, 838]).padding(0.35);
  const projected = nodes.map((node) => ({ ...node, x: x(node.id) ?? 450, y: 70 }));
  const edges = redirects.map((redirect, index) => ({
    id: `redirect-edge-${index}`,
    fromX: projected[index].x,
    toX: projected[index + 1].x,
    y: 70,
    status: redirect.status,
  }));
  return {
    width: 900,
    height: 150,
    nodes: projected,
    edges,
    truncated: rawCount > redirects.length,
  };
}

function deterministicSample<T>(items: T[], limit: number) {
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (boundedLimit === 0) return [];
  if (items.length <= boundedLimit) return items;
  if (boundedLimit === 1) return [items[0]];
  return Array.from({ length: boundedLimit }, (_, index) => {
    const sourceIndex = Math.round(index * (items.length - 1) / (boundedLimit - 1));
    return items[sourceIndex];
  });
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
