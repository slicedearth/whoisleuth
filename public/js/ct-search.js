// Certificate Transparency search - queries crt.sh (via the shared
// lib/ct-search.js backend endpoint) for hostnames with a publicly-issued
// certificate matching a keyword, and drops the results into the query box
// for review, same "generate/load, review, then click Lookup" pattern as
// the keyword and typosquat generators.

import { escapeHtml } from './utils.js';
import { fillQueryInputWithCandidates } from './dom.js';
import { showGate } from './auth.js';

const runBtn = document.getElementById('ct-search-run-btn');
const statusEl = document.getElementById('ct-search-status');

runBtn.addEventListener('click', async () => {
  const keyword = document.getElementById('ct-search-keyword').value.trim();
  if (!keyword) {
    statusEl.innerHTML = '<span class="error-text">Enter a brand/keyword to search for.</span>';
    return;
  }

  runBtn.disabled = true;
  statusEl.textContent = 'Searching crt.sh…';
  try {
    const res = await fetch(`/api/ct-search?q=${encodeURIComponent(keyword)}`);
    if (res.status === 401) {
      showGate();
      return;
    }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Search failed (${res.status})`);

    if (body.domains.length === 0) {
      statusEl.textContent = `No certificates found containing "${keyword}".`;
      return;
    }

    fillQueryInputWithCandidates(body.domains);
    const truncNote = body.truncated ? ` (capped at ${body.domains.length})` : '';
    statusEl.textContent = `Found ${body.domains.length} unique hostname${body.domains.length === 1 ? '' : 's'} from ${body.certCount} certificate${body.certCount === 1 ? '' : 's'}${truncNote} - review, then click Lookup.`;
  } catch (err) {
    statusEl.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
  } finally {
    runBtn.disabled = false;
  }
});
