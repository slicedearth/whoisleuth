// Domain name generator - brainstorms candidates from a seed keyword
// (prefix/suffix/plural variants x a TLD list) and drops them straight into
// the query box for a fast scan. A fixed, small modifier set rather than a
// configurable one - keeps this simple while covering the common patterns.
//
// Typosquat / brand-protection variant generator, modeled on dnstwist's
// permutation algorithms: character omission, duplication, adjacent-key
// substitution/insertion (QWERTY), adjacent transposition, vowel-swapping,
// bitsquatting (simulated single-bit memory/transmission errors), a
// phishing-relevant dictionary fuzzer, ASCII and real Unicode homoglyphs,
// and TLD-typo variants. Distinct generation strategy from the
// brainstorming generator above: this one is confusability-driven (finding
// cybersquatting/phishing targets), not idea-driven.

import { fillQueryInputWithCandidates } from './dom.js';
import { getActiveBrandProfile, isDomainAllowlisted } from './brand-profiles.js';
import { generateTyposquatCandidates } from './typosquat-generator.js';

function parseTldList(raw) {
  return [...new Set(
    raw
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean)
  )];
}

// ---------------------------------------------------------------------------
// Keyword generator
// ---------------------------------------------------------------------------

const GENERATOR_PREFIXES = ['get', 'my', 'the', 'try', 'use'];
const GENERATOR_SUFFIXES = ['hq', 'app', 'hub', 'online', 'site', 'now'];

function generateDomainCandidates(rawKeyword, tlds) {
  const words = rawKeyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || tlds.length === 0) return [];

  const concatenated = words.join('');
  const bases = new Set([concatenated]);
  if (words.length > 1) bases.add(words.join('-'));
  for (const p of GENERATOR_PREFIXES) bases.add(p + concatenated);
  for (const s of GENERATOR_SUFFIXES) bases.add(concatenated + s);
  if (concatenated.length > 3 && !concatenated.endsWith('s')) bases.add(concatenated + 's');

  const seen = new Set();
  const candidates = [];
  for (const base of bases) {
    for (const tld of tlds) {
      const domain = `${base}.${tld}`;
      if (seen.has(domain)) continue;
      seen.add(domain);
      candidates.push(domain);
    }
  }
  return candidates;
}

const generatorRunBtn = /** @type {HTMLButtonElement} */ (document.getElementById('generator-run-btn'));
const generatorKeywordInput = /** @type {HTMLInputElement} */ (document.getElementById('generator-keyword'));
const generatorTldsInput = /** @type {HTMLInputElement} */ (document.getElementById('generator-tlds'));
const generatorStatusEl = /** @type {HTMLElement} */ (document.getElementById('generator-status'));

generatorRunBtn.addEventListener('click', () => {
  const keyword = generatorKeywordInput.value;
  const tlds = parseTldList(generatorTldsInput.value);
  const statusEl = generatorStatusEl;
  const candidates = generateDomainCandidates(keyword, tlds);

  if (candidates.length === 0) {
    statusEl.innerHTML = '<span class="error-text">Enter a keyword and at least one TLD.</span>';
    return;
  }

  fillQueryInputWithCandidates(candidates);
  statusEl.textContent = `Generated ${candidates.length} candidates - scrolled to the query box above so you can review them, then click Lookup to scan.`;
});

// ---------------------------------------------------------------------------
// Typosquat generator
// ---------------------------------------------------------------------------

const typoRunBtn = /** @type {HTMLButtonElement} */ (document.getElementById('typo-run-btn'));
const typoKeywordInput = /** @type {HTMLInputElement} */ (document.getElementById('typo-keyword'));
const typoTldsInput = /** @type {HTMLInputElement} */ (document.getElementById('typo-tlds'));
const typoStatusEl = /** @type {HTMLElement} */ (document.getElementById('typo-status'));
const typoFillProfileBtn = /** @type {HTMLButtonElement} */ (document.getElementById('typo-fill-profile-btn'));

typoRunBtn.addEventListener('click', () => {
  const keyword = typoKeywordInput.value;
  const tlds = parseTldList(typoTldsInput.value);
  const statusEl = typoStatusEl;
  const rawCandidates = generateTyposquatCandidates(keyword, tlds);

  if (rawCandidates.length === 0) {
    statusEl.innerHTML = '<span class="error-text">Enter a brand/domain name.</span>';
    return;
  }

  // Drop anything already in the active brand profile's own allowlist
  // (official/partner/allowlisted domains) - no point flagging your own
  // domain as a candidate to scan for squatting.
  const candidates = rawCandidates.filter((candidate) => !isDomainAllowlisted(candidate.domain));
  const excluded = rawCandidates.length - candidates.length;
  if (candidates.length === 0) {
    statusEl.innerHTML = '<span class="error-text">All generated variants are already in your active brand profile\'s allowlist.</span>';
    return;
  }

  fillQueryInputWithCandidates(candidates.map((candidate) => candidate.domain), rawCandidates);
  const excludedNote = excluded > 0 ? ` (${excluded} excluded - already allowlisted)` : '';
  statusEl.textContent = `Generated ${candidates.length} typosquat variants${excludedNote} - scrolled to the query box above so you can review them, then click Lookup to scan.`;
});

typoFillProfileBtn.addEventListener('click', () => {
  const profile = getActiveBrandProfile();
  if (!profile) {
    typoStatusEl.innerHTML = '<span class="error-text">No active brand profile selected - pick one in the Brand Profiles panel above.</span>';
    return;
  }
  typoKeywordInput.value = profile.officialDomains[0] || profile.name;
  if (profile.tlds.length > 0) typoTldsInput.value = profile.tlds.join(', ');
  typoStatusEl.textContent = `Filled from brand profile "${profile.name}".`;
});
