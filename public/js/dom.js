// Shared DOM element references, imported by every feature module that
// needs to read/update the page. Single source of truth so no module has
// to re-query the DOM for an element another module already grabbed.
//
// Each is cast to its specific element type (not the generic
// `HTMLElement | null` getElementById() returns) since these IDs are all
// hand-written into index.html and guaranteed to exist - this is the one
// place that assumption gets made, so every other module gets a properly
// typed, non-null reference for free.

import { setCandidateProvenance } from './candidate-provenance.js';

export const form = /** @type {HTMLFormElement} */ (document.getElementById('lookup-form'));
export const queryInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('query-input'));
export const submitBtn = /** @type {HTMLButtonElement} */ (document.getElementById('submit-btn'));

export const panels = /** @type {HTMLElement} */ (document.querySelector('.panels'));
export const summaryOutput = /** @type {HTMLElement} */ (document.getElementById('summary-output'));
export const rdapOutput = /** @type {HTMLElement} */ (document.getElementById('rdap-output'));
export const whoisOutput = /** @type {HTMLElement} */ (document.getElementById('whois-output'));
export const rdapBadge = /** @type {HTMLElement} */ (document.getElementById('rdap-badge'));
export const whoisBadge = /** @type {HTMLElement} */ (document.getElementById('whois-badge'));

export const tabSummary = /** @type {HTMLButtonElement} */ (document.getElementById('tab-summary'));
export const tabRdap = /** @type {HTMLButtonElement} */ (document.getElementById('tab-rdap'));
export const tabWhois = /** @type {HTMLButtonElement} */ (document.getElementById('tab-whois'));
export const panelSummary = /** @type {HTMLElement} */ (document.getElementById('panel-summary'));
export const panelRdap = /** @type {HTMLElement} */ (document.getElementById('panel-rdap'));
export const panelWhois = /** @type {HTMLElement} */ (document.getElementById('panel-whois'));

export const availabilityCard = /** @type {HTMLElement} */ (document.getElementById('availability-card'));
export const availabilityPrompt = /** @type {HTMLElement} */ (document.getElementById('availability-prompt'));
export const availabilityDomain = /** @type {HTMLElement} */ (document.getElementById('availability-domain'));
export const availabilityPill = /** @type {HTMLElement} */ (document.getElementById('availability-pill'));
export const availabilityScores = /** @type {HTMLElement} */ (document.getElementById('availability-scores'));
export const availabilityDetail = /** @type {HTMLElement} */ (document.getElementById('availability-detail'));
export const availabilityConfidence = /** @type {HTMLElement} */ (document.getElementById('availability-confidence'));
export const availabilitySignals = /** @type {HTMLElement} */ (document.getElementById('availability-signals'));
export const availabilityOutreach = /** @type {HTMLElement} */ (document.getElementById('availability-outreach'));
export const availabilityAbuseReport = /** @type {HTMLElement} */ (document.getElementById('availability-abuse-report'));

export const bulkFileInput = /** @type {HTMLInputElement} */ (document.getElementById('bulk-file'));
export const bulkCancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById('bulk-cancel-btn'));
export const bulkDeepCheckBtn = /** @type {HTMLButtonElement} */ (document.getElementById('bulk-deep-check-btn'));
export const bulkExportBtn = /** @type {HTMLButtonElement} */ (document.getElementById('bulk-export-btn'));
export const bulkDensityBtn = /** @type {HTMLButtonElement} */ (document.getElementById('bulk-density-btn'));
export const bulkStatus = /** @type {HTMLElement} */ (document.getElementById('bulk-status'));
export const bulkProgressWrap = /** @type {HTMLElement} */ (document.getElementById('bulk-progress-wrap'));
export const bulkProgressTrack = /** @type {HTMLElement} */ (document.getElementById('bulk-progress-track'));
export const bulkProgressFill = /** @type {HTMLElement} */ (document.getElementById('bulk-progress-fill'));
export const bulkProgressLabel = /** @type {HTMLElement} */ (document.getElementById('bulk-progress-label'));
export const bulkTriage = /** @type {HTMLElement} */ (document.getElementById('bulk-triage'));
export const bulkTriageSummary = /** @type {HTMLElement} */ (document.getElementById('bulk-triage-summary'));
export const bulkTriageStateButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-bulk-state]'));
export const bulkTriageSignalButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-bulk-signal]'));
export const bulkTriageMutation = /** @type {HTMLSelectElement} */ (document.getElementById('bulk-triage-mutation'));
export const bulkTriageClear = /** @type {HTMLButtonElement} */ (document.getElementById('bulk-triage-clear'));
export const bulkResultsWrap = /** @type {HTMLElement} */ (document.getElementById('bulk-results-wrap'));
export const bulkResultsBody = /** @type {HTMLElement} */ (document.getElementById('bulk-results-body'));
export const bulkSelectAll = /** @type {HTMLInputElement} */ (document.getElementById('bulk-select-all'));

export const clusterPanel = /** @type {HTMLElement} */ (document.getElementById('cluster-panel'));
export const clusterList = /** @type {HTMLElement} */ (document.getElementById('cluster-list'));
export const coveragePanel = /** @type {HTMLElement} */ (document.getElementById('coverage-panel'));
export const coverageSummary = /** @type {HTMLElement} */ (document.getElementById('coverage-summary'));
export const coverageMutationBody = /** @type {HTMLElement} */ (document.getElementById('coverage-mutation-body'));
export const coverageTldBody = /** @type {HTMLElement} */ (document.getElementById('coverage-tld-body'));
export const coverageExportBtn = /** @type {HTMLButtonElement} */ (document.getElementById('coverage-export-btn'));

// The query box these fill into sits ABOVE the generator panels on the
// page, not below - scroll/focus it too so "where did my list go" isn't a
// recurring question.
/**
 * @param {string[]} candidates
 * @param {Array<{ domain: string, source?: string | null, sourceDomain?: string | null, tld?: string | null, candidateTld?: string | null, mutationTypes?: string[] }>} [provenance]
 */
export function fillQueryInputWithCandidates(candidates, provenance = []) {
  setCandidateProvenance(provenance);
  queryInput.value = candidates.join('\n');
  queryInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  queryInput.focus();
}
