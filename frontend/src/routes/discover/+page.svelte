<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { generateTyposquatCandidates, MUTATION_LABELS } from '$lib/analysis/typosquat-generator.js';
  import { activeProfile, isDomainAllowlisted, type BrandProfile } from '$lib/brand-profiles';
  import { saveCandidateHandoff, type Candidate } from '$lib/candidate-handoff';
  import { normalizeCtResponse, ctCandidateMatchesFilter } from '$lib/analysis/ct-results.js';

  type Mode = 'typosquat' | 'keyword' | 'certificate-transparency';
  let mode = $state<Mode>('typosquat');
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

  const visible = $derived(candidates.filter((c) => ctCandidateMatchesFilter(c, filter)));
  const selectedCandidates = $derived(candidates.filter((c) => selected.has(c.domain)));

  onMount(() => { profile = activeProfile(); });

  function tlds() {
    return [...new Set(tldText.split(/[;,\s]+/).map((v) => v.trim().toLowerCase().replace(/^\./, '')).filter((v) => /^[a-z]{2,63}$/.test(v)))];
  }

  function generateKeywordCandidates(): Candidate[] {
    const words = seed.trim().toLowerCase().split(/\s+/).map((v) => v.replace(/[^a-z0-9-]/g, '')).filter(Boolean);
    if (!words.length) return [];
    const joined = words.join('');
    const bases = new Set([joined, words.join('-'), `get${joined}`, `my${joined}`, `${joined}hq`, `${joined}app`, `${joined}online`]);
    return [...bases].flatMap((base) => tlds().map((tld) => ({ domain: `${base}.${tld}`, source: seed.trim(), mutationTypes: ['keyword'] })));
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

  function selectMode(next:Mode){cancelCtSearch();mode=next;candidates=[];generatedContext=[];selected=new Set();status='';error='';ctResultKind=null;}
  function tabKeydown(event:KeyboardEvent){const order:Mode[]=['typosquat','keyword','certificate-transparency'];const current=order.indexOf(mode);let index=-1;if(event.key==='ArrowRight')index=(current+1)%order.length;else if(event.key==='ArrowLeft')index=(current+order.length-1)%order.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=order.length-1;if(index<0)return;event.preventDefault();selectMode(order[index]);requestAnimationFrame(()=>document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus());}

  function generate() {
    cancelCtSearch(); ctResultKind = null;
    if (!seed.trim()) { error = 'Enter a brand, domain, or keyword.'; return; }
    if (!tlds().length && !seed.includes('.')) { error = 'Enter at least one valid TLD.'; return; }
    if (mode === 'keyword') {
      const generated=generateKeywordCandidates();
      const { filtered, excluded } = withoutAllowlisted(generated);
      setResults(filtered, `Generated ${filtered.length} naming candidates${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}.`, generated);
      return;
    }
    const generated = generateTyposquatCandidates(seed, tlds()) as Array<{domain:string;source:string;mutationTypes:string[]}>;
    const { filtered, excluded } = withoutAllowlisted(generated);
    setResults(filtered, `Generated ${filtered.length} explainable lookalike variants${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}.`, generated);
  }

  async function searchCt() {
    if (!seed.trim()) { error = 'Enter a brand or keyword to search.'; return; }
    // Supersede and abort any earlier in-flight search before starting.
    cancelCtSearch();
    const token = searchToken;
    const controller = new AbortController();
    ctController = controller;
    const query = seed.trim();
    searching = true; error = ''; status = 'Searching Certificate Transparency logs…';
    try {
      const response = await fetch(`/api/ct-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (token !== searchToken) return; // a newer search or a mode switch superseded this one
      if (!response.ok) throw new Error((body.error as string) || `Search failed (${response.status})`);
      const { candidates: next, usedStructuredMatches, certCount, truncated } = normalizeCtResponse(body, query);
      const { filtered, excluded } = withoutAllowlisted(next);
      ctResultKind = usedStructuredMatches ? 'structured' : 'legacy';
      const noun = usedStructuredMatches ? 'registrable domain' : 'observed hostname';
      setResults(filtered, `Found ${filtered.length} ${noun}${filtered.length===1?'':'s'} from ${certCount} certificate${certCount===1?'':'s'}${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}${truncated ? ' (result cap reached)' : ''}.`, next);
    } catch (cause) {
      // A superseding search / mode switch (which aborts this fetch) owns the UI
      // state now; do nothing so we neither clear its results nor its loading flag.
      if (token !== searchToken) return;
      // Clear any prior results so stale metadata is never shown as belonging
      // to this failed query.
      ctResultKind = null; candidates = []; generatedContext = []; selected = new Set();
      error = cause instanceof Error ? cause.message : 'Certificate search failed'; status = '';
    } finally {
      if (token === searchToken) { searching = false; ctController = null; }
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
<section class="heading"><div><p class="eyebrow">Discover</p><h1>Candidate discovery</h1><p>Generate explainable lookalikes, brainstorm defensive registrations, or search public certificate logs.</p></div></section>

<section class="controls card">
  {#if profile}<div class="profile-context"><span>Active profile: <strong>{profile.name}</strong></span><button onclick={useProfile}>Use profile defaults</button></div>{/if}
  <div class="modes" role="tablist" aria-label="Discovery method">
    <button role="tab" aria-selected={mode==='typosquat'} tabindex={mode==='typosquat'?0:-1} class:active={mode==='typosquat'} onclick={()=>selectMode('typosquat')} onkeydown={tabKeydown}>Lookalikes</button>
    <button role="tab" aria-selected={mode==='keyword'} tabindex={mode==='keyword'?0:-1} class:active={mode==='keyword'} onclick={()=>selectMode('keyword')} onkeydown={tabKeydown}>Name ideas</button>
    <button role="tab" aria-selected={mode==='certificate-transparency'} tabindex={mode==='certificate-transparency'?0:-1} class:active={mode==='certificate-transparency'} onclick={()=>selectMode('certificate-transparency')} onkeydown={tabKeydown}>Certificates</button>
  </div>
  <div class="fields">
    <label>{mode==='keyword' ? 'Keyword' : mode==='certificate-transparency' ? 'Brand or certificate keyword' : 'Brand or domain'}<input bind:value={seed} placeholder={mode==='typosquat'?'example.com':'Example brand'}></label>
    {#if mode!=='certificate-transparency'}<label>TLDs<input bind:value={tldText} placeholder="com, net, org"></label>{/if}
    <button class="primary" onclick={mode==='certificate-transparency'?searchCt:generate} disabled={searching}>{searching?'Searching…':mode==='certificate-transparency'?'Search certificates':'Generate candidates'}</button>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{:else if status}<p class="status" role="status" aria-live="polite">{status}</p>{/if}
</section>

{#if candidates.length}
  <section class="results card">
    <header><div><p class="eyebrow">Candidates</p><h2>{selected.size} selected of {candidates.length}</h2></div><button class="primary" onclick={sendToBulk} disabled={!selected.size}>Continue to Bulk</button></header>
    <div class="toolbar"><input bind:value={filter} aria-label="Filter candidates" placeholder={ctResultKind==='structured'?'Filter by domain or observed hostname':'Filter candidates'}><button onclick={()=>selectVisible(true)}>Select visible</button><button onclick={()=>selectVisible(false)}>Clear visible</button></div>
    {#if ctResultKind==='legacy'}<p class="ct-legacy" role="note">Detailed certificate provenance was unavailable for this search; showing observed hostnames only.</p>{/if}
    <div class="candidate-list">
      {#each visible.slice(0, 300) as candidate, i (candidate.domain)}
        <div class="candidate" class:has-ct={candidate.certificateTransparency}>
          <input type="checkbox" id={`candidate-${i}`} checked={selected.has(candidate.domain)} onchange={()=>toggle(candidate.domain)}>
          <div class="candidate-body">
            <label for={`candidate-${i}`}><strong>{candidate.domain}</strong><small>{candidate.mutationTypes.map((type)=>mutationLabels[type] || type.replaceAll('_',' ')).join(' · ')}</small></label>
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

<style>.controls{padding:22px}.profile-context{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 16px;padding:10px 12px;border:1px solid rgba(126,224,168,.3);border-radius:10px;background:rgba(126,224,168,.04);color:var(--muted);font-size:.72rem}.profile-context strong{color:var(--text)}.profile-context button{padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--accent)}.modes{display:flex;gap:6px;margin-bottom:20px}.modes button,.toolbar button{padding:8px 12px;border:1px solid var(--border);border-radius:9px;color:var(--muted);background:var(--panel)}.modes button.active{color:var(--accent);border-color:#7ee0a8;background:rgba(94,179,255,.1)}.fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(160px,.7fr) auto;gap:10px;align-items:end}.fields label{font-size:.72rem;font-weight:700}.fields input{display:block;margin-top:7px}.status{color:var(--muted);font-size:.78rem}.results{margin-top:16px;padding:22px}.results header{display:flex;justify-content:space-between;align-items:end;gap:16px}.results h2{margin:0}.toolbar{display:grid;grid-template-columns:1fr auto auto;gap:8px;margin:18px 0 12px}.candidate-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;align-items:start}.candidate{display:flex;gap:10px;min-width:0;padding:11px;border:1px solid var(--border);border-radius:10px;background:var(--panel)}.candidate.has-ct{align-items:flex-start}.candidate input{width:16px;min-height:auto;margin-top:2px}.candidate-body{flex:1;min-width:0}.candidate-body label{display:block;min-width:0;cursor:pointer}.candidate strong{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere}.candidate small{display:block;margin-top:4px;color:var(--muted);font-size:.65rem;text-transform:capitalize}.ct-meta{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:6px}.ct-stat{color:var(--muted);font-size:.63rem}.ct-stat time{color:var(--text)}.ct-hosts{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.ct-hosts code{padding:2px 6px;border:1px solid var(--border);border-radius:6px;background:rgba(15,17,21,.5);font-size:.62rem;overflow-wrap:anywhere;min-width:0}.ct-hosts details{width:100%}.ct-hosts summary{color:var(--accent);font-size:.63rem;cursor:pointer}.ct-host-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.ct-legacy{margin:0 0 12px;color:var(--muted);font-size:.7rem}.limit{color:var(--muted);font-size:.72rem}@media(max-width:700px){.fields,.toolbar,.candidate-list{grid-template-columns:1fr}.modes{overflow:auto}.profile-context{align-items:flex-start;flex-direction:column}.results header{display:block}.results header button{margin-top:14px}}</style>
