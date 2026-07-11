// Entry point: wires the example chips, Enter-to-submit, and the main form
// submit handler that decides single-lookup vs. bulk mode. Also imports the
// feature modules that only need to run their own top-level wiring
// (generators.js) rather than export anything main.js calls directly.

import { form, queryInput, inputSummary, queryClearBtn, clearQueryInput, submitBtn, panels, bulkProgressWrap } from './dom.js';
import { parseDomainInput, parseDomainsFromText, typeText } from './utils.js';
import { runSingleLookup, clearSingleResults } from './single-lookup.js';
import { clearBulkResults, runBulkLookup, MAX_FAST_BULK_DOMAINS } from './bulk.js';
import { bulkStatus } from './dom.js';
import './brand-profiles.js';
import './generators.js';
import './ct-search.js';
import './auth.js';
import './watchlist.js';

function scrollToLookupResults(resultEl) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  resultEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

// "Boot up" flavor on every page load - purely decorative and entirely
// non-blocking (the form underneath is interactive immediately regardless
// of whether this has finished), so it can never add friction to actually
// logging in or using the tool.
document.querySelectorAll('.term-chrome-label').forEach((labelEl) => {
  const text = labelEl.textContent || '';
  typeText(labelEl, text, { speed: 12 });
});

document.querySelectorAll('.chip').forEach((chipEl) => {
  const chip = /** @type {HTMLElement} */ (chipEl);
  chip.addEventListener('click', () => {
    queryInput.value = chip.dataset.example ?? '';
    form.requestSubmit();
  });
});

function updateInputSummary() {
  const { entries, duplicates } = parseDomainInput(queryInput.value);
  queryClearBtn.hidden = queryInput.value.length === 0;
  submitBtn.textContent = entries.length > 1 ? `Scan ${entries.length} domains` : 'Lookup';
  if (entries.length === 0) {
    inputSummary.textContent = 'Enter adds a new line. Press Ctrl/⌘+Enter or click Lookup to run.';
  } else if (entries.length === 1) {
    inputSummary.textContent = '1 entry detected. Enter adds a new line; Ctrl/⌘+Enter runs the lookup.';
  } else {
    const duplicateNote = duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? '' : 's'} removed` : '';
    inputSummary.textContent = `${entries.length} unique domains detected${duplicateNote} · Ctrl/⌘+Enter to scan.`;
  }
}

queryInput.addEventListener('input', updateInputSummary);
queryClearBtn.addEventListener('click', clearQueryInput);

// Enter behaves like a normal textarea and adds a domain on the next line.
// Ctrl/Command+Enter remains a fast keyboard route to submit the list.
queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    form.requestSubmit();
  }
});

updateInputSummary();

// Single form for both modes: the text box runs a full single-domain/IP/ASN
// lookup for exactly one entry, and a bulk run for more than one - however
// those entries got there (typed, pasted, generated, or loaded from a CSV).
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  bulkStatus.textContent = '';

  const entries = parseDomainsFromText(queryInput.value);

  if (entries.length === 0) {
    bulkStatus.innerHTML = '<span class="error-text">Enter a domain, IP, or ASN, or paste/upload a list for a bulk lookup.</span>';
    return;
  }

  if (entries.length === 1) {
    clearBulkResults();
    const lookup = runSingleLookup(entries[0]);
    scrollToLookupResults(panels);
    await lookup;
    return;
  }

  clearSingleResults();
  const truncated = entries.slice(0, MAX_FAST_BULK_DOMAINS);
  if (entries.length > MAX_FAST_BULK_DOMAINS) {
    bulkStatus.innerHTML = `<span class="error-text">Found ${entries.length} entries; only the first ${MAX_FAST_BULK_DOMAINS} will be scanned.</span>`;
  }

  const bulkLookup = runBulkLookup(truncated, { fast: true, append: false });
  scrollToLookupResults(bulkProgressWrap);
  void bulkLookup;
});
