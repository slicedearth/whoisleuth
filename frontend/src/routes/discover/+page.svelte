<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { generateTyposquatCandidates, MUTATION_LABELS } from '../../../../public/js/typosquat-generator.js';
  import { activeProfile, isDomainAllowlisted, type BrandProfile } from '$lib/brand-profiles';
  import { saveCandidateHandoff, type Candidate } from '$lib/candidate-handoff';

  type Mode = 'typosquat' | 'keyword' | 'certificate-transparency';
  let mode = $state<Mode>('typosquat');
  let seed = $state('');
  let tldText = $state('com, net, org');
  let candidates = $state<Candidate[]>([]);
  let selected = $state<Set<string>>(new Set());
  let status = $state('');
  let error = $state('');
  let searching = $state(false);
  let filter = $state('');
  let profile = $state<BrandProfile|null>(null);
  const mutationLabels = MUTATION_LABELS as Record<string, string>;

  const visible = $derived(candidates.filter((c) => !filter || c.domain.includes(filter.trim().toLowerCase())));
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

  function setResults(next: Candidate[], message: string) {
    candidates = next;
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

  function generate() {
    if (!seed.trim()) { error = 'Enter a brand, domain, or keyword.'; return; }
    if (!tlds().length && !seed.includes('.')) { error = 'Enter at least one valid TLD.'; return; }
    if (mode === 'keyword') {
      const { filtered, excluded } = withoutAllowlisted(generateKeywordCandidates());
      setResults(filtered, `Generated ${filtered.length} naming candidates${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}.`);
      return;
    }
    const generated = generateTyposquatCandidates(seed, tlds()) as Array<{domain:string;source:string;mutationTypes:string[]}>;
    const { filtered, excluded } = withoutAllowlisted(generated);
    setResults(filtered, `Generated ${filtered.length} explainable lookalike variants${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}.`);
  }

  async function searchCt() {
    if (!seed.trim()) { error = 'Enter a brand or keyword to search.'; return; }
    searching = true; error = ''; status = 'Searching Certificate Transparency logs…';
    try {
      const response = await fetch(`/api/ct-search?q=${encodeURIComponent(seed.trim())}`);
      const body = await response.json().catch(() => ({})) as {domains?:string[];certCount?:number;truncated?:boolean;error?:string};
      if (!response.ok) throw new Error(body.error || `Search failed (${response.status})`);
      const next = (body.domains || []).map((domain) => ({ domain, source: seed.trim(), mutationTypes: ['certificate_transparency'] }));
      const { filtered, excluded } = withoutAllowlisted(next);
      setResults(filtered, `Found ${filtered.length} untrusted hostnames from ${body.certCount || 0} certificates${excluded ? `; excluded ${excluded} trusted profile domain${excluded===1?'':'s'}` : ''}${body.truncated ? ' (result cap reached)' : ''}.`);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Certificate search failed'; status = '';
    } finally { searching = false; }
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
    saveCandidateHandoff(mode, selectedCandidates);
    await goto('/bulk?source=discover');
  }
</script>

<svelte:head><title>Discover · WHOISleuth</title></svelte:head>
<section class="heading"><div><p class="eyebrow">Discover</p><h1>Candidate discovery</h1><p>Generate explainable lookalikes, brainstorm defensive registrations, or search public certificate logs.</p></div></section>

<section class="controls card">
  {#if profile}<div class="profile-context"><span>Active profile: <strong>{profile.name}</strong></span><button onclick={useProfile}>Use profile defaults</button></div>{/if}
  <div class="modes" role="tablist" aria-label="Discovery method">
    <button class:active={mode==='typosquat'} onclick={()=>{mode='typosquat';candidates=[]}}>Lookalikes</button>
    <button class:active={mode==='keyword'} onclick={()=>{mode='keyword';candidates=[]}}>Name ideas</button>
    <button class:active={mode==='certificate-transparency'} onclick={()=>{mode='certificate-transparency';candidates=[]}}>Certificates</button>
  </div>
  <div class="fields">
    <label>{mode==='keyword' ? 'Keyword' : mode==='certificate-transparency' ? 'Brand or certificate keyword' : 'Brand or domain'}<input bind:value={seed} placeholder={mode==='typosquat'?'example.com':'Example brand'}></label>
    {#if mode!=='certificate-transparency'}<label>TLDs<input bind:value={tldText} placeholder="com, net, org"></label>{/if}
    <button class="primary" onclick={mode==='certificate-transparency'?searchCt:generate} disabled={searching}>{searching?'Searching…':mode==='certificate-transparency'?'Search certificates':'Generate candidates'}</button>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{:else if status}<p class="status">{status}</p>{/if}
</section>

{#if candidates.length}
  <section class="results card">
    <header><div><p class="eyebrow">Candidates</p><h2>{selected.size} selected of {candidates.length}</h2></div><button class="primary" onclick={sendToBulk} disabled={!selected.size}>Continue to Bulk</button></header>
    <div class="toolbar"><input bind:value={filter} aria-label="Filter candidates" placeholder="Filter candidates"><button onclick={()=>selectVisible(true)}>Select visible</button><button onclick={()=>selectVisible(false)}>Clear visible</button></div>
    <div class="candidate-list">
      {#each visible.slice(0, 300) as candidate}
        <label class="candidate"><input type="checkbox" checked={selected.has(candidate.domain)} onchange={()=>toggle(candidate.domain)}><span><strong>{candidate.domain}</strong><small>{candidate.mutationTypes.map((type)=>mutationLabels[type] || type.replaceAll('_',' ')).join(' · ')}</small></span></label>
      {/each}
    </div>
    {#if visible.length>300}<p class="limit">Showing the first 300 matching candidates. Refine the filter to inspect the remainder.</p>{/if}
  </section>
{/if}

<style>.controls{padding:22px}.profile-context{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 16px;padding:10px 12px;border:1px solid #4c8d8a66;border-radius:10px;background:#63d6c50c;color:var(--muted);font-size:.72rem}.profile-context strong{color:var(--text)}.profile-context button{padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:#0b1726;color:var(--accent)}.modes{display:flex;gap:6px;margin-bottom:20px}.modes button,.toolbar button{padding:8px 12px;border:1px solid var(--border);border-radius:9px;color:var(--muted);background:#0b1726}.modes button.active{color:var(--accent);border-color:#4c8d8a;background:#63d6c51a}.fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(160px,.7fr) auto;gap:10px;align-items:end}.fields label{font-size:.72rem;font-weight:700}.fields input{display:block;margin-top:7px}.status{color:var(--muted);font-size:.78rem}.results{margin-top:16px;padding:22px}.results header{display:flex;justify-content:space-between;align-items:end;gap:16px}.results h2{margin:0}.toolbar{display:grid;grid-template-columns:1fr auto auto;gap:8px;margin:18px 0 12px}.candidate-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.candidate{display:flex;gap:10px;min-width:0;padding:11px;border:1px solid var(--border);border-radius:10px;background:#0a1624}.candidate input{width:16px;min-height:auto}.candidate span,.candidate strong,.candidate small{display:block;min-width:0}.candidate strong{overflow:hidden;text-overflow:ellipsis}.candidate small{margin-top:4px;color:var(--muted);font-size:.65rem;text-transform:capitalize}.limit{color:var(--muted);font-size:.72rem}@media(max-width:700px){.fields,.toolbar,.candidate-list{grid-template-columns:1fr}.modes{overflow:auto}.profile-context{align-items:flex-start;flex-direction:column}.results header{display:block}.results header button{margin-top:14px}}</style>
