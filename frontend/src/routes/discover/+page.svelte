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
    MAX_GENERATED_CANDIDATES,
    MAX_GENERATION_INPUT_LENGTH,
    MAX_GENERATION_TLDS,
    MAX_NAME_VARIANTS,
    MUTATION_LABELS,
  } from '$lib/analysis/typosquat-generator.js';
  import { activeProfile, isDomainAllowlisted, type BrandProfile } from '$lib/brand-profiles';
  import { saveCandidateHandoff, type Candidate } from '$lib/candidate-handoff';
  import { normalizeCtResponse, ctCandidateMatchesFilter } from '$lib/analysis/ct-results.js';
  import { clearCtHistory, loadCtHistory, removeCtHistory, saveCtHistorySearch, type CtHistoryEntry, type CtHistoryStore } from '$lib/ct-history';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '$lib/capabilities';

  type Mode = 'typosquat' | 'keyword' | 'certificate-transparency';
  type GenerationPresetId = 'common' | 'impersonation' | 'all';
  type KeyboardLayoutId = 'qwerty' | 'azerty' | 'qwertz';
  let mode = $state<Mode>('typosquat');
  let generationPreset = $state<GenerationPresetId>(DEFAULT_GENERATION_PRESET as GenerationPresetId);
  let keyboardLayout = $state<KeyboardLayoutId>(DEFAULT_KEYBOARD_LAYOUT as KeyboardLayoutId);
  let seed = $state('');
  let tldText = $state('com, net, org');
  let candidates = $state<Candidate[]>([]);
  let generatedContext = $state<Candidate[]>([]);
  let selected = $state<Set<string>>(new Set());
  let status = $state('');
  let error = $state('');
  let searching = $state(false);
  let filter = $state('');
  let profile = $state<BrandProfile|null>(null);
  // Whether the last CT search rendered structured per-registrable-domain
  // provenance or fell back to a legacy hostname-only backend response.
  let ctResultKind = $state<'structured'|'legacy'|null>(null);
  let ctHistory = $state<CtHistoryStore>({ version: 1, entries: [] });
  let ctNewDomains = $state<Set<string>>(new Set());
  let ctPreviousCheckedAt = $state<string|null>(null);
  let ctNewOnly = $state(false);
  let ctHistoryNotice = $state('');
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
  const maxTldTextLength = 2_048;

  const visible = $derived(candidates.filter((c) => ctCandidateMatchesFilter(c, filter) && (!ctNewOnly || ctNewDomains.has(c.domain))));
  const selectedCandidates = $derived(candidates.filter((c) => selected.has(c.domain)));

  onMount(() => { profile = activeProfile(); ctHistory = loadCtHistory(); });

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
    });
  });
  const keyboardLayoutRelevant = $derived(
    GENERATION_PRESETS[generationPreset].mutationTypes.includes('keyboard_substitution')
      || GENERATION_PRESETS[generationPreset].mutationTypes.includes('keyboard_insertion'),
  );

  function clearGeneratedResults() {
    candidates = [];
    generatedContext = [];
    selected = new Set();
    status = '';
    error = '';
    filter = '';
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
    selected = new Set(next.map((c) => c.domain));
    status = message;
    error = '';
    filter = '';
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

  function selectMode(next:Mode){cancelCtSearch();mode=next;candidates=[];generatedContext=[];selected=new Set();status='';error='';ctResultKind=null;resetCtComparison();}
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
    const result = generateTyposquatCandidateSet(seed, selection.values, {
      preset: generationPreset,
      keyboardLayout,
    });
    if (!result.inputValid) {
      error = 'Enter a valid brand label or a domain with one suffix label.';
      candidates = []; generatedContext = []; selected = new Set(); status = '';
      return;
    }
    const generated = result.candidates as Array<{domain:string;source:string;mutationTypes:string[]}>;
    const { filtered, excluded } = withoutAllowlisted(generated);
    const capped = result.truncated || (!seed.includes('.') && selection.truncated);
    const capNote = capped ? ' Generation limits were reached; narrow the seed or TLD list for complete coverage.' : '';
    setResults(filtered, `Generated ${filtered.length} explainable lookalike variants${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}.${capNote}`, generated);
  }

  async function searchCt() {
    if (ctDisabled) { error = ctDisabled.reason || 'Certificate Transparency search is disabled by deployment policy.'; return; }
    if (!seed.trim()) { error = 'Enter a brand or keyword to search.'; return; }
    // Supersede and abort any earlier in-flight search before starting.
    cancelCtSearch();
    const token = searchToken;
    const controller = new AbortController();
    ctController = controller;
    const query = seed.trim();
    searching = true; error = ''; status = 'Searching Certificate Transparency logs…'; resetCtComparison();
    try {
      const response = await fetch(`/api/ct-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (token !== searchToken) return; // a newer search or a mode switch superseded this one
      if (!response.ok) throw new Error((body.error as string) || `Search failed (${response.status})`);
      const { candidates: next, usedStructuredMatches, certCount, truncated } = normalizeCtResponse(body, query);
      const { filtered, excluded } = withoutAllowlisted(next);
      ctResultKind = usedStructuredMatches ? 'structured' : 'legacy';
      const noun = usedStructuredMatches ? 'registrable domain' : 'observed hostname';
      let historySummary = '';
      if (usedStructuredMatches) {
        try {
          const result = saveCtHistorySearch(query, next.map((candidate)=>candidate.domain), { certificateCount: certCount, truncated });
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
      } else {
        historySummary = ' Legacy hostname-only results do not update local baselines.';
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

  function deleteHistoryEntry(entry:CtHistoryEntry) {
    if (!confirm(`Forget the saved Certificate Transparency baseline and history for “${entry.query}”?`)) return;
    try {
      ctHistory = removeCtHistory(entry.query);
      resetCtComparison();
    } catch (cause) {
      ctHistoryNotice = cause instanceof Error ? cause.message : 'Could not remove Certificate Transparency history.';
    }
  }

  function deleteAllHistory() {
    if (!confirm('Delete every saved Certificate Transparency baseline and check history?')) return;
    try {
      ctHistory = clearCtHistory();
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

  function selectVisible(checked: boolean) {
    const next = new Set(selected);
    for (const candidate of visible) checked ? next.add(candidate.domain) : next.delete(candidate.domain);
    selected = next;
  }

  function candidateDisplayRows() {
    return visible.slice(0, 300).map((candidate) => ({
      domain: candidate.domain,
      mutationLabel: candidate.mutationTypes.map((type) => mutationLabels[type] || type.replaceAll('_', ' ')).join(' · '),
      selected: selected.has(candidate.domain),
      isNew: ctNewDomains.has(candidate.domain),
      certificateEvidence: candidate.certificateTransparency ? {
        certificateCount: candidate.certificateTransparency.certificateCount,
        firstObservedAt: candidate.certificateTransparency.firstObservedAt,
        lastObservedAt: candidate.certificateTransparency.lastObservedAt,
        hostnames: candidate.certificateTransparency.hostnames.map(String),
      } : null,
    }));
  }

  async function sendToBulk() {
    if (!selectedCandidates.length) return;
    saveCandidateHandoff(mode, selectedCandidates, generatedContext);
    await goto('/bulk?source=discover');
  }
</script>

<svelte:head><title>Discover · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Discover" title="Candidate discovery" description="Generate explainable lookalikes, explore defensive registrations, and search public Certificate Transparency logs." />

<section class="controls card">
  {#if mode==='certificate-transparency'&&ctDisabled}<p class="feature-disabled" role="note">{ctDisabled.reason||'Certificate Transparency search is disabled by deployment policy.'}</p>{/if}
  {#if profile}<div class="profile-context"><span>Active profile: <strong>{profile.name}</strong></span><button class="btn small" onclick={useProfile}>Use profile defaults</button></div>{/if}
  <div class="modes" role="tablist" aria-label="Discovery method">
    <button role="tab" aria-selected={mode==='typosquat'} tabindex={mode==='typosquat'?0:-1} class:active={mode==='typosquat'} onclick={()=>selectMode('typosquat')} onkeydown={tabKeydown}>Lookalikes</button>
    <button role="tab" aria-selected={mode==='keyword'} tabindex={mode==='keyword'?0:-1} class:active={mode==='keyword'} onclick={()=>selectMode('keyword')} onkeydown={tabKeydown}>Name ideas</button>
    <button role="tab" aria-selected={mode==='certificate-transparency'} tabindex={mode==='certificate-transparency'?0:-1} class:active={mode==='certificate-transparency'} onclick={()=>selectMode('certificate-transparency')} onkeydown={tabKeydown}>Certificates</button>
  </div>
  <div class="fields">
    <label class="field">{mode==='keyword' ? 'Keyword' : mode==='certificate-transparency' ? 'Brand or certificate keyword' : 'Brand or domain'}<input bind:value={seed} maxlength={mode==='certificate-transparency'?undefined:MAX_GENERATION_INPUT_LENGTH} placeholder={mode==='typosquat'?'example.com':'Example brand'}></label>
    {#if mode!=='certificate-transparency'}<label class="field">TLDs<input bind:value={tldText} maxlength={maxTldTextLength} aria-describedby="generation-limits" placeholder="com, net, org"></label>{/if}
    <button class="primary" onclick={mode==='certificate-transparency'?searchCt:generate} disabled={searching||(mode==='certificate-transparency'&&Boolean(ctDisabled))}>{searching?'Searching…':mode==='certificate-transparency'?'Search certificates':'Generate candidates'}</button>
  </div>
  {#if mode==='typosquat'}
    <DiscoverGenerationOptions
      presets={generationPresets}
      selectedPreset={generationPreset}
      selectPreset={(id)=>selectGenerationPreset(id as GenerationPresetId)}
      {keyboardLayouts}
      selectedKeyboardLayout={keyboardLayout}
      {keyboardLayoutRelevant}
      {selectKeyboardLayout}
      estimate={generationEstimate}
      maxTlds={MAX_GENERATION_TLDS}
      maxNameVariants={MAX_NAME_VARIANTS}
      maxCandidates={MAX_GENERATED_CANDIDATES}
    />
  {/if}
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
    setFilter={(value)=>filter=value}
    structured={ctResultKind==='structured'}
    previousCheckedAt={ctPreviousCheckedAt}
    newOnly={ctNewOnly}
    newCount={ctNewDomains.size}
    toggleNewOnly={()=>ctNewOnly=!ctNewOnly}
    {selectVisible}
    legacy={ctResultKind==='legacy'}
    rows={candidateDisplayRows()}
    visibleCount={visible.length}
    toggleCandidate={toggle}
  />
{/if}

<style>
  .controls{padding:var(--card-pad)}
  .profile-context{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px;padding:9px 9px 9px 12px;border:1px solid rgba(126,224,168,.3);border-radius:var(--radius-md);background:rgba(126,224,168,.04);color:var(--muted);font-size:var(--text-xs)}
  .profile-context strong{color:var(--text)}
  .modes{display:flex;gap:6px;margin-bottom:18px;padding:5px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgba(15,17,21,.5)}
  .modes button{flex:1 1 auto;min-height:38px;padding:8px 12px;border:1px solid transparent;border-radius:var(--radius-sm);color:var(--muted);background:transparent;font:600 var(--text-xs) var(--mono)}
  .modes button:hover{color:var(--text)}
  .modes button.active{color:var(--accent2);border-color:rgba(126,224,168,.45);background:rgba(126,224,168,.08)}
  .fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(160px,.7fr) auto;gap:10px;align-items:end}
  .generation-limits{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .ct-history-notice{color:var(--amber);font-size:var(--text-xs)}
  @media(max-width:700px){
    .fields{grid-template-columns:1fr}
    .modes{overflow:auto}
    .profile-context{align-items:flex-start;flex-direction:column}
  }
</style>
