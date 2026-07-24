// Pure presentation projection for the Monitor relationship table. The source
// comparison remains case-relationships.js; this layer only applies bounded
// filtering, sorting, pagination, and per-row member caps for an accessible
// table.

import {
  buildCaseRelationships,
  filterInvestigationCaseRelationships,
} from './case-relationships.js';

export const CASE_RELATIONSHIP_TABLE_VERSION = 1;
export const MAX_RELATIONSHIP_TABLE_ROWS = 50;
export const MAX_RELATIONSHIP_TABLE_MEMBERS = 20;
export const MAX_RELATIONSHIP_TABLE_QUERY_LENGTH = 100;

const TYPES = new Set([
  'all',
  'nameserver_set',
  'http_final_origin',
  'ip_address',
  'certificate',
  'tracking_identifier',
  'favicon',
  'official_asset',
]);
const SORTS = new Set(['type', 'value', 'member_count']);
const DIRECTIONS = new Set(['asc', 'desc']);
const TYPE_ORDER = new Map([
  'nameserver_set',
  'http_final_origin',
  'ip_address',
  'certificate',
  'tracking_identifier',
  'favicon',
  'official_asset',
].map((value, index) => [value, index]));

function normalizeQuery(value) {
  return String(value == null ? '' : value)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RELATIONSHIP_TABLE_QUERY_LENGTH)
    .toLowerCase();
}

function normalizeOption(value, allowed, fallback) {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function normalizePage(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function searchable(group) {
  return [
    group.label,
    group.method,
    group.value,
    ...(Array.isArray(group.sources) ? group.sources : []),
    ...(Array.isArray(group.campaigns) ? group.campaigns.map((item) => item.label) : []),
    ...group.cases.map((item) => item.domain),
  ]
    .join('\u0000')
    .toLowerCase();
}

function compareRows(left, right, sort) {
  let result = 0;
  if (sort === 'value') result = left.value.localeCompare(right.value);
  else if (sort === 'member_count') result = left.caseCount - right.caseCount;
  else result = Number(TYPE_ORDER.get(left.type) ?? 99) - Number(TYPE_ORDER.get(right.type) ?? 99);
  return result
    || left.type.localeCompare(right.type)
    || left.value.localeCompare(right.value)
    || left.cases.map((item) => item.domain).join('|').localeCompare(right.cases.map((item) => item.domain).join('|'));
}

/**
 * @param {unknown} rawCases
 * @param {{type?:unknown,query?:unknown,sort?:unknown,direction?:unknown,source?:unknown,period?:unknown,completeness?:unknown,scope?:unknown,page?:unknown}} [rawOptions]
 */
export function buildCaseRelationshipTable(rawCases, rawOptions = {}) {
  return projectCaseRelationshipTable(buildCaseRelationships(rawCases), rawOptions);
}

/**
 * Applies bounded presentation options to an already-normalized relationship
 * summary. Components can derive the summary from case records once, then use
 * this inexpensive projection for interactive filtering and sorting.
 * @param {ReturnType<typeof buildCaseRelationships>} summary
 * @param {{type?:unknown,query?:unknown,sort?:unknown,direction?:unknown,source?:unknown,period?:unknown,completeness?:unknown,scope?:unknown,page?:unknown}} [rawOptions]
 */
export function projectCaseRelationshipTable(summary, rawOptions = {}) {
  const projectionBacked = summary?.state === 'ready';
  const provenanceFiltered = projectionBacked
    ? filterInvestigationCaseRelationships(summary, rawOptions)
    : null;
  const type = provenanceFiltered?.filters.type || normalizeOption(rawOptions.type, TYPES, 'all');
  const query = normalizeQuery(rawOptions.query);
  const sort = normalizeOption(rawOptions.sort, SORTS, 'type');
  const direction = normalizeOption(rawOptions.direction, DIRECTIONS, 'asc');
  const requestedPage = normalizePage(rawOptions.page);

  const sourceGroups = provenanceFiltered?.groups || summary.groups.filter((group) => type === 'all' || group.type === type);
  const filtered = sourceGroups.filter((group) => !query || searchable(group).includes(query));

  const sorted = [...filtered].map((group) => ({
    ...group,
    caseCount: group.cases.length,
  })).sort((left, right) => {
    const compared = compareRows(left, right, sort);
    return direction === 'desc' ? -compared : compared;
  });

  const pageCount = Math.max(1, Math.ceil(sorted.length / MAX_RELATIONSHIP_TABLE_ROWS));
  const currentPage = Math.min(requestedPage, pageCount);
  const pageStart = (currentPage - 1) * MAX_RELATIONSHIP_TABLE_ROWS;
  let truncated = summary.truncated;
  const rows = sorted.slice(pageStart, pageStart + MAX_RELATIONSHIP_TABLE_ROWS).map((row) => {
    const omittedCases = Math.max(0, row.cases.length - MAX_RELATIONSHIP_TABLE_MEMBERS);
    if (omittedCases) truncated = true;
    return {
      ...row,
      cases: row.cases.slice(0, MAX_RELATIONSHIP_TABLE_MEMBERS),
      omittedCases,
    };
  });

  return {
    version: CASE_RELATIONSHIP_TABLE_VERSION,
    rows,
    totalRelationships: provenanceFiltered?.totalRelationships ?? summary.groups.length,
    matchingRelationships: filtered.length,
    currentPage,
    pageCount,
    pageSize: MAX_RELATIONSHIP_TABLE_ROWS,
    rangeStart: rows.length ? pageStart + 1 : 0,
    rangeEnd: pageStart + rows.length,
    truncated,
    filters: {
      ...(provenanceFiltered?.filters || { type }),
      query,
      sort,
      direction,
    },
    state: summary?.state || 'legacy',
    sources: Array.isArray(summary?.sources) ? summary.sources : [],
    scopeOptions: Array.isArray(summary?.scopeOptions) ? summary.scopeOptions : [],
    filterOptionsTruncated: summary?.filterOptionsTruncated === true,
    limitations: summary.limitations,
  };
}
