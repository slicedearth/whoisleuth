<script lang="ts">
  import { onMount } from 'svelte';
  import BrandProfileList from '$lib/components/BrandProfileList.svelte';
  import BulkRelationships from '$lib/components/BulkRelationships.svelte';
  import EvidenceTimeline from '$lib/components/EvidenceTimeline.svelte';
  import LookupAssessment from '$lib/components/LookupAssessment.svelte';
  import LookupDnsEvidence from '$lib/components/LookupDnsEvidence.svelte';
  import LookupHttpEvidence from '$lib/components/LookupHttpEvidence.svelte';
  import LookupNetworkContext from '$lib/components/LookupNetworkContext.svelte';
  import LookupRegistrySources from '$lib/components/LookupRegistrySources.svelte';
  import LookupSecurityPosture from '$lib/components/LookupSecurityPosture.svelte';
  import LookupSecurityTxt from '$lib/components/LookupSecurityTxt.svelte';
  import LookupTechnologyProfile from '$lib/components/LookupTechnologyProfile.svelte';
  import LookupTlsEvidence from '$lib/components/LookupTlsEvidence.svelte';
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import {
    buildSyntheticDemoExport, createSyntheticDemoState, MAX_SYNTHETIC_DEMO_NOTE_LENGTH,
    normalizeSyntheticDemoState, SYNTHETIC_DEMO_CANDIDATES, SYNTHETIC_DEMO_PROFILE,
    SYNTHETIC_DEMO_STAGES, SYNTHETIC_DEMO_STORAGE_KEY, SYNTHETIC_DEMO_VERSION,
    syntheticDemoCandidate, syntheticDemoCaseRecord, syntheticDemoLookupView,
    syntheticDemoRelationshipGroups, syntheticDemoStage,
  } from '$lib/analysis/demo-model.js';

  type View='dashboard'|'brands'|'discover'|'bulk'|'lookup'|'monitor';
  type CandidateFilter='all'|'high'|'related';

  let demoState:ReturnType<typeof createSyntheticDemoState>=$state(createSyntheticDemoState());
  let view=$state<View>('dashboard');
  let message=$state('');
  let candidateFilter=$state<CandidateFilter>('all');
  let relatedDomains=$state<string[]>([]);
  const selected=$derived(syntheticDemoCandidate(demoState.selectedCandidateId));
  const candidates=$derived(candidateFilter==='high'
    ?SYNTHETIC_DEMO_CANDIDATES.filter((candidate)=>candidate.risk>=70)
    :candidateFilter==='related'
      ?SYNTHETIC_DEMO_CANDIDATES.filter((candidate)=>relatedDomains.includes(candidate.domain))
      :SYNTHETIC_DEMO_CANDIDATES);
  const lookupView=$derived(selected?syntheticDemoLookupView(selected.id):null);
  const caseRecord=$derived(syntheticDemoCaseRecord(demoState));
  const relationshipGroups=$derived(syntheticDemoRelationshipGroups());

  onMount(()=>{
    let stored:string|null;
    try{stored=sessionStorage.getItem(SYNTHETIC_DEMO_STORAGE_KEY);}catch{demoState=createSyntheticDemoState();message='Tab storage is unavailable. Demo progress will last only until this page closes.';return;}
    if(!stored)return;
    try{
      const parsed:unknown=JSON.parse(stored);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!('version' in parsed)||(parsed as {version?:unknown}).version!==SYNTHETIC_DEMO_VERSION)throw new Error('Unsupported demo state');
      demoState=normalizeSyntheticDemoState(parsed);view=syntheticDemoStage(demoState) as View;
    }catch{
      demoState=createSyntheticDemoState();view='dashboard';
      try{sessionStorage.removeItem(SYNTHETIC_DEMO_STORAGE_KEY);message='Stored demo progress was invalid or unsupported and has been reset.';}catch{message='Stored demo progress was invalid and could not be cleared. Closing this tab will remove it.';}
    }
  });

  function available(target:View){
    return target==='dashboard'
      ||(target==='brands'&&demoState.started)
      ||(target==='discover'&&demoState.profileReady)
      ||(target==='bulk'&&demoState.candidatesReady)
      ||(target==='lookup'&&Boolean(demoState.selectedCandidateId))
      ||(target==='monitor'&&demoState.caseReady);
  }
  function save(patch:Record<string,unknown>,successMessage?:string){demoState=normalizeSyntheticDemoState({...demoState,...patch});try{sessionStorage.setItem(SYNTHETIC_DEMO_STORAGE_KEY,JSON.stringify(demoState));if(successMessage!==undefined)message=successMessage;}catch{message='Progress updated in memory, but tab storage is unavailable. Reloading will reset the demo.';}}
  function start(){save({started:true},'Guided synthetic investigation started.');view='brands';}
  function loadProfile(){save({profileReady:true},'Synthetic profile loaded. No production profile was created.');view='discover';}
  function generate(){save({candidatesReady:true},'Loaded three fixed synthetic candidates without making an investigation request.');view='bulk';}
  function inspect(id:string){save({selectedCandidateId:id,caseReady:false,caseStatus:'new',note:'',followUpReady:false},'Opened bounded fixture evidence.');view='lookup';}
  function openCase(){save({caseReady:true},'Created an isolated synthetic case in this tab only.');view='monitor';}
  function loadFollowUp(){save({followUpReady:true,caseStatus:'monitoring'},'Loaded a fixed later observation without making an investigation request.');}
  function loadRelated(domains:string[]){relatedDomains=[...domains];candidateFilter='related';message=`Focused ${domains.length} synthetic related domains.`;}
  function updateCase(patch:Record<string,unknown>,announce=true){save(patch,announce?'Synthetic case updated.':undefined);}
  function shortDate(value:string|null){return value?value.slice(0,10):'Not observed';}
  function formatDate(value:string){return value.slice(0,10);}
  function reset(){demoState=createSyntheticDemoState();view='dashboard';candidateFilter='all';relatedDomains=[];try{sessionStorage.removeItem(SYNTHETIC_DEMO_STORAGE_KEY);message='Synthetic demo reset.';}catch{message='Demo reset in memory, but tab storage could not be cleared. Closing this tab will remove its demo state.';}}
  function exportCase(){const payload=buildSyntheticDemoExport(demoState,new Date().toISOString());const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='whoisleuth-synthetic-demo-case.json';anchor.click();URL.revokeObjectURL(url);message='Synthetic case report created. It is clearly marked as demonstration data.';}
