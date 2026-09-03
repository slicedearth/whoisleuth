// Pure Monitor route, workflow and browser-local collection ownership.

import { parseDomainInput } from '../analysis/utils.ts';

type MonitorView =
  | 'inbox'
  | 'timeline'
  | 'watchlists'
  | 'cases'
  | 'campaigns'
  | 'relationships'
  | 'rules'
  | 'certificates';
type MonitorFocus = Readonly<{
  parameter: 'case' | 'watchlist' | 'campaign' | 'observation';
  value: string;
}>;
type MonitorCollection =
  | 'analyst-review-state'
  | 'bulk-sessions'
  | 'campaigns'
  | 'cases'
  | 'profiles'
  | 'relationships'
  | 'rules'
  | 'watchlists'
  | 'website-snapshots';
type MonitorRouteTarget =
  | Readonly<{ kind: 'case'; id: string; responseHash: boolean }>
  | Readonly<{ kind: 'watchlist'; name: string }>
  | Readonly<{ kind: 'investigation'; domain: string; restoreQueue: boolean }>
  | Readonly<{ kind: 'domain'; domain: string }>
  | Readonly<{ kind: 'none' }>;

const MONITOR_VIEWS = Object.freeze([
  'inbox',
  'timeline',
  'watchlists',
  'cases',
  'campaigns',
  'relationships',
  'rules',
  'certificates',
] as const satisfies readonly MonitorView[]);
const MONITOR_VIEW_SET = new Set<MonitorView>(MONITOR_VIEWS);
const RESPOND_VIEWS = new Set<MonitorView>([
  'inbox',
  'cases',
  'campaigns',
  'relationships',
]);
const MONITOR_VIEW_COLLECTIONS = Object.freeze({
  inbox: Object.freeze([
    'cases',
    'watchlists',
    'bulk-sessions',
    'analyst-review-state',
    'profiles',
    'rules',
    'website-snapshots',
  ]),
  timeline: Object.freeze([
    'cases',
    'watchlists',
    'bulk-sessions',
    'relationships',
    'website-snapshots',
  ]),
  watchlists: Object.freeze(['watchlists']),
  cases: Object.freeze(['cases', 'profiles']),
  certificates: Object.freeze(['cases', 'profiles', 'analyst-review-state']),
  campaigns: Object.freeze(['campaigns', 'cases', 'profiles', 'relationships']),
  relationships: Object.freeze([
    'cases',
    'campaigns',
    'relationships',
    'website-snapshots',
  ]),
  rules: Object.freeze(['rules', 'cases']),
} satisfies Record<MonitorView, readonly MonitorCollection[]>);

function monitorViewFromUrl(url: URL): MonitorView {
  if (url.searchParams.has('case')) return 'cases';
  const requested = url.searchParams.get('view');
  return requested && MONITOR_VIEW_SET.has(requested as MonitorView)
    ? requested as MonitorView
    : 'inbox';
}

function monitorWorkflowForView(view: MonitorView) {
  return RESPOND_VIEWS.has(view)
    ? Object.freeze({
        eyebrow: 'Respond',
        description: 'Review retained evidence, organise cases and prepare responses.',
      })
    : Object.freeze({
        eyebrow: 'Assure',
        description: 'Review monitoring history, watchlists and local control rules.',
      });
}

function monitorRouteKey(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildMonitorNavigationUrl(
  current: URL,
  next: MonitorView,
  focus?: MonitorFocus,
): string {
  const url = new URL(current);
  url.searchParams.set('view', next);
  for (const parameter of ['case', 'watchlist', 'campaign', 'observation']) {
    url.searchParams.delete(parameter);
  }
  if (!focus) {
    for (const parameter of ['investigation', 'domain', 'response']) {
      url.searchParams.delete(parameter);
    }
  } else {
    url.searchParams.set(focus.parameter, focus.value);
  }
  url.hash = '';
  return `${url.pathname}${url.search}`;
}

function monitorRouteTarget(url: URL): MonitorRouteTarget {
  const caseId = url.searchParams.get('case');
  if (caseId) {
    return Object.freeze({
      kind: 'case',
      id: caseId,
      responseHash: url.hash === `#case-response-${encodeURIComponent(caseId)}`,
    });
  }
  const watchlist = url.searchParams.get('watchlist');
  if (watchlist) return Object.freeze({ kind: 'watchlist', name: watchlist });
  const domain = parseDomainInput(url.searchParams.get('domain') || '').entries[0] || '';
  if (url.searchParams.get('investigation') === '1') {
    return Object.freeze({
      kind: 'investigation',
      domain,
      restoreQueue: url.hash === '#case-review-queue',
    });
  }
  if (domain) return Object.freeze({ kind: 'domain', domain });
  return Object.freeze({ kind: 'none' });
}

function monitorViewCollections(view: MonitorView): readonly MonitorCollection[] {
  return MONITOR_VIEW_COLLECTIONS[view];
}

function appendUnavailableCollectionStatus(
  current: string,
  label: string,
): string {
  const prefix = 'Some browser-local context could not be loaded (';
  const closingIndex = current.indexOf(').');
  const labels = current.startsWith(prefix) && closingIndex > prefix.length
    ? current.slice(prefix.length, closingIndex).split(', ').filter(Boolean)
    : [];
  if (!labels.includes(label)) labels.push(label);
  return `Some browser-local context could not be loaded (${labels.join(', ')}). Successfully loaded collections remain available; reload to retry the missing context.`;
}

function createMonitorCollectionLoader() {
  const loads = new Map<MonitorCollection, Promise<void>>();
  return Object.freeze({
    load(key: MonitorCollection, work: () => Promise<void>): Promise<void> {
      const existing = loads.get(key);
      if (existing) return existing;
      const pending = work();
      loads.set(key, pending);
      return pending;
    },
  });
}

export {
  MONITOR_VIEWS,
  appendUnavailableCollectionStatus,
  buildMonitorNavigationUrl,
  createMonitorCollectionLoader,
  monitorRouteKey,
  monitorRouteTarget,
  monitorViewCollections,
  monitorViewFromUrl,
  monitorWorkflowForView,
};
export type {
  MonitorCollection,
  MonitorFocus,
  MonitorRouteTarget,
  MonitorView,
};
