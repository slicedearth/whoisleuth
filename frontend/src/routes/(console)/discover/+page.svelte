<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onMount } from 'svelte';
  import DiscoverCandidateResults from '$lib/components/DiscoverCandidateResults.svelte';
  import DiscoverCtHistory from '$lib/components/DiscoverCtHistory.svelte';
  import DiscoverGenerationOptions from '$lib/components/DiscoverGenerationOptions.svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import {
    DEFAULT_GENERATION_PRESET,
    DEFAULT_KEYBOARD_LAYOUT,
    estimateTyposquatCandidateCount,
    GENERATION_PRESETS,
    generateTyposquatCandidateSet,
    KEYBOARD_LAYOUTS,
    MAX_CUSTOM_DICTIONARY_TERM_LENGTH,
    MAX_CUSTOM_DICTIONARY_TERMS,
    MAX_CUSTOM_DICTIONARY_TEXT_LENGTH,
    MAX_GENERATED_CANDIDATES,
    MAX_GENERATION_INPUT_LENGTH,
    MAX_GENERATION_TLDS,
    MAX_NAME_VARIANTS,
    MUTATION_FAMILY_IDS,
    MUTATION_LABELS,
    normalizeCustomDictionaryTerms,
  } from '$lib/analysis/typosquat-generator.js';
  import { activeProfile, isDomainAllowlisted, type BrandProfile } from '$lib/brand-profiles';
  import { saveCandidateHandoff, type Candidate } from '$lib/candidate-handoff';
  import { normalizeCtResponse, ctCandidateMatchesFilter } from '$lib/analysis/ct-results.js';
  import { MAX_CT_QUERY_LENGTH, normalizeCtQuery } from '$lib/analysis/ct-query.js';
  import { analyzeDomainIdn } from '$lib/analysis/idn-confusables.js';
  import { clearCtHistory, loadCtHistory, removeCtHistory, saveCtHistorySearch, type CtHistoryEntry, type CtHistoryStore } from '$lib/ct-history';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '$lib/capabilities';
  import { normalizeInvestigationGuideDomain } from '$lib/analysis/investigation-guide.ts';

  type Mode = 'typosquat' | 'keyword' | 'certificate-transparency';
  type GenerationPresetId = 'common' | 'impersonation' | 'all' | 'custom';
  type KeyboardLayoutId = 'qwerty' | 'azerty' | 'qwertz' | 'all';
  type CandidateScope = 'all' | 'unicode' | 'mixed' | 'reference' | 'selected';
  type CandidateSort = 'generated' | 'domain' | 'generation-paths' | 'reference' | 'mixed' | 'certificate-newest';
  type CandidateMetadata = {
    hasIdn: boolean;
    unicodeDomain: string;
    scripts: string[];
    mixedScript: boolean;
    referenceDomains: string[];
  };
  const DISCOVER_PAGE_SIZE = 100;
  let mode = $state<Mode>('typosquat');
  let generationPreset = $state<GenerationPresetId>(DEFAULT_GENERATION_PRESET as GenerationPresetId);
  let keyboardLayout = $state<KeyboardLayoutId>(DEFAULT_KEYBOARD_LAYOUT as KeyboardLayoutId);
  let customMutationFamilies = $state<string[]>([...MUTATION_FAMILY_IDS]);
  let seed = $state('');
  let tldText = $state('com, net, org');
  let customDictionaryText = $state('');
  let candidates = $state<Candidate[]>([]);
  let generatedContext = $state<Candidate[]>([]);
  let selected = $state<Set<string>>(new Set());
  let status = $state('');
  let error = $state('');
  let searching = $state(false);
  let filter = $state('');
  let candidateScope = $state<CandidateScope>('all');
  let mutationFilter = $state('');
  let candidateSort = $state<CandidateSort>('generated');
  let candidateMetadata = $state<Map<string, CandidateMetadata>>(new Map());
  let profile = $state<BrandProfile|null>(null);
  // Whether the current candidate set came from structured CT provenance.
  let ctResultKind = $state<'structured'|null>(null);
  let ctHistory = $state<CtHistoryStore>({ version: 1, entries: [] });
  let ctNewDomains = $state<Set<string>>(new Set());
  let ctPreviousCheckedAt = $state<string|null>(null);
  let ctNewOnly = $state(false);
  let ctHistoryNotice = $state('');
  let page = $state(1);
  const capabilityReport=getContext<CapabilityGetter>(CAPABILITY_CONTEXT);
  const ctDisabled=$derived(disabledCapability(capabilityReport?.()||null,'certificate_transparency'));
  // Monotonic request token: a slower, older CT response can never overwrite a
  // newer completed search (or a mode switch that invalidated it).
  let searchToken = 0;
  // The in-flight CT request, so switching tabs (or a new search) can cancel it
  // and never leave the UI stuck in its loading/disabled state.
  let ctController: AbortController | null = null;

  // Invalidates and aborts any in-flight CT search and clears its loading
  // state. Called on every mode switch and before starting a new search.
  function cancelCtSearch() {
    searchToken++;
    ctController?.abort();
    ctController = null;
    searching = false;
  }
  const mutationLabels = MUTATION_LABELS as Record<string, string>;
  const generationPresets = Object.values(GENERATION_PRESETS) as Array<{
    id: GenerationPresetId;
    label: string;
    description: string;
  }>;
  const keyboardLayouts = Object.values(KEYBOARD_LAYOUTS) as Array<{ id: KeyboardLayoutId; label: string }>;
  const mutationFamilyOptions = MUTATION_FAMILY_IDS.map((id) => ({
    id,
    label: mutationLabels[id] || id.replaceAll('_', ' '),
  }));
  const maxTldTextLength = 2_048;

  const mutationOptions = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      for (const mutationType of candidate.mutationTypes) {
        counts.set(mutationType, (counts.get(mutationType) || 0) + 1);
      }
    }
    return [...counts]
      .map(([value, count]) => ({ value, count, label: mutationLabels[value] || value.replaceAll('_', ' ') }))
      .sort((left, right) => left.label.localeCompare(right.label));
  });
  const candidateScopeCounts = $derived.by(() => {
    let unicode = 0;
    let mixed = 0;
    let reference = 0;
    for (const candidate of candidates) {
      const metadata = candidateMetadata.get(candidate.domain);
      if (metadata?.hasIdn) unicode += 1;
      if (metadata?.mixedScript) mixed += 1;
      if (metadata?.referenceDomains.length) reference += 1;
    }
    return { unicode, mixed, reference, selected: selected.size };
  });
  const visible = $derived.by(() => {
    const filtered = candidates.filter((candidate) => {
      const metadata = candidateMetadata.get(candidate.domain);
      if (!ctCandidateMatchesFilter(candidate, filter) || (ctNewOnly && !ctNewDomains.has(candidate.domain))) return false;
      if (mutationFilter && !candidate.mutationTypes.includes(mutationFilter)) return false;
      if (candidateScope === 'unicode' && !metadata?.hasIdn) return false;
      if (candidateScope === 'mixed' && !metadata?.mixedScript) return false;
      if (candidateScope === 'reference' && !metadata?.referenceDomains.length) return false;
      if (candidateScope === 'selected' && !selected.has(candidate.domain)) return false;
      return true;
    });
    if (candidateSort === 'generated') return filtered;
    return [...filtered].sort((left, right) => {
      if (candidateSort === 'domain') return left.domain.localeCompare(right.domain);
      if (candidateSort === 'generation-paths') {
        return right.mutationTypes.length - left.mutationTypes.length || left.domain.localeCompare(right.domain);
      }
      if (candidateSort === 'reference') {
        return Number(Boolean(candidateMetadata.get(right.domain)?.referenceDomains.length))
          - Number(Boolean(candidateMetadata.get(left.domain)?.referenceDomains.length))
          || left.domain.localeCompare(right.domain);
      }
      if (candidateSort === 'mixed') {
        return Number(Boolean(candidateMetadata.get(right.domain)?.mixedScript))
          - Number(Boolean(candidateMetadata.get(left.domain)?.mixedScript))
          || left.domain.localeCompare(right.domain);
      }
      const leftObserved = left.certificateTransparency?.lastObservedAt || '';
      const rightObserved = right.certificateTransparency?.lastObservedAt || '';
      return rightObserved.localeCompare(leftObserved) || left.domain.localeCompare(right.domain);
    });
  });
  const pageCount = $derived(Math.max(1, Math.ceil(visible.length / DISCOVER_PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const pagedVisible = $derived(visible.slice((currentPage - 1) * DISCOVER_PAGE_SIZE, currentPage * DISCOVER_PAGE_SIZE));
  const selectedCandidates = $derived(candidates.filter((c) => selected.has(c.domain)));
  const selectedVisibleCount = $derived(visible.reduce((count, candidate) => count + Number(selected.has(candidate.domain)), 0));
  const reviewControlsActive = $derived(
    Boolean(filter)
      || candidateScope !== 'all'
      || Boolean(mutationFilter)
      || candidateSort !== 'generated'
      || ctNewOnly,
  );

  onMount(() => {void (async()=>{
    [profile,ctHistory] = await Promise.all([activeProfile(),loadCtHistory()]);
    if (candidates.length) candidateMetadata = buildCandidateMetadata(candidates);
    const guidedDomain = normalizeInvestigationGuideDomain(new URL(window.location.href).searchParams.get('q'));
    if (guidedDomain) seed = guidedDomain;
  })();});

  function referenceDomainsForCandidate(candidate: Candidate): string[] {
    const references: string[] = [];
    const source = candidate.source.trim().toLowerCase().replace(/\.+$/, '');
    if (/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(source) && source.includes('.')) {
      references.push(source);
    } else if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(source)) {
      const tld = candidate.domain.split('.').at(-1);
      if (tld) references.push(`${source}.${tld}`);
    }
    if (profile) references.push(...profile.officialDomains);
    return [...new Set(references)].slice(0, 50);
  }

  function buildCandidateMetadata(next: Candidate[]): Map<string, CandidateMetadata> {
    const metadata = new Map<string, CandidateMetadata>();
    for (const candidate of next.slice(0, MAX_GENERATED_CANDIDATES)) {
      const analysis = analyzeDomainIdn(candidate.domain, referenceDomainsForCandidate(candidate));
      metadata.set(candidate.domain, {
        hasIdn: Boolean(analysis?.hasIdn),
        unicodeDomain: analysis?.hasIdn ? String(analysis.unicodeDomain || '') : '',
        scripts: Array.isArray(analysis?.scripts) ? analysis.scripts.map(String).slice(0, 12) : [],
        mixedScript: Boolean(analysis?.mixedScript),
        referenceDomains: Array.isArray(analysis?.referenceMatches)
          ? analysis.referenceMatches.map((match: { asciiDomain?: unknown }) => String(match.asciiDomain || '')).filter(Boolean).slice(0, 20)
          : [],
      });
    }
    return metadata;
  }

  function resetCandidateView() {
    filter = '';
    candidateScope = 'all';
    mutationFilter = '';
    candidateSort = 'generated';
    page = 1;
  }

  function resetCtComparison() {
    ctNewDomains = new Set();
    ctPreviousCheckedAt = null;
    ctNewOnly = false;
    ctHistoryNotice = '';
  }

  function historyDate(value:string|null) {
    if (!value) return 'No complete baseline';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown date' : parsed.toLocaleString();
  }

  function historyDisplayEntries() {
    return ctHistory.entries.map((entry) => ({
      query: entry.query,
      domainCount: entry.domains.length,
      checkCount: entry.history.length,
      updatedLabel: historyDate(entry.updatedAt),
      latestNewCount: entry.history.at(-1)?.newCount || 0,
      checks: [...entry.history].reverse().map((event) => ({
        checkedAt: event.checkedAt,
        checkedLabel: historyDate(event.checkedAt),
        resultCount: event.resultCount,
        newCount: event.newCount,
        truncated: event.truncated,
      })),
    }));
  }

  function tldSelection() {
    const boundedText = tldText.slice(0, maxTldTextLength);
    const values = [...new Set(boundedText.split(/[;,\s]+/).map((v) => v.trim().toLowerCase().replace(/^\./, '')).filter((v) => /^[a-z]{2,63}$/.test(v)))];
    return {
      values,
      truncated: tldText.length > maxTldTextLength || values.length > MAX_GENERATION_TLDS,
    };
  }

  const generationEstimate = $derived.by(() => {
    if (mode !== 'typosquat' || !seed.trim()) return null;
    return estimateTyposquatCandidateCount(seed, tldSelection().values, {
      preset: generationPreset,
      keyboardLayout,
      dictionaryTerms: customDictionaryText,
      mutationTypes: customMutationFamilies,
    });
  });
  const effectiveMutationFamilies = $derived(
    generationPreset === 'custom'
      ? customMutationFamilies
      : [...GENERATION_PRESETS[generationPreset].mutationTypes],
  );
  const keyboardLayoutRelevant = $derived(
    effectiveMutationFamilies.includes('keyboard_substitution')
      || effectiveMutationFamilies.includes('keyboard_insertion'),
  );
  const dictionaryRelevant = $derived(
    effectiveMutationFamilies.includes('dictionary')
      || effectiveMutationFamilies.includes('dictionary_token_replacement'),
  );
  const customDictionary = $derived(normalizeCustomDictionaryTerms(customDictionaryText));

  function clearGeneratedResults() {
    candidates = [];
    generatedContext = [];
    selected = new Set();
    status = '';
    error = '';
    candidateMetadata = new Map();
    resetCandidateView();
  }

  function selectGenerationPreset(next: GenerationPresetId) {
    if (next === generationPreset) return;
    generationPreset = next;
    clearGeneratedResults();
  }

  function selectKeyboardLayout(next: string) {
    if (!(next in KEYBOARD_LAYOUTS) || next === keyboardLayout) return;
    keyboardLayout = next as KeyboardLayoutId;
    clearGeneratedResults();
  }

  function toggleMutationFamily(id: string) {
    if (!MUTATION_FAMILY_IDS.includes(id)) return;
    customMutationFamilies = customMutationFamilies.includes(id)
      ? customMutationFamilies.filter((value) => value !== id)
      : MUTATION_FAMILY_IDS.filter((value) => value === id || customMutationFamilies.includes(value));
    clearGeneratedResults();
  }

  function setCustomDictionaryText(next: string) {
    const bounded = next.slice(0, MAX_CUSTOM_DICTIONARY_TEXT_LENGTH);
    if (bounded === customDictionaryText) return;
    customDictionaryText = bounded;
    clearGeneratedResults();
  }

  function generateKeywordCandidates(selectedTlds:string[]): Candidate[] {
    const words = seed.trim().toLowerCase().split(/\s+/).map((v) => v.replace(/[^a-z0-9-]/g, '')).filter(Boolean);
    if (!words.length) return [];
    const joined = words.join('');
    const bases = new Set([joined, words.join('-'), `get${joined}`, `my${joined}`, `${joined}hq`, `${joined}app`, `${joined}online`]);
    return [...bases]
      .filter((base) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(base))
      .flatMap((base) => selectedTlds.map((tld) => ({ domain: `${base}.${tld}`, source: seed.trim(), mutationTypes: ['keyword'] })));
  }

  function setResults(next: Candidate[], message: string, context:Candidate[]=next) {
    candidates = next;
    generatedContext = context;
    selected = new Set();
    candidateMetadata = buildCandidateMetadata(next);
    status = message;
    error = '';
    resetCandidateView();
  }

  function withoutAllowlisted(next: Candidate[]) {
    const filtered = next.filter((candidate) => !isDomainAllowlisted(candidate.domain, profile));
    return { filtered, excluded: next.length - filtered.length };
  }

  function useProfile() {
    if (!profile) return;
    seed = profile.officialDomains[0] || profile.productNames[0] || profile.name;
    if (profile.tlds.length) tldText = profile.tlds.join(', ');
    error = '';
    status = `Loaded discovery defaults from ${profile.name}.`;
  }

  function selectMode(next:Mode){cancelCtSearch();mode=next;candidates=[];generatedContext=[];selected=new Set();candidateMetadata=new Map();status='';error='';ctResultKind=null;resetCandidateView();resetCtComparison();}
  function tabKeydown(event:KeyboardEvent){const order:Mode[]=['typosquat','keyword','certificate-transparency'];const current=order.indexOf(mode);let index=-1;if(event.key==='ArrowRight')index=(current+1)%order.length;else if(event.key==='ArrowLeft')index=(current+order.length-1)%order.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=order.length-1;if(index<0)return;event.preventDefault();selectMode(order[index]);requestAnimationFrame(()=>document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus());}

  function generate() {
    cancelCtSearch(); ctResultKind = null; resetCtComparison();
    if (!seed.trim()) { error = 'Enter a brand, domain, or keyword.'; return; }
    const selection = tldSelection();
    if (!selection.values.length && !seed.includes('.')) { error = 'Enter at least one valid TLD.'; return; }
    if (mode === 'keyword') {
      const generated=generateKeywordCandidates(selection.values.slice(0, MAX_GENERATION_TLDS));
      if (!generated.length) {
        error = 'Enter a shorter keyword that can form a valid domain label.';
        candidates = []; generatedContext = []; selected = new Set(); status = '';
        return;
      }
      const { filtered, excluded } = withoutAllowlisted(generated);
      const capNote = selection.truncated ? ' Generation limits were reached; narrow the TLD list for complete coverage.' : '';
      setResults(filtered, `Generated ${filtered.length} naming candidates${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}.${capNote}`, generated);
      return;
    }
    if (generationPreset === 'custom' && customMutationFamilies.length === 0) {
      error = 'Select at least one custom mutation family.';
      return;
    }
    const result = generateTyposquatCandidateSet(seed, selection.values, {
      preset: generationPreset,
      keyboardLayout,
      dictionaryTerms: customDictionaryText,
      mutationTypes: customMutationFamilies,
    });
    if (!result.inputValid) {
      error = 'Enter a valid brand label or a domain with one suffix label.';
      candidates = []; generatedContext = []; selected = new Set(); status = '';
      return;
    }
    const generated = result.candidates as Array<{domain:string;source:string;mutationTypes:string[]}>;
    const { filtered, excluded } = withoutAllowlisted(generated);
    const capped = result.truncated || (!seed.includes('.') && selection.truncated);
    const capNote = capped ? ' Generation limits were reached; narrow the seed, dictionary, or TLD list for complete coverage.' : '';
    const dictionaryNote = dictionaryRelevant && customDictionary.rejectedCount
      ? ` Ignored ${customDictionary.rejectedCount} invalid custom dictionary term${customDictionary.rejectedCount===1?'':'s'}.`
      : '';
    setResults(filtered, `Generated ${filtered.length} explainable lookalike variants${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}.${dictionaryNote}${capNote}`, generated);
  }

  async function searchCt() {
    if (ctDisabled) { error = ctDisabled.reason || 'Certificate Transparency search is disabled by deployment policy.'; return; }
    let query: string;
    try { query = normalizeCtQuery(seed); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Enter a valid certificate-log keyword.'; return; }
    if (!query) { error = 'Enter a brand or keyword to search.'; return; }
    // Supersede and abort any earlier in-flight search before starting.
    cancelCtSearch();
    const token = searchToken;
    const controller = new AbortController();
    ctController = controller;
    searching = true; error = ''; status = 'Searching Certificate Transparency logs…'; resetCtComparison();
    try {
      const response = await fetch(`/api/ct-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (token !== searchToken) return; // a newer search or a mode switch superseded this one
      if (!response.ok) throw new Error((body.error as string) || `Search failed (${response.status})`);
      const { candidates: next, certCount, truncated } = normalizeCtResponse(body, query);
      const { filtered, excluded } = withoutAllowlisted(next);
      ctResultKind = 'structured';
      const noun = 'registrable domain';
      let historySummary = '';
      try {
        const result = await saveCtHistorySearch(query, next.map((candidate)=>candidate.domain), { certificateCount: certCount, truncated });
        ctHistory = result.store;
        const visibleDomains = new Set(filtered.map((candidate)=>candidate.domain));
        ctNewDomains = new Set(result.comparison.newDomains.filter((domain)=>visibleDomains.has(domain)));
        ctPreviousCheckedAt = result.comparison.previousCheckedAt;
        const visibleNewCount = ctNewDomains.size;
        if (result.comparison.hasBaseline) {
          historySummary = ` ${visibleNewCount} new since the previous complete search on ${historyDate(result.comparison.previousCheckedAt)}.`;
          if (!result.comparison.baselineUpdated) historySummary += ' Capped results did not replace that baseline.';
        } else if (result.comparison.baselineUpdated) {
          historySummary = ' Saved as the first local baseline for this search.';
        } else {
          historySummary = ' Results were capped, so no local baseline was created.';
        }
      } catch (cause) {
        ctHistoryNotice = cause instanceof Error ? cause.message : 'Certificate search history is unavailable.';
      }
      setResults(filtered, `Found ${filtered.length} ${noun}${filtered.length===1?'':'s'} from ${certCount} certificate${certCount===1?'':'s'}${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}${truncated ? ' (result cap reached)' : ''}.${historySummary}`, next);
    } catch (cause) {
      // A superseding search / mode switch (which aborts this fetch) owns the UI
      // state now; do nothing so we neither clear its results nor its loading flag.
      if (token !== searchToken) return;
      // Clear any prior results so stale metadata is never shown as belonging
      // to this failed query.
      ctResultKind = null; candidates = []; generatedContext = []; selected = new Set(); resetCtComparison();
      error = cause instanceof Error ? cause.message : 'Certificate search failed'; status = '';
    } finally {
      if (token === searchToken) { searching = false; ctController = null; }
    }
  }

  function useHistoryEntry(entry:CtHistoryEntry) {
    selectMode('certificate-transparency');
    seed = entry.query;
  }

  async function deleteHistoryEntry(entry:CtHistoryEntry) {
    if (!confirm(`Forget the saved Certificate Transparency baseline and history for “${entry.query}”?`)) return;
    try {
      ctHistory = await removeCtHistory(entry.query);
      resetCtComparison();
    } catch (cause) {
      ctHistoryNotice = cause instanceof Error ? cause.message : 'Could not remove Certificate Transparency history.';
    }
  }

  async function deleteAllHistory() {
    if (!confirm('Delete every saved Certificate Transparency baseline and check history?')) return;
    try {
      ctHistory = await clearCtHistory();
      resetCtComparison();
    } catch (cause) {
      ctHistoryNotice = cause instanceof Error ? cause.message : 'Could not clear Certificate Transparency history.';
    }
  }

  function useHistoryQuery(query:string) {
    const entry = ctHistory.entries.find((candidate) => candidate.query === query);
    if (entry) useHistoryEntry(entry);
  }

  function deleteHistoryQuery(query:string) {
    const entry = ctHistory.entries.find((candidate) => candidate.query === query);
    if (entry) deleteHistoryEntry(entry);
  }

  function toggle(domain: string) {
    const next = new Set(selected);
    if (next.has(domain)) next.delete(domain); else next.add(domain);
    selected = next;
  }

  function selectMatching(checked: boolean) {
    const next = new Set(selected);
    for (const candidate of visible) checked ? next.add(candidate.domain) : next.delete(candidate.domain);
    selected = next;
  }

  function resetReviewControls() {
    resetCandidateView();
    ctNewOnly = false;
  }

  function setFilter(value: string) {
    filter = value;
    page = 1;
  }

  function setCandidateScope(value: CandidateScope) {
    candidateScope = value;
    page = 1;
  }

  function setMutationFilter(value: string) {
    mutationFilter = value;
    page = 1;
  }

  function setCandidateSort(value: CandidateSort) {
    candidateSort = value;
    page = 1;
  }

  function toggleNewOnly() {
    ctNewOnly = !ctNewOnly;
    page = 1;
  }

  function setPage(value: number) {
    page = Math.min(pageCount, Math.max(1, Math.trunc(value)));
  }

  function candidateDisplayRows() {
    return pagedVisible.map((candidate) => {
      const metadata = candidateMetadata.get(candidate.domain);
      return {
        domain: candidate.domain,
        mutationLabel: candidate.mutationTypes.map((type) => mutationLabels[type] || type.replaceAll('_', ' ')).join(' · '),
        selected: selected.has(candidate.domain),
        isNew: ctNewDomains.has(candidate.domain),
        unicodeDomain: metadata?.unicodeDomain || '',
        scripts: metadata?.scripts || [],
        mixedScript: Boolean(metadata?.mixedScript),
        referenceDomains: metadata?.referenceDomains || [],
        certificateEvidence: candidate.certificateTransparency ? {
          certificateCount: candidate.certificateTransparency.certificateCount,
          firstObservedAt: candidate.certificateTransparency.firstObservedAt,
          lastObservedAt: candidate.certificateTransparency.lastObservedAt,
          hostnames: candidate.certificateTransparency.hostnames.map(String),
        } : null,
      };
    });
  }

  async function sendToBulk() {
    if (!selectedCandidates.length) return;
    saveCandidateHandoff(mode, selectedCandidates, generatedContext);
    await goto('/bulk?source=discover');
  }
</script>

<svelte:head><title>Discover · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Find candidates" title="Discover" description="Generate explainable lookalikes, explore defensive registrations, and search public Certificate Transparency logs." />

<section class="controls card">
  {#if mode==='certificate-transparency'&&ctDisabled}<p class="feature-disabled" role="note">{ctDisabled.reason||'Certificate Transparency search is disabled by deployment policy.'}</p>{/if}
  {#if profile}<div class="profile-context"><span>Active profile: <strong>{profile.name}</strong></span><button class="btn small" onclick={useProfile}>Use profile defaults</button></div>{/if}
  <div class="modes" role="tablist" aria-label="Discovery method">
    <button role="tab" aria-selected={mode==='typosquat'} tabindex={mode==='typosquat'?0:-1} class:active={mode==='typosquat'} onclick={()=>selectMode('typosquat')} onkeydown={tabKeydown}>Lookalikes</button>
    <button role="tab" aria-selected={mode==='keyword'} tabindex={mode==='keyword'?0:-1} class:active={mode==='keyword'} onclick={()=>selectMode('keyword')} onkeydown={tabKeydown}>Name ideas</button>
    <button role="tab" aria-selected={mode==='certificate-transparency'} tabindex={mode==='certificate-transparency'?0:-1} class:active={mode==='certificate-transparency'} onclick={()=>selectMode('certificate-transparency')} onkeydown={tabKeydown}>Certificates</button>
  </div>
  <div class="fields">
    <label class="field">{mode==='keyword' ? 'Keyword' : mode==='certificate-transparency' ? 'Certificate-log keyword' : 'Brand or domain'}<input id="discovery-seed" bind:value={seed} maxlength={mode==='certificate-transparency'?MAX_CT_QUERY_LENGTH:MAX_GENERATION_INPUT_LENGTH} aria-describedby={mode==='certificate-transparency'?'ct-query-guidance':undefined} placeholder={mode==='typosquat'?'example.com':'Example brand'}></label>
    {#if mode!=='certificate-transparency'}<label class="field">TLDs<input bind:value={tldText} maxlength={maxTldTextLength} aria-describedby="generation-limits" placeholder="com, net, org"></label>{/if}
    <button class="primary" onclick={mode==='certificate-transparency'?searchCt:generate} disabled={searching||(mode==='certificate-transparency'&&Boolean(ctDisabled))}>{searching?'Searching…':mode==='certificate-transparency'?'Search certificates':'Generate candidates'}</button>
  </div>
  {#if mode==='typosquat'}
    <DiscoverGenerationOptions
      presets={generationPresets}
      selectedPreset={generationPreset}
      selectPreset={(id)=>selectGenerationPreset(id as GenerationPresetId)}
      mutationFamilies={mutationFamilyOptions}
      selectedMutationFamilies={customMutationFamilies}
      {toggleMutationFamily}
      {keyboardLayouts}
      selectedKeyboardLayout={keyboardLayout}
      {keyboardLayoutRelevant}
      {selectKeyboardLayout}
      {dictionaryRelevant}
      dictionaryText={customDictionaryText}
      {setCustomDictionaryText}
      dictionarySummary={customDictionary}
      maxDictionaryTerms={MAX_CUSTOM_DICTIONARY_TERMS}
      maxDictionaryTermLength={MAX_CUSTOM_DICTIONARY_TERM_LENGTH}
      maxDictionaryTextLength={MAX_CUSTOM_DICTIONARY_TEXT_LENGTH}
      estimate={generationEstimate}
      maxTlds={MAX_GENERATION_TLDS}
      maxNameVariants={MAX_NAME_VARIANTS}
      maxCandidates={MAX_GENERATED_CANDIDATES}
    />
  {/if}
  {#if mode==='certificate-transparency'}<p class="generation-limits" id="ct-query-guidance">Search public certificate names using a keyword of up to {MAX_CT_QUERY_LENGTH} characters. This does not submit the target for a live website scan.</p>{/if}
  {#if mode==='keyword'}<p class="generation-limits" id="generation-limits">Generation is bounded to {MAX_GENERATION_TLDS} TLDs, {MAX_NAME_VARIANTS.toLocaleString()} label variants, and {MAX_GENERATED_CANDIDATES.toLocaleString()} candidates per run.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{:else if status}<p class="status" role="status" aria-live="polite">{status}</p>{/if}
  {#if ctHistoryNotice}<p class="ct-history-notice" role="status">{ctHistoryNotice}</p>{/if}
  {#if mode==='certificate-transparency' && ctHistory.entries.length}
    <DiscoverCtHistory entries={historyDisplayEntries()} useEntry={useHistoryQuery} deleteEntry={deleteHistoryQuery} clearHistory={deleteAllHistory} />
  {/if}
</section>

{#if candidates.length}
  <DiscoverCandidateResults
    selectedCount={selected.size}
    candidateCount={candidates.length}
    continueToBulk={sendToBulk}
    {filter}
    {setFilter}
    {candidateScope}
    scopeCounts={candidateScopeCounts}
    setCandidateScope={(value)=>setCandidateScope(value as CandidateScope)}
    {mutationFilter}
    {mutationOptions}
    {setMutationFilter}
    {candidateSort}
    setCandidateSort={(value)=>setCandidateSort(value as CandidateSort)}
    structured={ctResultKind==='structured'}
    previousCheckedAt={ctPreviousCheckedAt}
    newOnly={ctNewOnly}
    newCount={ctNewDomains.size}
    {toggleNewOnly}
    {selectMatching}
    {selectedVisibleCount}
    {reviewControlsActive}
    {resetReviewControls}
    rows={candidateDisplayRows()}
    visibleCount={visible.length}
    {currentPage}
    {pageCount}
    pageSize={DISCOVER_PAGE_SIZE}
    {setPage}
    toggleCandidate={toggle}
  />
{/if}

<style>
  .controls{padding:var(--card-pad)}
  .profile-context{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px;padding:9px 9px 9px 12px;border:1px solid rgb(var(--accent2-rgb) / .3);border-radius:var(--radius-md);background:rgb(var(--accent2-rgb) / .04);color:var(--muted);font-size:var(--text-xs)}
  .profile-context strong{color:var(--text)}
  .modes{display:flex;gap:6px;margin-bottom:18px;padding:5px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--bg-rgb) / .5)}
  .modes button{flex:1 1 auto;min-height:38px;padding:8px 12px;border:1px solid transparent;border-radius:var(--radius-sm);color:var(--muted);background:transparent;font:600 var(--text-xs) var(--mono)}
  .modes button:hover{color:var(--text)}
  .modes button.active{color:var(--accent2);border-color:rgb(var(--accent2-rgb) / .45);background:rgb(var(--accent2-rgb) / .08)}
  .fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(160px,.7fr) auto;gap:10px;align-items:end}
  .generation-limits{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .ct-history-notice{color:var(--amber);font-size:var(--text-xs)}
  @media(max-width:700px){
    .fields{grid-template-columns:1fr}
    .modes{overflow:auto}
    .profile-context{align-items:flex-start;flex-direction:column}
  }
</style>