</script>

<PublicSeo
  title="Domain investigation demo | WHOISleuth"
  description="Explore a representative WHOISleuth investigation with fixed synthetic evidence and no live target requests."
  path="/demo"
/>

<section class="demo-hero">
  <p class="eyebrow">Public synthetic demo</p>
  <h1>Use the investigation workflow without touching a live target.</h1>
  <p>Move through representative versions of Dashboard, Brands, Discover, Bulk, Lookup, and Monitor using fixed fictional evidence on reserved domains.</p>
  <div class="synthetic-flag">Synthetic fixtures · No live findings</div>
</section>

<nav class="demo-steps card" aria-label="Synthetic investigation stages">
  {#each SYNTHETIC_DEMO_STAGES as item}<button type="button" disabled={!available(item.id as View)} aria-current={view===item.id?'step':undefined} class:active={view===item.id} onclick={()=>view=item.id as View}>{item.label}</button>{/each}
</nav>
<div class="demo-actions"><button type="button" onclick={reset}>Reset demo</button><span role="status" aria-live="polite">{message}</span></div>

{#if view==='dashboard'}
  <section class="demo-panel card" aria-labelledby="dashboard-heading">
    <p class="eyebrow">Dashboard · Synthetic preview</p><h2 id="dashboard-heading">Choose a focused investigation task</h2>
    <p>The protected Dashboard normally summarizes browser-local work and opens each tool. These synthetic counts do not read production storage.</p>
    <div class="dashboard-summary"><article><span>Open cases</span><strong>0</strong></article><article><span>Watchlists</span><strong>0</strong></article><article><span>Brand profiles</span><strong>1 fixture</strong></article></div>
    <div class="tool-preview"><span>Brands</span><span>Discover</span><span>Bulk</span><span>Lookup</span><span>Monitor</span></div>
    <button class="primary" type="button" onclick={start}>Begin with Brands</button>
  </section>
{:else if view==='brands'}
  <section class="demo-panel card" aria-labelledby="brand-heading">
    <p class="eyebrow">Brands · Local profile</p><h2 id="brand-heading">Define the protected identity</h2>
    <p>The same read-only profile card used by the protected Brands tool renders this immutable fixture. It never enters the production profile store.</p>
    <div class="shared-profile"><BrandProfileList profiles={[SYNTHETIC_DEMO_PROFILE]} activeId={SYNTHETIC_DEMO_PROFILE.id} {formatDate} readOnly /></div>
    <dl><div><dt>Products</dt><dd>{SYNTHETIC_DEMO_PROFILE.productNames.join(', ')}</dd></div><div><dt>Preferred coverage</dt><dd>{SYNTHETIC_DEMO_PROFILE.tlds.join(', ')}</dd></div><div><dt>Baseline title</dt><dd>{SYNTHETIC_DEMO_PROFILE.pageBaseline?.pageTitle}</dd></div><div><dt>Canonical host</dt><dd>{SYNTHETIC_DEMO_PROFILE.pageBaseline?.canonicalHost}</dd></div></dl>
    <button class="primary" type="button" onclick={loadProfile}>Use synthetic profile</button>
  </section>
{:else if view==='discover'}
  <section class="demo-panel card" aria-labelledby="discover-heading">
    <p class="eyebrow">Discover · Candidate generation</p><h2 id="discover-heading">Generate bounded candidate coverage</h2>
    <p>Discover combines explicit mutation families with separately attributed Certificate Transparency search results. This action only reveals three local fixtures.</p>
    <div class="configuration-grid"><article><span>Seed</span><strong>Northstar</strong></article><article><span>Mutation families</span><strong>Character · term · TLD</strong></article><article><span>Candidate cap</span><strong>3 synthetic records</strong></article></div>
    <div class="preview-list"><span>Character edit</span><span>Impersonation term</span><span>Alternate TLD</span><span>CT provenance</span></div>
    <button class="primary" type="button" onclick={generate}>Load synthetic candidates</button>
  </section>
{:else if view==='bulk'}
  <section class="demo-panel" aria-labelledby="bulk-heading">
    <p class="eyebrow">Bulk · Explainable triage</p><h2 id="bulk-heading">Prioritize candidates without collapsing evidence</h2>
    <p>Risk values and relationships are fixed demonstrations. They prioritize review but do not assert ownership, coordination, intent, or maliciousness.</p>
    <div class="filter-bar" aria-label="Candidate filters"><button class:active={candidateFilter==='all'} aria-pressed={candidateFilter==='all'} onclick={()=>candidateFilter='all'}>All candidates · 3</button><button class:active={candidateFilter==='high'} aria-pressed={candidateFilter==='high'} onclick={()=>candidateFilter='high'}>High priority · 1</button>{#if candidateFilter==='related'}<button class="active" aria-pressed="true">Related domains · {relatedDomains.length}</button>{/if}</div>
    <div class="candidate-grid">{#each candidates as candidate}<article class="candidate card"><div><code>{candidate.domain}</code><span class:high={candidate.risk>=70}>Risk {candidate.risk}</span></div><p>{candidate.mutation} · {candidate.availability}</p><ul>{#each candidate.signals as signal}<li>{signal}</li>{/each}</ul><details><summary>Why this score</summary><ul>{#each candidate.riskFactors as factor}<li>{factor.label} · +{factor.points}</li>{/each}</ul></details>{#if candidate.provenance.certificateCount}<p class="provenance">{candidate.provenance.source} · {candidate.provenance.certificateCount} certificates · latest {shortDate(candidate.provenance.lastObservedAt)}</p>{/if}<button type="button" onclick={()=>inspect(candidate.id)}>Inspect {candidate.domain}</button></article>{/each}</div>
    <BulkRelationships groups={relationshipGroups} truncated={false} limitations={['Shared infrastructure is investigation context only. It does not establish ownership, coordination, intent, or maliciousness.']} loadDomains={loadRelated} />
  </section>
{:else if view==='lookup'&&selected&&lookupView}
  <section class="demo-panel" aria-labelledby="lookup-heading">
    <p class="eyebrow">Lookup · Deep evidence review</p><h2 id="lookup-heading">{selected.domain}</h2>
    <p>The production Lookup components render the synthetic view model below. The fixed scenario includes the explicitly selected security.txt action. Each source and derived view remains separately attributed, while inconclusive enrichment is never treated as evidence of absence or safety.</p>
    <div class="shared-evidence"><LookupAssessment {...lookupView.assessment} /></div>
    <div class="shared-evidence"><LookupRegistrySources {...lookupView.registry} /></div>
    <div class="shared-evidence"><LookupDnsEvidence {...lookupView.dns} /></div>
    <div class="shared-evidence"><LookupHttpEvidence {...lookupView.http} /></div>
    <div class="shared-evidence"><LookupSecurityTxt {...lookupView.securityTxt} /></div>
    <div class="shared-evidence"><LookupSecurityPosture {...lookupView.securityPosture} /></div>
    <div class="shared-evidence"><LookupTechnologyProfile {...lookupView.technology} /></div>
    <div class="shared-evidence"><LookupTlsEvidence {...lookupView.tls} /></div>
    <div class="shared-evidence"><LookupNetworkContext {...lookupView.network} /></div>
    {#if selected.relationship}<div class="limitation info"><strong>Relationship context</strong><p>{selected.relationship.label} <code>{selected.relationship.value}</code> appears in {selected.relationship.relatedCandidates} synthetic candidates. Shared infrastructure is not proof of common ownership.</p></div>{/if}
    <div class="limitation"><strong>Interpretation limit</strong><p>These values demonstrate source attribution and explainability only. A live result would still require analyst review.</p></div>
    <button class="primary" type="button" onclick={openCase}>Open synthetic case in Monitor</button>
  </section>
{:else if view==='monitor'&&selected&&caseRecord}
  <section class="demo-panel card" aria-labelledby="monitor-heading">
    <p class="eyebrow">Monitor · Isolated case</p><h2 id="monitor-heading">Document and revisit {selected.domain}</h2>
    <p>This case and timeline use only the demo's tab-scoped key. They never appear in production cases, watchlists, campaigns, or hosted monitoring.</p>
    <div class="case-grid"><label>Status<select value={demoState.caseStatus} onchange={(event)=>updateCase({caseStatus:(event.currentTarget as HTMLSelectElement).value})}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="monitoring">Monitoring</option></select></label><label>Analyst note<textarea maxlength={MAX_SYNTHETIC_DEMO_NOTE_LENGTH} value={demoState.note} oninput={(event)=>updateCase({note:(event.currentTarget as HTMLTextAreaElement).value},false)} placeholder="Optional synthetic note"></textarea></label></div>
    {#if !demoState.followUpReady}<div class="follow-up"><p>Load a fixed repeated observation and later material change to exercise the production evidence-history comparison.</p><button class="primary" type="button" onclick={loadFollowUp}>Load later synthetic observation</button></div>{/if}
    <div class="shared-timeline">{#key `${caseRecord.id}:${caseRecord.evidenceHistory.length}`}<EvidenceTimeline record={caseRecord} />{/key}</div>
    {#if demoState.followUpReady}<div class="case-actions"><button class="primary" type="button" onclick={exportCase}>Export synthetic case report</button><button type="button" onclick={()=>view='lookup'}>Review Lookup evidence</button></div><p class="export-warning">Exports use a distinct schema, include <code>synthetic: true</code>, and must not be used as evidence or an abuse report.</p>{/if}
  </section>
{/if}

<section class="demo-footer"><div><p>Ready for live investigation?</p><PublicConsoleCta /></div><p><a href="/">Return to the public overview</a></p></section>

<style>
  .demo-actions button,.candidate button,.case-actions button,.filter-bar button{padding:9px 13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);font:700 var(--text-xs) var(--mono)}
  .demo-hero{max-width:900px}.demo-hero h1{margin:.25rem 0;font:700 clamp(1.9rem,4.4vw,3.1rem) var(--mono);letter-spacing:-.05em}.demo-hero>p:not(.eyebrow){max-width:78ch;color:var(--muted);line-height:1.6}.synthetic-flag{display:inline-block;margin-top:9px;padding:7px 10px;border:1px solid var(--amber);border-radius:999px;color:var(--amber);font:700 var(--text-2xs) var(--mono)}
  .demo-steps{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;margin:30px 0 12px;padding:5px}.demo-steps button{min-height:42px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font-size:var(--text-xs)}.demo-steps button.active{background:rgb(var(--accent2-rgb) / .1);color:var(--accent2)}
  .demo-actions{display:flex;min-height:40px;align-items:center;gap:14px;margin-bottom:18px}.demo-actions span{color:var(--muted);font-size:var(--text-xs)}
  .demo-panel{padding:clamp(22px,4vw,38px)}.demo-panel:not(.card){padding-inline:0}.demo-panel>h2{margin:.25rem 0 8px;font:700 clamp(1.4rem,3vw,2rem) var(--mono)}.demo-panel>p:not(.eyebrow),.candidate p,.export-warning,.follow-up p{color:var(--muted);line-height:1.55}
  .demo-panel dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:24px 0}.demo-panel dl div{min-width:0;padding:14px;border:1px solid var(--border)}dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}dd{margin:6px 0 0;overflow-wrap:anywhere}code{color:var(--accent);font-family:var(--mono)}
  .dashboard-summary,.configuration-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:24px 0}.dashboard-summary article,.configuration-grid article{padding:15px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.dashboard-summary span,.configuration-grid span{display:block;color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.dashboard-summary strong,.configuration-grid strong{display:block;margin-top:7px;overflow-wrap:anywhere}.tool-preview,.preview-list{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}.tool-preview span,.preview-list span{padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-xs)}
  .shared-profile,.shared-evidence,.shared-timeline{margin-top:18px}.shared-profile{margin-bottom:18px}.shared-evidence+.shared-evidence{margin-top:12px}
  .filter-bar{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 12px}.filter-bar button.active{border-color:var(--accent2);color:var(--accent2);background:rgb(var(--accent2-rgb) / .08)}.candidate-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.candidate{display:flex;min-width:0;flex-direction:column;padding:18px}.candidate>div{display:flex;align-items:flex-start;flex-direction:column;gap:8px}.candidate code{overflow-wrap:anywhere;font-size:.9rem}.candidate span{color:var(--amber);font:700 var(--text-xs) var(--mono)}.candidate span.high{color:var(--danger)}.candidate ul{padding-left:19px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.candidate details{margin-bottom:12px}.candidate summary{color:var(--accent);cursor:pointer;font-size:var(--text-xs)}.candidate .provenance{padding:9px;border-left:2px solid var(--border);font-size:var(--text-2xs)}.candidate button{width:100%;margin-top:auto;color:var(--text)}
  .limitation{margin:20px 0;padding:14px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .04)}.limitation.info{border-left-color:var(--accent)}.limitation p{margin:5px 0 0;color:var(--muted)}
  .case-grid{display:grid;grid-template-columns:minmax(180px,.45fr) minmax(0,1fr);gap:12px;margin-top:22px}.demo-panel label{display:block;color:var(--muted);font-size:var(--text-xs)}.demo-panel select,.demo-panel textarea{display:block;margin-top:7px;padding:10px}.demo-panel textarea{min-height:110px;resize:vertical}.follow-up{margin-top:22px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.follow-up p{margin:0 0 10px}.case-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.case-actions .primary{color:var(--primary-text);background:linear-gradient(135deg,var(--primary-start),var(--primary-end))}
  .demo-footer{display:flex;justify-content:space-between;gap:20px;margin-top:45px;padding-top:18px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-2xs)}.demo-footer>div{display:flex;align-items:center;gap:10px}.demo-footer p{margin:0}.demo-footer a{color:var(--accent)}
  @media(max-width:840px){.demo-steps{grid-template-columns:repeat(3,minmax(0,1fr))}.candidate-grid{grid-template-columns:1fr}.dashboard-summary,.configuration-grid{grid-template-columns:1fr}}
  @media(max-width:760px){.demo-steps{grid-template-columns:1fr}.demo-steps button{text-align:left}.demo-actions,.demo-footer,.demo-footer>div{align-items:flex-start;flex-direction:column}.demo-panel dl,.case-grid{grid-template-columns:1fr}}
</style>
