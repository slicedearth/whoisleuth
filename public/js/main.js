// Entry point: wires the example chips, Enter-to-submit, and the main form
// submit handler that decides single-lookup vs. bulk mode. Also imports the
// feature modules that only need to run their own top-level wiring
// (generators.js) rather than export anything main.js calls directly.

import { form, queryInput, panels, bulkProgressWrap } from './dom.js';
import { parseDomainsFromText, typeText } from './utils.js';
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

// query-input is a textarea (so pasting/uploading a multi-domain list
// works) - Enter alone still submits like a single-line search box;
// Shift+Enter inserts a newline for manually typing more than one query.
queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

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
