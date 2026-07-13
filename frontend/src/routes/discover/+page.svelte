<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onMount } from 'svelte';
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

  async function sendToBulk() {
    if (!selectedCandidates.length) return;
    saveCandidateHandoff(mode, selectedCandidates, generatedContext);
    await goto('/bulk?source=discover');
  }
</script>

<svelte:head><title>Discover · WHOISleuth</title></svelte:head>
<section class="heading"><div><p class="eyebrow">Discover</p><h1>Candidate discovery</h1><p>Generate explainable lookalikes, explore defensive registrations, and search public Certificate Transparency logs.</p></div></section>

<section class="controls card">
  {#if mode==='certificate-transparency'&&ctDisabled}<p class="feature-disabled" role="note">{ctDisabled.reason||'Certificate Transparency search is disabled by deployment policy.'}</p>{/if}
  {#if profile}<div class="profile-context"><span>Active profile: <strong>{profile.name}</strong></span><button onclick={useProfile}>Use profile defaults</button></div>{/if}
  <div class="modes" role="tablist" aria-label="Discovery method">
    <button role="tab" aria-selected={mode==='typosquat'} tabindex={mode==='typosquat'?0:-1} class:active={mode==='typosquat'} onclick={()=>selectMode('typosquat')} onkeydown={tabKeydown}>Lookalikes</button>
    <button role="tab" aria-selected={mode==='keyword'} tabindex={mode==='keyword'?0:-1} class:active={mode==='keyword'} onclick={()=>selectMode('keyword')} onkeydown={tabKeydown}>Name ideas</button>
    <button role="tab" aria-selected={mode==='certificate-transparency'} tabindex={mode==='certificate-transparency'?0:-1} class:active={mode==='certificate-transparency'} onclick={()=>selectMode('certificate-transparency')} onkeydown={tabKeydown}>Certificates</button>
  </div>
  <div class="fields">
    <label>{mode==='keyword' ? 'Keyword' : mode==='certificate-transparency' ? 'Brand or certificate keyword' : 'Brand or domain'}<input bind:value={seed} maxlength={mode==='certificate-transparency'?undefined:MAX_GENERATION_INPUT_LENGTH} placeholder={mode==='typosquat'?'example.com':'Example brand'}></label>
    {#if mode!=='certificate-transparency'}<label>TLDs<input bind:value={tldText} maxlength={maxTldTextLength} aria-describedby="generation-limits" placeholder="com, net, org"></label>{/if}
    <button class="primary" onclick={mode==='certificate-transparency'?searchCt:generate} disabled={searching||(mode==='certificate-transparency'&&Boolean(ctDisabled))}>{searching?'Searching…':mode==='certificate-transparency'?'Search certificates':'Generate candidates'}</button>
  </div>
  {#if mode==='typosquat'}
    <div class="generation-presets" role="group" aria-label="Generation preset">
      {#each generationPresets as preset}
        <button
          type="button"
          class:active={generationPreset===preset.id}
          aria-pressed={generationPreset===preset.id}
          aria-label={`Use ${preset.label} generation preset`}
          onclick={() => selectGenerationPreset(preset.id)}
        >
          <strong>{preset.label}</strong>
          <small>{preset.description}</small>
        </button>
      {/each}
    </div>
    <div class="generation-options">
      <label>
        Keyboard layout
        <select
          value={keyboardLayout}
          disabled={!keyboardLayoutRelevant}
          onchange={(event) => selectKeyboardLayout(event.currentTarget.value)}
        >
          {#each keyboardLayouts as layout}<option value={layout.id}>{layout.label}</option>{/each}
        </select>
      </label>
      <span>{keyboardLayoutRelevant ? 'Used for adjacent-key substitutions and insertions.' : 'Not used by the selected preset.'}</span>
    </div>
    {#if generationEstimate?.inputValid && generationEstimate.tldCount > 0}
      <p class="generation-estimate">
        Estimated maximum before validation and deduplication: up to {generationEstimate.estimatedMaximum.toLocaleString()} candidates across {generationEstimate.tldCount} TLD{generationEstimate.tldCount===1?'':'s'}.
        {#if generationEstimate.mayReachLimit} The {MAX_GENERATED_CANDIDATES.toLocaleString()}-candidate hard cap may apply.{/if}
      </p>
    {/if}
  {/if}
  {#if mode!=='certificate-transparency'}<p class="generation-limits" id="generation-limits">Generation is bounded to {MAX_GENERATION_TLDS} TLDs, {MAX_NAME_VARIANTS.toLocaleString()} label variants, and {MAX_GENERATED_CANDIDATES.toLocaleString()} candidates per run.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{:else if status}<p class="status" role="status" aria-live="polite">{status}</p>{/if}
  {#if ctHistoryNotice}<p class="ct-history-notice" role="status">{ctHistoryNotice}</p>{/if}
  {#if mode==='certificate-transparency' && ctHistory.entries.length}
    <details class="ct-history">
      <summary>Previous certificate searches · {ctHistory.entries.length}</summary>
      <div class="ct-history-list">
        {#each ctHistory.entries as entry (entry.query)}
          {@const latest = entry.history.at(-1)}
          <article>
            <div><strong>{entry.query}</strong><small>{entry.domains.length} baseline domain{entry.domains.length===1?'':'s'} · {entry.history.length} retained check{entry.history.length===1?'':'s'}</small><small>Last checked {historyDate(entry.updatedAt)}{latest?.newCount ? ` · ${latest.newCount} new` : ''}</small>{#if entry.history.length}<details class="ct-checks"><summary>View check history</summary><ol>{#each [...entry.history].reverse() as event}<li><time datetime={event.checkedAt}>{historyDate(event.checkedAt)}</time><span>{event.resultCount} result{event.resultCount===1?'':'s'} · {event.newCount} new{event.truncated?' · capped':''}</span></li>{/each}</ol></details>{/if}</div>
            <div><button aria-label={`Use ${entry.query} certificate search`} onclick={()=>useHistoryEntry(entry)}>Use</button><button class="danger" aria-label={`Delete ${entry.query} certificate history`} onclick={()=>deleteHistoryEntry(entry)}>Delete</button></div>
          </article>
        {/each}
      </div>
      <button class="danger ct-clear-history" onclick={deleteAllHistory}>Clear all certificate history</button>
    </details>
  {/if}
</section>

{#if candidates.length}
  <section class="results card">
    <header><div><p class="eyebrow">Candidates</p><h2>{selected.size} selected of {candidates.length}</h2></div><button class="primary" onclick={sendToBulk} disabled={!selected.size}>Continue to Bulk</button></header>
    <div class="toolbar"><input bind:value={filter} aria-label="Filter candidates" placeholder={ctResultKind==='structured'?'Filter by domain or observed hostname':'Filter candidates'}>{#if ctResultKind==='structured' && ctPreviousCheckedAt}<button class:active={ctNewOnly} aria-pressed={ctNewOnly} onclick={()=>ctNewOnly=!ctNewOnly}>New only · {ctNewDomains.size}</button>{/if}<button onclick={()=>selectVisible(true)}>Select visible</button><button onclick={()=>selectVisible(false)}>Clear visible</button></div>
    {#if ctResultKind==='legacy'}<p class="ct-legacy" role="note">Detailed certificate provenance was unavailable for this search; showing observed hostnames only.</p>{/if}
    <div class="candidate-list">
      {#each visible.slice(0, 300) as candidate, i (candidate.domain)}
        <div class="candidate" class:has-ct={candidate.certificateTransparency}>
          <input type="checkbox" id={`candidate-${i}`} checked={selected.has(candidate.domain)} onchange={()=>toggle(candidate.domain)}>
          <div class="candidate-body">
            <label for={`candidate-${i}`}><strong>{candidate.domain}</strong><small>{candidate.mutationTypes.map((type)=>mutationLabels[type] || type.replaceAll('_',' ')).join(' · ')}</small>{#if ctNewDomains.has(candidate.domain)}<span class="ct-new">New since previous search</span>{/if}</label>
            {#if candidate.certificateTransparency}
              {@const ct = candidate.certificateTransparency}
              <div class="ct-meta">
                <span class="ct-stat">{ct.certificateCount} distinct certificate{ct.certificateCount===1?'':'s'}</span>
                {#if ct.firstObservedAt}<span class="ct-stat">Earliest CT observation <time datetime={ct.firstObservedAt}>{ct.firstObservedAt.slice(0,10)}</time></span>{/if}
                {#if ct.lastObservedAt}<span class="ct-stat">Latest CT observation <time datetime={ct.lastObservedAt}>{ct.lastObservedAt.slice(0,10)}</time></span>{/if}
              </div>
              {#if ct.hostnames.length}
                <div class="ct-hosts">
                  {#each ct.hostnames.slice(0,3) as host}<code>{host}</code>{/each}
                  {#if ct.hostnames.length>3}<details><summary>Show all {ct.hostnames.length} observed hostnames</summary><div class="ct-host-list">{#each ct.hostnames as host}<code>{host}</code>{/each}</div></details>{/if}
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
    {#if visible.length>300}<p class="limit">Showing the first 300 matching candidates. Refine the filter to inspect the remainder.</p>{/if}
  </section>
{/if}

<style>.controls{padding:22px}.profile-context{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 16px;padding:10px 12px;border:1px solid rgba(126,224,168,.3);border-radius:10px;background:rgba(126,224,168,.04);color:var(--muted);font-size:.72rem}.profile-context strong{color:var(--text)}.profile-context button{padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--accent)}.modes{display:flex;gap:6px;margin-bottom:20px}.modes button,.toolbar button{padding:8px 12px;border:1px solid var(--border);border-radius:9px;color:var(--muted);background:var(--panel)}.modes button.active,.toolbar button.active{color:var(--accent);border-color:#7ee0a8;background:rgba(94,179,255,.1)}.fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(160px,.7fr) auto;gap:10px;align-items:end}.fields label{font-size:.72rem;font-weight:700}.fields input{display:block;margin-top:7px}.generation-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.generation-presets button{min-width:0;padding:10px 11px;border:1px solid var(--border);border-radius:9px;background:var(--panel);color:var(--muted);text-align:left}.generation-presets button:hover{border-color:rgba(126,224,168,.55)}.generation-presets button.active{border-color:var(--accent);background:rgba(126,224,168,.08);box-shadow:inset 3px 0 0 var(--accent)}.generation-presets strong,.generation-presets small{display:block}.generation-presets strong{color:var(--text);font-size:.72rem}.generation-presets button.active strong{color:var(--accent)}.generation-presets small{margin-top:4px;font-size:.62rem;line-height:1.45}.generation-options{display:flex;align-items:end;gap:12px;margin-top:10px}.generation-options label{min-width:150px;color:var(--text);font-size:.68rem;font-weight:700}.generation-options select{display:block;width:100%;margin-top:6px}.generation-options span{padding-bottom:9px;color:var(--muted);font-size:.64rem}.generation-estimate,.generation-limits{margin:9px 0 0;color:var(--muted);font-size:.66rem}.generation-estimate{color:var(--text)}.status{color:var(--muted);font-size:.78rem}.ct-history-notice{color:#f2b84b;font-size:.7rem}.ct-history{margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}.ct-history>summary{color:var(--accent);cursor:pointer;font-size:.7rem}.ct-history-list{display:grid;gap:7px;margin-top:10px}.ct-history article{display:flex;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--border);border-radius:9px;background:var(--panel)}.ct-history article strong,.ct-history article small{display:block}.ct-history article strong{overflow-wrap:anywhere}.ct-history article small{margin-top:3px;color:var(--muted);font-size:.62rem}.ct-history article>div:last-child{display:flex;gap:5px;align-items:center}.ct-history button{min-height:32px;padding:0 9px;border:1px solid var(--border);border-radius:7px;background:var(--panel-raised);font-size:.64rem}.ct-checks{margin-top:7px}.ct-checks summary{color:var(--accent);cursor:pointer;font-size:.62rem}.ct-checks ol{display:grid;gap:4px;margin:6px 0 0;padding-left:18px}.ct-checks li{font-size:.6rem}.ct-checks li span{display:block;color:var(--muted)}.ct-clear-history{margin-top:9px}.results{margin-top:16px;padding:22px}.results header{display:flex;justify-content:space-between;align-items:end;gap:16px}.results h2{margin:0}.toolbar{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,auto);gap:8px;margin:18px 0 12px}.candidate-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;align-items:start}.candidate{display:flex;gap:10px;min-width:0;padding:11px;border:1px solid var(--border);border-radius:10px;background:var(--panel)}.candidate.has-ct{align-items:flex-start}.candidate input{width:16px;min-height:auto;margin-top:2px}.candidate-body{flex:1;min-width:0}.candidate-body label{display:block;min-width:0;cursor:pointer}.candidate strong{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere}.candidate small{display:block;margin-top:4px;color:var(--muted);font-size:.65rem;text-transform:capitalize}.ct-new{display:inline-block;margin-top:6px;padding:3px 7px;border:1px solid rgba(126,224,168,.45);border-radius:99px;color:var(--accent);font-size:.6rem}.ct-meta{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:6px}.ct-stat{color:var(--muted);font-size:.63rem}.ct-stat time{color:var(--text)}.ct-hosts{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.ct-hosts code{padding:2px 6px;border:1px solid var(--border);border-radius:6px;background:rgba(15,17,21,.5);font-size:.62rem;overflow-wrap:anywhere;min-width:0}.ct-hosts details{width:100%}.ct-hosts summary{color:var(--accent);font-size:.63rem;cursor:pointer}.ct-host-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.ct-legacy{margin:0 0 12px;color:var(--muted);font-size:.7rem}.limit{color:var(--muted);font-size:.72rem}@media(max-width:700px){.fields,.toolbar,.candidate-list,.generation-presets{grid-template-columns:1fr}.generation-options{align-items:stretch;flex-direction:column;gap:4px}.generation-options label{width:100%}.generation-options span{padding-bottom:0}.modes{overflow:auto}.profile-context,.ct-history article{align-items:flex-start;flex-direction:column}.ct-history article>div:last-child{width:100%}.results header{display:block}.results header button{margin-top:14px}}</style>
