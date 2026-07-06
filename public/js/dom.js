// Shared DOM element references, imported by every feature module that
// needs to read/update the page. Single source of truth so no module has
// to re-query the DOM for an element another module already grabbed.

export const form = document.getElementById('lookup-form');
export const queryInput = document.getElementById('query-input');
export const submitBtn = document.getElementById('submit-btn');

export const rdapOutput = document.getElementById('rdap-output');
export const whoisOutput = document.getElementById('whois-output');
export const rdapBadge = document.getElementById('rdap-badge');
export const whoisBadge = document.getElementById('whois-badge');

export const availabilityCard = document.getElementById('availability-card');
export const availabilityDomain = document.getElementById('availability-domain');
export const availabilityPill = document.getElementById('availability-pill');
export const availabilityScores = document.getElementById('availability-scores');
export const availabilityDetail = document.getElementById('availability-detail');
export const availabilityConfidence = document.getElementById('availability-confidence');
export const availabilitySignals = document.getElementById('availability-signals');
export const availabilityOutreach = document.getElementById('availability-outreach');
export const availabilityAbuseReport = document.getElementById('availability-abuse-report');

export const bulkFileInput = document.getElementById('bulk-file');
export const bulkCancelBtn = document.getElementById('bulk-cancel-btn');
export const bulkDeepCheckBtn = document.getElementById('bulk-deep-check-btn');
export const bulkExportBtn = document.getElementById('bulk-export-btn');
export const bulkStatus = document.getElementById('bulk-status');
export const bulkProgressWrap = document.getElementById('bulk-progress-wrap');
export const bulkProgressFill = document.getElementById('bulk-progress-fill');
export const bulkProgressLabel = document.getElementById('bulk-progress-label');
export const bulkResultsWrap = document.getElementById('bulk-results-wrap');
export const bulkResultsBody = document.getElementById('bulk-results-body');
export const bulkSelectAll = document.getElementById('bulk-select-all');

// The query box these fill into sits ABOVE the generator panels on the
// page, not below - scroll/focus it too so "where did my list go" isn't a
// recurring question.
export function fillQueryInputWithCandidates(candidates) {
  queryInput.value = candidates.join('\n');
  queryInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  queryInput.focus();
}
