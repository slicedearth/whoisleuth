<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import BrandProfileList from '$lib/components/BrandProfileList.svelte';
  import BulkRelationships from '$lib/components/BulkRelationships.svelte';
  import EvidenceTopology from '$lib/components/EvidenceTopology.svelte';
  import EvidenceTimeline from '$lib/components/EvidenceTimeline.svelte';
  import LookupLifecycle from '$lib/components/LookupLifecycle.svelte';
  import LookupAcquisitionDueDiligence from '$lib/components/LookupAcquisitionDueDiligence.svelte';
  import LookupAssessment from '$lib/components/LookupAssessment.svelte';
  import LookupCollectionTiming from '$lib/components/LookupCollectionTiming.svelte';
  import LookupDnsEvidence from '$lib/components/LookupDnsEvidence.svelte';
  import LookupFamilySummary from '$lib/components/LookupFamilySummary.svelte';
  import LookupHttpEvidence from '$lib/components/LookupHttpEvidence.svelte';
  import LookupNetworkContext from '$lib/components/LookupNetworkContext.svelte';
  import LookupRegistrySources from '$lib/components/LookupRegistrySources.svelte';
  import LookupTlsEvidence from '$lib/components/LookupTlsEvidence.svelte';
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import {
    buildSyntheticDemoExport, createSyntheticDemoState, MAX_SYNTHETIC_DEMO_NOTE_LENGTH,
    normalizeSyntheticDemoState, parseSyntheticDemoState, SYNTHETIC_DEMO_CANDIDATES, SYNTHETIC_DEMO_PROFILE,
    SYNTHETIC_DEMO_STAGES, SYNTHETIC_DEMO_STORAGE_KEY,
    syntheticDemoCandidate, syntheticDemoCaseRecord, syntheticDemoLookupView,
    syntheticDemoRelationshipGroups, syntheticDemoStage, syntheticDemoTimeline,
  } from '$lib/analysis/demo-model.ts';
  import { buildAcquisitionDueDiligence } from '$lib/analysis/acquisition-due-diligence.ts';

  type View='dashboard'|'brands'|'discover'|'bulk'|'lookup'|'monitor';
  type CandidateFilter='all'|'high'|'related';
  type DemoVisualView='evidence'|'relationships'|'timeline';
  type LookupFamily='registration'|'web'|'relationships'|'quality'|'case'|null;

  let demoState:ReturnType<typeof createSyntheticDemoState>=$state(createSyntheticDemoState());
  let view=$state<View>('dashboard');
  let message=$state('');
  let candidateFilter=$state<CandidateFilter>('all');
  let relatedDomains=$state<string[]>([]);
  let demoVisualView=$state<DemoVisualView>('evidence');
  let lookupFamily=$state<LookupFamily>(null);
  let demoWorkspace=$state<HTMLElement|null>(null);
  let demoSteps=$state<HTMLElement|null>(null);
  let heldWorkspaceHeight=$state(0);
  let stageTransitioning=$state(false);
  let discoverPreviewReady=$state(false);
  let releaseWorkspaceHeightTimer:ReturnType<typeof setTimeout>|null=null;
  let releaseWorkspaceHeightListener:(()=>void)|null=null;
  const demoVisualTabs:readonly DemoVisualView[]=['evidence','relationships','timeline'];
  const selected=$derived(syntheticDemoCandidate(demoState.selectedCandidateId));
  const candidates=$derived(candidateFilter==='high'
    ?SYNTHETIC_DEMO_CANDIDATES.filter((candidate)=>candidate.risk>=70)
    :candidateFilter==='related'
      ?SYNTHETIC_DEMO_CANDIDATES.filter((candidate)=>relatedDomains.includes(candidate.domain))
      :SYNTHETIC_DEMO_CANDIDATES);
  const lookupView=$derived(selected?syntheticDemoLookupView(selected.id):null);

  function demoVisualTabKeydown(event:KeyboardEvent){
    const current=demoVisualTabs.indexOf(demoVisualView);let index=-1;
    if(event.key==='ArrowRight')index=(current+1)%demoVisualTabs.length;
    else if(event.key==='ArrowLeft')index=(current+demoVisualTabs.length-1)%demoVisualTabs.length;
    else if(event.key==='Home')index=0;
    else if(event.key==='End')index=demoVisualTabs.length-1;
    const next=demoVisualTabs[index];if(!next)return;
    event.preventDefault();demoVisualView=next;
    const tablist=(event.currentTarget as HTMLButtonElement).closest('[role="tablist"]');
    requestAnimationFrame(()=>tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus());
  }
  const demoSslbl=Object.freeze({
    status:'success',verdict:'not_listed',complete:true,
    detail:'The synthetic leaf certificate fingerprint was not present in the fixture snapshot.',
    fingerprint:'1111111111111111111111111111111111111111',referenceUrl:'',
    sourceUpdatedAt:'2026-07-20T00:00:00.000Z',generatedAt:'2026-07-20T01:00:00.000Z',
    entryCount:12000,digest:'2'.repeat(64),
    limitations:[
      'This is fixed fictional demo evidence and was not compared with the live SSLBL feed.',
      'No matching record is not evidence that a certificate, domain, or service is safe.',
    ],
  });
  const caseRecord=$derived(syntheticDemoCaseRecord(demoState));
  const lookupTopologyNodes=$derived(selected&&lookupView?[
    {id:'registry',label:'Registry',detail:selected.evidence.registry.status,status:lookupView.registry.rdapError?'partial':'success',href:'#demo-family-registration',side:'left' as const,glyph:'R',family:'registry' as const},
    {id:'dns',label:'DNS',detail:lookupView.dns.status,status:lookupView.dns.status,href:'#demo-family-web',side:'left' as const,glyph:'D',family:'network' as const},
    {id:'network',label:'Network',detail:lookupView.network.status,status:lookupView.network.status,href:'#demo-family-web',side:'left' as const,glyph:'N',family:'network' as const},
    {id:'http',label:'HTTP',detail:lookupView.http.status,status:lookupView.http.status,href:'#demo-family-web',side:'right' as const,glyph:'H',family:'web' as const},
    {id:'tls',label:'TLS',detail:lookupView.tls.status,status:lookupView.tls.status,href:'#demo-family-web',side:'right' as const,glyph:'T',family:'web' as const},
    {id:'sslbl',label:'Certificate warning data',detail:demoSslbl.verdict,status:demoSslbl.status,href:'#demo-family-web',side:'right' as const,glyph:'C',family:'web' as const},
    {id:'structured-identity',label:'Structured identity',detail:lookupView.structuredIdentity.status,status:lookupView.structuredIdentity.status,href:'#demo-family-web',side:'right' as const,glyph:'SI',family:'web' as const},
    {id:'technology',label:'Technology',detail:lookupView.technology.status,status:lookupView.technology.status,href:'#demo-family-web',side:'right' as const,glyph:'W',provenance:'derived' as const},
    {id:'assessment',label:'Assessment',detail:`Risk ${selected.risk}`,status:'warning',href:'#demo-assessment',side:'right' as const,glyph:'A',provenance:'derived' as const},
  ]:[]);
  const lookupEvidenceCheckNodes=$derived(lookupTopologyNodes.filter((node)=>node.id!=='assessment'));
  const lookupCompleteEvidenceCount=$derived(lookupEvidenceCheckNodes.filter((node)=>String(node.status).toLowerCase()==='success').length);
  const lookupLimitedEvidenceCount=$derived(lookupEvidenceCheckNodes.length-lookupCompleteEvidenceCount);
  const lookupLifecycleEvents=$derived(selected?[
    {id:'registration',label:'Registered',date:selected.evidence.registry.registeredAt==='Not observed'?null:selected.evidence.registry.registeredAt,detail:selected.evidence.registry.source,kind:'registry' as const},
    {id:'certificate-first-observed',label:'Certificate observed',date:selected.provenance.firstObservedAt,detail:selected.evidence.certificate.source,kind:'certificate' as const},
    {id:'latest-observation',label:'Latest observation',date:selected.provenance.lastObservedAt,detail:selected.provenance.source,kind:'observation' as const},
  ]:[]);
  const lookupAcquisitionReview=$derived(selected&&lookupView?buildAcquisitionDueDiligence({
    availability:{
      state:selected.availability.toLowerCase().replaceAll(' ','_'),
      confidence:selected.availability==='Unknown'?'low':'high',
      source:selected.availability==='Unknown'?null:'rdap',
    },
    registryInsights:lookupView.registry.insights,
    activationContext:{
      web:{state:lookupView.http.status==='success'?'response_observed':'inconclusive',label:lookupView.http.status==='success'?'Web response observed':'Web state inconclusive'},
      mail:{state:'inconclusive',label:'Mail state inconclusive'},
    },
  }):null);
  const monitorTimeline=$derived(selected?syntheticDemoTimeline(selected.id,demoState.followUpReady):[]);
  const relationshipGroups=$derived(syntheticDemoRelationshipGroups());
  const currentStageIndex=$derived(Math.max(0,SYNTHETIC_DEMO_STAGES.findIndex((stage)=>stage.id===view)));
  const stageDescriptions:Record<View,string>={
    dashboard:'Choose the investigation path and begin with a bounded synthetic brand profile.',
    brands:'Define the official identity and trusted comparison boundary.',
    discover:'Generate a small reviewable candidate set without contacting a target.',
    bulk:'Compare candidates consistently and choose one lead for deeper review.',
    lookup:'Inspect separately attributed evidence and its stated limitations.',
    monitor:'Retain the synthetic finding and compare a later fixed observation.',
  };
  const stageGuidance:Record<View,{task:string;decision:string;boundary:string}>={
    dashboard:{
      task:'Choose the smallest tool that answers the current question.',
      decision:'Start from a known identity before generating or investigating candidates.',
      boundary:'The fixture counts below do not read signed-in Console data.',
    },
    brands:{
      task:'Define the official names, products, domains, and page baseline.',
      decision:'Set the comparison boundary that later similarity signals refer back to.',
      boundary:'A profile is analyst context, not proof that a candidate is related or harmful.',
    },
    discover:{
      task:'Choose bounded mutation families and review how candidates were generated.',
      decision:'Create a small, explainable set for triage instead of treating every string as a lead.',
      boundary:'This public action reveals fixed fixtures and makes no target request.',
    },
    bulk:{
      task:'Compare compact evidence consistently, then select one candidate for deeper review.',
      decision:'Use explainable priority and exact shared observations to decide where to spend time.',
      boundary:'Scores and shared infrastructure do not establish ownership, intent, or maliciousness.',
    },
    lookup:{
      task:'Review authority-aware evidence by family, expanding only what supports the decision.',
      decision:'Separate observed facts, incomplete collection, derived assessment, and analyst judgment.',
      boundary:'No single source family is allowed to fill a gap in another family.',
    },
    monitor:{
      task:'Record an analyst decision, retain the evidence snapshot, and compare a later observation.',
      decision:'Distinguish what changed from what was merely observed again.',
      boundary:'The demo uses one tab-scoped synthetic record and never enters production monitoring.',
    },
  };

  onMount(()=>{
    let stored:string|null;
    try{stored=sessionStorage.getItem(SYNTHETIC_DEMO_STORAGE_KEY);}catch{demoState=createSyntheticDemoState();message='Tab storage is unavailable. Demo progress will last only until this page closes.';return;}
    if(!stored)return;
    const parsed=parseSyntheticDemoState(stored);
    if(parsed){demoState=parsed;view=syntheticDemoStage(demoState) as View;void tick().then(()=>centerActiveStage('auto'));}
    else{
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
  function complete(target:View){
    if(target==='dashboard')return demoState.started;
    if(target==='brands')return demoState.profileReady;
    if(target==='discover')return demoState.candidatesReady;
    if(target==='bulk')return Boolean(demoState.selectedCandidateId);
    if(target==='lookup')return demoState.caseReady;
    return demoState.followUpReady;
  }
  function stageStatus(target:View){
    if(view===target)return 'Current';
    if(complete(target))return 'Completed';
    if(available(target))return 'Available';
    return 'Upcoming';
  }
  function stageName(label:string){return label.replace(/^\d+\.\s*/u,'');}
  function save(patch:Record<string,unknown>,successMessage?:string){demoState=normalizeSyntheticDemoState({...demoState,...patch});try{sessionStorage.setItem(SYNTHETIC_DEMO_STORAGE_KEY,JSON.stringify(demoState));if(successMessage!==undefined)message=successMessage;}catch{message='Progress updated in memory, but tab storage is unavailable. Reloading will reset the demo.';}}
  function clearWorkspaceRelease(){
    if(releaseWorkspaceHeightTimer!==null){clearTimeout(releaseWorkspaceHeightTimer);releaseWorkspaceHeightTimer=null;}
    if(releaseWorkspaceHeightListener!==null){window.removeEventListener('scrollend',releaseWorkspaceHeightListener);releaseWorkspaceHeightListener=null;}
  }
  function releaseWorkspaceHeight(){clearWorkspaceRelease();heldWorkspaceHeight=0;stageTransitioning=false;}
  function centerActiveStage(behavior:ScrollBehavior){
    const activeStage=demoSteps?.querySelector<HTMLElement>('[aria-current="step"]');
    if(activeStage&&demoSteps)demoSteps.scrollTo({left:activeStage.offsetLeft-(demoSteps.clientWidth-activeStage.offsetWidth)/2,behavior});
  }
  async function goToStage(target:View){
    if(!available(target)||stageTransitioning)return;
    clearWorkspaceRelease();
    stageTransitioning=true;
    heldWorkspaceHeight=Math.ceil(demoWorkspace?.getBoundingClientRect().height??0);
    view=target;
    await tick();
    await new Promise<void>((resolve)=>requestAnimationFrame(()=>resolve()));
    demoWorkspace?.querySelector<HTMLElement>('[data-stage-heading]')?.focus({preventScroll:true});
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    centerActiveStage(reducedMotion?'auto':'smooth');
    const workspaceTop=demoWorkspace?.getBoundingClientRect().top??0;
    const workspaceMargin=demoWorkspace?Number.parseFloat(getComputedStyle(demoWorkspace).scrollMarginTop)||0:0;
    const needsScroll=Boolean(demoWorkspace)&&Math.abs(workspaceTop-workspaceMargin)>1;
    if(!reducedMotion&&needsScroll){
      releaseWorkspaceHeightListener=releaseWorkspaceHeight;
      window.addEventListener('scrollend',releaseWorkspaceHeightListener,{once:true});
      releaseWorkspaceHeightTimer=setTimeout(releaseWorkspaceHeight,1400);
    }
    demoWorkspace?.scrollIntoView({block:'start',behavior:reducedMotion?'auto':'smooth'});
    if(reducedMotion||!needsScroll)releaseWorkspaceHeight();
  }
  function start(){save({started:true},'Guided synthetic investigation started.');void goToStage('brands');}
  function loadProfile(){save({profileReady:true},'Synthetic profile loaded. No production profile was created.');void goToStage('discover');}
  function generate(){discoverPreviewReady=true;message='Loaded three fixed synthetic candidates without making an investigation request.';}
  function handoffCandidates(){save({candidatesReady:true},'Handed three reviewed synthetic candidates to Bulk triage.');void goToStage('bulk');}
  function inspect(id:string){save({selectedCandidateId:id,caseReady:false,caseStatus:'new',note:'',followUpReady:false},'Opened bounded fixture evidence.');demoVisualView='evidence';lookupFamily=null;void goToStage('lookup');}
  function openCase(){save({caseReady:true},'Created an isolated synthetic case in this tab only.');void goToStage('monitor');}
  function loadFollowUp(){save({followUpReady:true,caseStatus:'monitoring'},'Loaded a fixed later observation without making an investigation request.');}
  function loadRelated(domains:string[]){relatedDomains=[...domains];candidateFilter='related';message=`Focused ${domains.length} synthetic related domains.`;}
  function updateCase(patch:Record<string,unknown>,announce=true){save(patch,announce?'Synthetic case updated.':undefined);}
  function shortDate(value:string|null){return value?value.slice(0,10):'Not observed';}
  function formatDate(value:string){return value.slice(0,10);}
  function displayChangeValue(value:unknown){
    if(value===null||value===undefined||value==='')return 'Not observed';
    if(typeof value==='boolean')return value?'Observed':'Not observed';
    if(Array.isArray(value)){
      const rendered=value.slice(0,8).map((entry)=>{
        if(!entry||typeof entry!=='object')return String(entry);
        const record=entry as Record<string,unknown>;
        const label=typeof record.label==='string'?record.label:'Structured value';
        return typeof record.points==='number'?label+' (+'+record.points+')':label;
      }).join(', ');
      return rendered||'None';
    }
    if(typeof value==='object')return 'Structured evidence changed';
    return String(value).replaceAll('_',' ').slice(0,300);
  }
  function reset(){clearWorkspaceRelease();stageTransitioning=false;demoState=createSyntheticDemoState();discoverPreviewReady=false;candidateFilter='all';relatedDomains=[];demoVisualView='evidence';lookupFamily=null;try{sessionStorage.removeItem(SYNTHETIC_DEMO_STORAGE_KEY);message='Synthetic demo reset.';}catch{message='Demo reset in memory, but tab storage could not be cleared. Closing this tab will remove its demo state.';}void goToStage('dashboard');}
  function showLookupFamily(family:Exclude<LookupFamily,null>){lookupFamily=family;}
  function hideLookupFamily(family:Exclude<LookupFamily,null>){if(lookupFamily===family)lookupFamily=null;}
  async function navigateLookupEvidence(href:string){
    const families:Readonly<Record<string,LookupFamily>>={
      '#demo-assessment':null,
      '#demo-family-registration':'registration',
      '#demo-family-web':'web',
      '#demo-source-quality':'quality',
    };
    const family=families[href];
    if(family===undefined)return;
    lookupFamily=family;
    await tick();
    document.querySelector<HTMLElement>(href)?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function exportCase(){const payload=buildSyntheticDemoExport(demoState,new Date().toISOString());const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='whoisleuth-synthetic-demo-case.json';anchor.click();URL.revokeObjectURL(url);message='Synthetic case report created. It is clearly marked as demonstration data.';}
  onDestroy(clearWorkspaceRelease);
</script>

<PublicSeo
  title="Domain investigation demo | WHOISleuth"
  description="Explore a representative WHOISleuth investigation with fixed synthetic evidence and no live target requests."
  path="/demo"
/>

<section class="demo-hero" class:started={demoState.started}>
  <p class="eyebrow">Public synthetic demo</p>
  <h1><span class="hero-full-title">Explore a synthetic domain investigation.</span><span class="hero-compact-title">Synthetic investigation</span></h1>
  <p>Move through representative versions of Dashboard, Brands, Discover, Bulk, Lookup, and Monitor using fixed fictional evidence on reserved domains.</p>
  <div class="synthetic-flag">Synthetic fixtures · No live findings</div>
</section>

<nav class="demo-steps card" bind:this={demoSteps} aria-label="Synthetic investigation stages">
  {#each SYNTHETIC_DEMO_STAGES as item,index}
    <button
      type="button"
      disabled={!available(item.id as View)||stageTransitioning}
      aria-current={view===item.id?'step':undefined}
      class:active={view===item.id}
      class:complete={complete(item.id as View)}
      onclick={()=>void goToStage(item.id as View)}
    >
      <span class="stage-number" aria-hidden="true">{complete(item.id as View)&&view!==item.id?'✓':String(index+1).padStart(2,'0')}</span>
      <span class="stage-copy"><strong>{stageName(item.label)}</strong><small>{stageStatus(item.id as View)}</small></span>
    </button>
  {/each}
</nav>
<p class="demo-stage-summary" aria-live="polite"><strong>Stage {currentStageIndex+1} of {SYNTHETIC_DEMO_STAGES.length}</strong><span>{stageDescriptions[view]}</span></p>
<div class="demo-actions"><button type="button" onclick={reset}>Reset demo</button><span role="status" aria-live="polite">{message}</span></div>

<section
  id="demo-workspace"
  class="demo-workspace"
  bind:this={demoWorkspace}
  style:min-height={heldWorkspaceHeight?`${heldWorkspaceHeight}px`:undefined}
  aria-busy={stageTransitioning}
  aria-label={`${stageName(SYNTHETIC_DEMO_STAGES[currentStageIndex]?.label??view)} guided workspace`}
>
<div class="stage-guidance card" role="group" aria-label="What this stage teaches">
  <article><span>Task</span><p>{stageGuidance[view].task}</p></article>
  <article><span>Decision</span><p>{stageGuidance[view].decision}</p></article>
  <article><span>Boundary</span><p>{stageGuidance[view].boundary}</p></article>
</div>
<details class="mobile-stage-guidance card">
  <summary><strong>Stage guidance</strong><span>Why it matters</span></summary>
  <div><strong>Task</strong><p>{stageGuidance[view].task}</p></div>
  <div><strong>Decision</strong><p>{stageGuidance[view].decision}</p></div>
  <div><strong>Boundary</strong><p>{stageGuidance[view].boundary}</p></div>
</details>

{#if view==='dashboard'}
  <section class="demo-panel card" aria-labelledby="dashboard-heading">
    <p class="eyebrow">Dashboard · Synthetic preview</p><h2 id="dashboard-heading" data-stage-heading tabindex="-1">Choose a focused investigation task</h2>
    <p>The protected Dashboard normally summarises browser-local work and opens each tool. These synthetic counts do not read production storage.</p>
    <div class="dashboard-summary"><article><span>Open cases</span><strong>0</strong></article><article><span>Watchlists</span><strong>0</strong></article><article><span>Brand profiles</span><strong>1 fixture</strong></article></div>
    <div class="tool-preview"><span>Brands</span><span>Discover</span><span>Bulk</span><span>Lookup</span><span>Monitor</span></div>
    <button class="primary" type="button" disabled={stageTransitioning} onclick={start}>Begin with Brands</button>
  </section>
{:else if view==='brands'}
  <section class="demo-panel card" aria-labelledby="brand-heading">
    <p class="eyebrow">Brands · Local profile</p><h2 id="brand-heading" data-stage-heading tabindex="-1">Define the protected identity</h2>
    <p>This immutable fixture mirrors a protected Brands profile without entering the production profile store.</p>
    <div class="handoff-row profile-handoff"><p>Use this reviewed fixture as the comparison boundary for candidate generation.</p><button class="primary" type="button" disabled={stageTransitioning} onclick={loadProfile}>Use synthetic profile</button></div>
    <div class="shared-profile"><BrandProfileList profiles={[SYNTHETIC_DEMO_PROFILE]} activeId={SYNTHETIC_DEMO_PROFILE.id} {formatDate} readOnly /></div>
    <dl><div><dt>Products</dt><dd>{SYNTHETIC_DEMO_PROFILE.productNames.join(', ')}</dd></div><div><dt>Preferred coverage</dt><dd>{SYNTHETIC_DEMO_PROFILE.tlds.join(', ')}</dd></div></dl>
  </section>
{:else if view==='discover'}
  <section class="demo-panel card" aria-labelledby="discover-heading">
    <p class="eyebrow">Discover · Candidate generation</p><h2 id="discover-heading" data-stage-heading tabindex="-1">Generate bounded candidate coverage</h2>
    <p>Discover combines bounded local mutations with separately attributed Certificate Transparency results. Review each origin before handing a small set to Bulk; generated and observed names are different evidence.</p>
    <div class="configuration-grid"><article><span>Seed</span><strong>Northstar</strong></article><article><span>Selected families</span><strong>Character · term · TLD</strong></article><article><span>Candidate cap</span><strong>3 synthetic records</strong></article></div>
    {#if !discoverPreviewReady&&!demoState.candidatesReady}
      <div class="preview-list"><span>Character edit</span><span>Unicode + DNS-safe forms</span><span>Local custom terms</span><span>Alternate TLD</span><span>CT provenance</span></div>
      <button class="primary" type="button" onclick={generate}>Generate fixed candidates</button>
    {:else}
      <section class="discover-review" aria-labelledby="discover-review-title"><div class="review-heading"><div><p class="eyebrow">Review before hand-off</p><h3 id="discover-review-title">Three candidates, two evidence origins</h3></div><span>3 of 3 retained</span></div><div class="discover-candidates">{#each SYNTHETIC_DEMO_CANDIDATES as candidate}<article><code>{candidate.domain}</code><strong>{candidate.mutation}</strong><p>{candidate.provenance.source}{candidate.provenance.certificateCount?' · '+candidate.provenance.certificateCount+' certificate observations':' · generated locally'}</p></article>{/each}</div><div class="handoff-row"><p>Bulk receives only these reviewed fixtures. It will compare compact evidence before any lead enters deep Lookup.</p><button class="primary" type="button" disabled={stageTransitioning} onclick={handoffCandidates}>Review 3 candidates in Bulk</button></div></section>
    {/if}
  </section>
{:else if view==='bulk'}
  <section class="demo-panel" aria-labelledby="bulk-heading">
    <p class="eyebrow">Bulk · Explainable triage</p><h2 id="bulk-heading" data-stage-heading tabindex="-1">Prioritise candidates without collapsing evidence</h2>
    <p>Bulk compares compact evidence consistently, then lets the analyst choose one lead for deeper review. Scores and shared infrastructure prioritise attention; they do not establish ownership, coordination, intent, or maliciousness.</p>
    <div class="filter-bar" role="group" aria-label="Candidate filters"><button class:active={candidateFilter==='all'} aria-pressed={candidateFilter==='all'} onclick={()=>candidateFilter='all'}>All candidates · 3</button><button class:active={candidateFilter==='high'} aria-pressed={candidateFilter==='high'} onclick={()=>candidateFilter='high'}>High priority · 1</button>{#if candidateFilter==='related'}<button class="active" aria-pressed="true">Related domains · {relatedDomains.length}</button>{/if}</div>
    <div class="candidate-grid">{#each candidates as candidate}<article class="candidate card"><div><code>{candidate.domain}</code><span class:high={candidate.risk>=70}>Risk {candidate.risk}</span></div><p>{candidate.mutation} · {candidate.availability}</p><ul>{#each candidate.signals as signal}<li>{signal}</li>{/each}</ul><details><summary>Why this score</summary><ul>{#each candidate.riskFactors as factor}<li>{factor.label} · +{factor.points}</li>{/each}</ul></details>{#if candidate.provenance.certificateCount}<p class="provenance">{candidate.provenance.source} · {candidate.provenance.certificateCount} certificates · latest {shortDate(candidate.provenance.lastObservedAt)}</p>{/if}<button type="button" disabled={stageTransitioning} onclick={()=>inspect(candidate.id)}>Inspect {candidate.domain}</button></article>{/each}</div>
    <BulkRelationships groups={relationshipGroups} truncated={false} limitations={['Shared infrastructure is investigation context only. It does not establish ownership, coordination, intent, or maliciousness.']} loadDomains={loadRelated} />
  </section>
{:else if view==='lookup'&&selected&&lookupView}
  <section class="demo-panel" aria-labelledby="lookup-heading">
    <p class="eyebrow">Lookup · Deep evidence review</p><h2 id="lookup-heading" data-stage-heading tabindex="-1">{selected.domain}</h2>
    <p>Begin with the decision brief, inspect the evidence family that supports the decision, then choose whether the finding warrants a case. Optional provider and raw-response detail stays out of this first review.</p>
    <h3 class="sr-only">Synthetic lookup evidence</h3>

    <section class="demo-decision-brief card" aria-labelledby="demo-decision-title">
      <header><div><p class="eyebrow">Decision brief</p><h3 id="demo-decision-title">What needs analyst attention?</h3></div><span class="priority-cue">Priority {selected.risk}/100</span></header>
      <div class="lookup-handoff"><div><p class="eyebrow">Next workflow step</p><strong>Retain the finding only when it warrants follow-up</strong><span>The demo creates one isolated, tab-scoped case and performs no monitoring request.</span></div><button class="primary" type="button" disabled={stageTransitioning} onclick={openCase}>Open synthetic case in Monitor</button></div>
      <div class="decision-layout">
        <dl><div><dt>Registration</dt><dd>{selected.availability}</dd></div><div><dt>Candidate origin</dt><dd>{selected.mutation}</dd></div><div><dt>Evidence complete</dt><dd>{lookupCompleteEvidenceCount}</dd></div><div><dt>Evidence limited</dt><dd>{lookupLimitedEvidenceCount}</dd></div></dl>
        <div class="key-observations"><h4>Three review cues</h4><ol><li>Registry evidence reports the name as {selected.availability.toLowerCase()}.</li><li>The candidate was retained from {selected.provenance.source.toLowerCase()} evidence, which does not establish website control.</li><li>{#if selected.relationship}{selected.relationship.label} is an exact relationship lead, not proof of common ownership.{:else}No exact relationship lead appears in this fixture.{/if}</li></ol></div>
      </div>
    </section>

    <section class="demo-result-section overview-section" id="demo-overview" aria-labelledby="demo-overview-title">
      <h3 id="demo-overview-title">Explainable assessment</h3>
      <p class="section-copy">The overview prioritises review and exposes every score factor. It is not a verdict about maliciousness, safety, ownership, or whether the domain should be acquired.</p>
      <div class="shared-evidence" id="demo-assessment"><LookupAssessment {...lookupView.assessment} /></div>
    </section>

    <div class="lookup-family-stack" role="group" aria-label="Synthetic evidence families">
    <section class="lookup-family" id="demo-family-registration" aria-labelledby="demo-registration-title">
      <h3 id="demo-registration-title">Registration</h3>
      <LookupFamilySummary
        label="Registration"
        description="Compare authoritative registry evidence with separately attributed registrar RDAP and WHOIS publications."
        metrics={['Registry authority retained','3 source comparisons','Redaction remains explicit']}
        expanded={lookupFamily==='registration'}
        onshow={()=>showLookupFamily('registration')}
        onhide={()=>hideLookupFamily('registration')}
      />
      {#if lookupFamily==='registration'}
        <div class="family-details card" id="demo-evidence-registry">
          <p class="family-intro">Registration state is authority-aware. Registrar or page evidence can add context, but cannot decide whether the domain exists.</p>
          <div class="shared-evidence"><LookupRegistrySources {...lookupView.registry} /></div>
        </div>
      {/if}
    </section>

    <section class="lookup-family" id="demo-family-web" aria-labelledby="demo-web-title">
      <h3 id="demo-web-title">Web, DNS, and TLS</h3>
      <LookupFamilySummary
        label="Web, DNS, and TLS"
        description="Review point-in-time network, DNS, HTTP, and certificate observations without merging their collection states."
        metrics={['4 representative collectors',lookupCompleteEvidenceCount+' total checks complete',lookupLimitedEvidenceCount+' limited']}
        expanded={lookupFamily==='web'}
        onshow={()=>showLookupFamily('web')}
        onhide={()=>hideLookupFamily('web')}
      />
      {#if lookupFamily==='web'}
        <div class="family-details card">
          <p class="family-intro">Each card keeps its own status, timestamp, provenance, and limitations. A successful HTTP response does not authenticate DNS or certificate evidence.</p>
          <div class="shared-evidence" id="demo-evidence-network"><LookupNetworkContext {...lookupView.network} /></div>
          <div class="shared-evidence" id="demo-evidence-dns"><LookupDnsEvidence {...lookupView.dns} /></div>
          <div class="shared-evidence" id="demo-evidence-http"><LookupHttpEvidence {...lookupView.http} /></div>
          <div class="shared-evidence" id="demo-evidence-tls"><LookupTlsEvidence {...lookupView.tls} /></div>
          <div class="coverage-note"><strong>Also separated in the signed-in Console</strong><span>security.txt · structured identity · credential surface · passive posture · technology · certificate warning data</span></div>
        </div>
      {/if}
    </section>

    <section class="lookup-family" id="demo-family-relationships" aria-labelledby="demo-relationships-title">
      <h3 id="demo-relationships-title">Relationships &amp; history</h3>
      <LookupFamilySummary
        label="Relationships and history"
        description="Switch between attributed evidence, exact relationship leads, and dated observations without repeating the same claim."
        metrics={[lookupTopologyNodes.length+' mapped items',(selected.relationship?1:0)+' relationship lead',lookupLifecycleEvents.length+' dated events']}
        expanded={lookupFamily==='relationships'}
        onshow={()=>showLookupFamily('relationships')}
        onhide={()=>hideLookupFamily('relationships')}
      />
      {#if lookupFamily==='relationships'}
      <div class="family-details card">
      <div class="demo-visual-switcher card" role="tablist" aria-label="Synthetic relationship and history view">
        <button id="demo-visual-tab-evidence" type="button" role="tab" aria-selected={demoVisualView==='evidence'} aria-controls="demo-visual-panel" tabindex={demoVisualView==='evidence'?0:-1} class:active={demoVisualView==='evidence'} onclick={()=>demoVisualView='evidence'} onkeydown={demoVisualTabKeydown}>Evidence <span>{lookupTopologyNodes.length}</span></button>
        <button id="demo-visual-tab-relationships" type="button" role="tab" aria-selected={demoVisualView==='relationships'} aria-controls="demo-visual-panel" tabindex={demoVisualView==='relationships'?0:-1} class:active={demoVisualView==='relationships'} onclick={()=>demoVisualView='relationships'} onkeydown={demoVisualTabKeydown}>Relationships <span>{selected.relationship?1:0}</span></button>
        <button id="demo-visual-tab-timeline" type="button" role="tab" aria-selected={demoVisualView==='timeline'} aria-controls="demo-visual-panel" tabindex={demoVisualView==='timeline'?0:-1} class:active={demoVisualView==='timeline'} onclick={()=>demoVisualView='timeline'} onkeydown={demoVisualTabKeydown}>Timeline <span>{lookupLifecycleEvents.length}</span></button>
      </div>
      <div id="demo-visual-panel" class="demo-visual-panel" role="tabpanel" aria-labelledby={'demo-visual-tab-'+demoVisualView}>
        {#if demoVisualView==='evidence'}
          <div class="shared-evidence visual-summary"><EvidenceTopology id="demo-evidence-topology" title="Where this result came from" description="Open a separately attributed fixture family. Missing or inconclusive sources remain explicit." target={{label:selected.domain,detail:'Synthetic domain lookup',status:selected.availability}} nodes={lookupTopologyNodes} onnavigate={navigateLookupEvidence} /></div>
        {:else if demoVisualView==='relationships'}
          {#if selected.relationship}<div class="limitation info"><strong>Relationship lead</strong><p>{selected.relationship.label} <code>{selected.relationship.value}</code> appears in {selected.relationship.relatedCandidates} synthetic candidates. Shared infrastructure is not proof of common ownership.</p></div>{:else}<div class="limitation info"><strong>No relationship lead in this fixture</strong><p>That absence only describes this fixed dataset.</p></div>{/if}
        {:else}
          <div class="shared-evidence visual-summary"><LookupLifecycle events={lookupLifecycleEvents} /></div>
        {/if}
      </div>
      </div>
      {/if}
    </section>

    <section class="lookup-family" id="demo-source-quality" aria-labelledby="demo-source-quality-title">
      <h3 id="demo-source-quality-title">Source quality</h3>
      <LookupFamilySummary
        label="Source quality"
        description="Check completeness and timing before relying on a result; missing collection stays missing."
        metrics={[lookupCompleteEvidenceCount+' complete',lookupLimitedEvidenceCount+' limited','4 overlapping branches']}
        expanded={lookupFamily==='quality'}
        onshow={()=>showLookupFamily('quality')}
        onhide={()=>hideLookupFamily('quality')}
      />
      {#if lookupFamily==='quality'}
        <div class="family-details card">
          <p class="family-intro">This fixed timing view demonstrates parallel collection. The signed-in Console also shows each source state, freshness result, limitation, and bounded refresh path.</p>
          <div class="shared-evidence"><LookupCollectionTiming timing={{version:1,totalMs:860,sources:[{source:'rdap',outcome:'fulfilled',durationMs:240,completedAfterMs:240},{source:'whois',outcome:'fulfilled',durationMs:620,completedAfterMs:690},{source:'domain_evidence',outcome:'fulfilled',durationMs:740,completedAfterMs:820},{source:'network_context',outcome:'fulfilled',durationMs:210,completedAfterMs:860}]}} /></div>
        </div>
      {/if}
    </section>

    <section class="lookup-family" id="demo-family-case" aria-labelledby="demo-case-title">
      <h3 id="demo-case-title">Decision context</h3>
      <LookupFamilySummary
        label="Decision context"
        description="Separate observed facts, analyst interpretation, unknowns, and next actions before retaining the finding."
        metrics={['Analyst review required','Acquisition context remains optional']}
        expanded={lookupFamily==='case'}
        onshow={()=>showLookupFamily('case')}
        onhide={()=>hideLookupFamily('case')}
      />
      {#if lookupFamily==='case'}
        <div class="family-details card">
          {#if lookupAcquisitionReview}<div class="shared-evidence"><LookupAcquisitionDueDiligence review={lookupAcquisitionReview} target={selected.domain} observedAt={null} synthetic /></div>{/if}
          <div class="limitation"><strong>Interpretation limit</strong><p>These values demonstrate source attribution and explainability only. A live result still requires analyst review.</p></div>
        </div>
      {/if}
    </section>
    </div>

    <aside class="console-depth-note card" aria-labelledby="console-depth-title"><div><p class="eyebrow">Available when needed</p><h3 id="console-depth-title">The signed-in Console keeps deeper verification out of the first pass</h3></div><p>Optional provider context, evidence replay, and the bounded raw unified response support source-level tracing. The public fixture does not invent those responses or expose a raw payload.</p></aside>
  </section>
{:else if view==='monitor'&&selected&&caseRecord}
  <section class="demo-panel card" aria-labelledby="monitor-heading">
    <p class="eyebrow">Monitor · Isolated case</p><h2 id="monitor-heading" data-stage-heading tabindex="-1">Document and revisit {selected.domain}</h2>
    <p>This case and evidence history use only the demo's tab-scoped key. They never appear in production cases, watchlists, campaigns, or hosted monitoring.</p>
    <div class="case-grid"><label>Status<select value={demoState.caseStatus} onchange={(event)=>updateCase({caseStatus:(event.currentTarget as HTMLSelectElement).value})}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="monitoring">Monitoring</option></select></label><label>Analyst note<textarea maxlength={MAX_SYNTHETIC_DEMO_NOTE_LENGTH} value={demoState.note} oninput={(event)=>updateCase({note:(event.currentTarget as HTMLTextAreaElement).value},false)} placeholder="Optional synthetic note"></textarea></label></div>
    <section class="retained-case card" aria-labelledby="retained-case-title"><div><p class="eyebrow">Retained baseline</p><h3 id="retained-case-title">Case evidence, not a live watchlist</h3><p>The baseline preserves the separately attributed Lookup snapshot and analyst context. It does not perform a scheduled check.</p></div><dl><div><dt>Captured</dt><dd>2026-06-26</dd></div><div><dt>Source</dt><dd>Deep Lookup fixture</dd></div><div><dt>Priority</dt><dd>{selected.risk}/100</dd></div><div><dt>History entries</dt><dd>{caseRecord.evidenceHistory.length}</dd></div></dl></section>
    {#if !demoState.followUpReady}<div class="follow-up"><p>Load one repeated observation and one later material change to see how the case history separates unchanged evidence from an actual difference.</p><button class="primary" type="button" onclick={loadFollowUp}>Load later synthetic observation</button></div>{/if}
    <h3 class="sr-only">Synthetic case evidence</h3>
    <div class="shared-timeline">{#key `${caseRecord.id}:${caseRecord.evidenceHistory.length}`}<EvidenceTimeline record={caseRecord} />{/key}</div>
    {#if demoState.followUpReady}
      <section class="change-review card" aria-labelledby="change-review-title"><header><div><p class="eyebrow">Comparison result</p><h3 id="change-review-title">Repeated evidence and material changes stay distinct</h3></div><span>{caseRecord.evidenceHistory.length} retained observations</span></header><div class="change-list">{#each monitorTimeline as entry}<article><div><strong>{entry.label}</strong><time datetime={entry.capturedAt}>{formatDate(entry.capturedAt)}</time></div>{#if entry.repeated}<p>A repeated observation matched this retained state and is counted without inventing a change.</p>{/if}{#if entry.changes.length}<dl>{#each entry.changes as change}<div><dt>{change.field}</dt><dd><span>{displayChangeValue(change.before)}</span><b aria-hidden="true">→</b><span>{displayChangeValue(change.after)}</span></dd></div>{/each}</dl>{:else if !entry.repeated}<p>No material field change in this retained observation.</p>{/if}</article>{/each}</div></section>
    {/if}
    {#if demoState.followUpReady}<div class="case-actions"><button class="primary" type="button" onclick={exportCase}>Export synthetic case report</button><button type="button" disabled={stageTransitioning} onclick={()=>void goToStage('lookup')}>Review Lookup evidence</button></div><p class="export-warning">Exports use a distinct schema, include <code>synthetic: true</code>, and must not be used as evidence or an abuse report.</p>{/if}
  </section>
{/if}
</section>

<section class="demo-footer"><div><p>Ready for live investigation?</p><PublicConsoleCta /></div><p><a href="/">Return to the public overview</a></p></section>

<style>
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}
  .demo-actions button,.candidate button,.case-actions button,.filter-bar button,.lookup-handoff button,.profile-handoff button{padding:9px 13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);font:700 var(--text-xs) var(--mono)}
  .demo-hero{max-width:900px}.demo-hero h1{margin:.25rem 0;font:700 clamp(1.9rem,4.4vw,3.1rem) var(--mono);letter-spacing:-.05em}.hero-compact-title{display:none}.demo-hero>p:not(.eyebrow){max-width:78ch;color:var(--muted);line-height:1.6}.synthetic-flag{display:inline-block;margin-top:9px;padding:7px 10px;border:1px solid var(--amber);border-radius:999px;color:var(--amber);font:700 var(--text-2xs) var(--mono)}
  .demo-steps{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px;margin:30px 0 8px;padding:5px}.demo-steps button{position:relative;display:grid;grid-template-columns:24px minmax(0,1fr);min-width:0;min-height:52px;align-items:center;gap:7px;padding:7px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);text-align:left}.demo-steps button:not(:last-child)::after{content:"";position:absolute;right:-4px;width:5px;height:1px;background:var(--border)}.demo-steps button.active{border-color:var(--accent);background:rgb(var(--accent-rgb) / .08);color:var(--text);box-shadow:inset 0 -2px var(--accent)}.demo-steps button.complete:not(.active){color:var(--text)}.stage-number{display:grid;width:23px;height:23px;place-items:center;border:1px solid var(--border);border-radius:50%;font:700 .56rem var(--mono)}.complete .stage-number{border-color:var(--accent2);background:rgb(var(--accent2-rgb) / .09);color:var(--accent2)}.active .stage-number{border-color:var(--accent);color:var(--accent)}.stage-copy{min-width:0}.stage-copy strong,.stage-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stage-copy strong{font:700 var(--text-2xs) var(--mono)}.stage-copy small{margin-top:3px;color:var(--muted);font-size:.54rem}.complete .stage-copy small{color:var(--accent2)}.active .stage-copy small{color:var(--accent)}
  .demo-steps button:disabled{opacity:1;color:color-mix(in srgb,var(--muted) 82%,var(--text));background:color-mix(in srgb,var(--panel-raised) 55%,transparent)}.demo-steps button:disabled .stage-number{border-color:color-mix(in srgb,var(--muted) 72%,var(--border))}.demo-steps button:disabled .stage-copy small{color:color-mix(in srgb,var(--muted) 90%,var(--text))}
  .demo-stage-summary{display:flex;min-width:0;align-items:baseline;gap:10px;margin:0 0 12px;padding:8px 10px;border-left:2px solid var(--accent);color:var(--muted);font-size:var(--text-xs);line-height:1.5}.demo-stage-summary strong{flex:0 0 auto;color:var(--accent);font:700 var(--text-2xs) var(--mono)}
  .demo-actions{display:flex;min-height:40px;align-items:center;gap:14px;margin-bottom:18px}.demo-actions span{color:var(--muted);font-size:var(--text-xs)}
  .demo-workspace{min-width:0;scroll-margin-top:24px;overflow-anchor:none}.stage-guidance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-bottom:12px;padding:1px;background:var(--border)}.stage-guidance article{min-width:0;padding:13px 14px;background:var(--panel)}.stage-guidance span{display:block;color:var(--accent);font:750 var(--text-2xs) var(--mono);letter-spacing:.08em;text-transform:uppercase}.stage-guidance p{margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.mobile-stage-guidance{display:none}
  .demo-panel{min-height:420px;padding:clamp(22px,4vw,38px)}.demo-panel:not(.card){padding-inline:0}.demo-panel>h2{margin:.25rem 0 8px;font:700 clamp(1.4rem,3vw,2rem) var(--mono)}.demo-panel>h2:focus{outline:none}.demo-panel>h2:focus-visible{outline:2px solid var(--focus);outline-offset:5px}.demo-panel>p:not(.eyebrow),.candidate p,.export-warning,.follow-up p{color:var(--muted);line-height:1.55}
  .demo-panel dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:24px 0}.demo-panel dl div{min-width:0;padding:14px;border:1px solid var(--border)}dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}dd{margin:6px 0 0;overflow-wrap:anywhere}code{color:var(--accent);font-family:var(--mono)}
  .dashboard-summary,.configuration-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:24px 0}.dashboard-summary article,.configuration-grid article{padding:15px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.dashboard-summary span,.configuration-grid span{display:block;color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.dashboard-summary strong,.configuration-grid strong{display:block;margin-top:7px;overflow-wrap:anywhere}.tool-preview,.preview-list{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}.tool-preview span,.preview-list span{padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-xs)}
  .discover-review{margin-top:24px}.review-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.review-heading h3{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}.review-heading>span{padding:6px 9px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:700 var(--text-2xs) var(--mono)}.discover-candidates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:13px}.discover-candidates article{min-width:0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.discover-candidates code,.discover-candidates strong{display:block;overflow-wrap:anywhere}.discover-candidates strong{margin-top:7px;font-size:var(--text-xs)}.discover-candidates p{margin:7px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.handoff-row{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:13px;padding:13px 14px;border-left:2px solid var(--accent);background:rgb(var(--accent-rgb) / .04)}.handoff-row p{max-width:68ch;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.handoff-row button{flex:0 0 auto}
  .shared-profile,.shared-evidence,.shared-timeline{margin-top:18px}.shared-profile{margin-bottom:18px}.shared-evidence+.shared-evidence{margin-top:12px}.visual-summary{scroll-margin-top:92px}
  :global(.shared-evidence[id]){scroll-margin-top:92px}
  .demo-decision-brief{margin-top:22px;padding:var(--card-pad)}.demo-decision-brief header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.demo-decision-brief h3{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}.priority-cue{flex:0 0 auto;padding:7px 10px;border:1px solid var(--amber);border-radius:999px;color:var(--amber);font:750 var(--text-2xs) var(--mono)}.decision-layout{display:grid;grid-template-columns:minmax(360px,.8fr) minmax(0,1fr);gap:18px;margin-top:16px}.demo-decision-brief dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;padding:1px;background:var(--border)}.demo-decision-brief dl div{min-width:0;padding:11px;border:0;background:var(--panel-raised)}.demo-decision-brief dd{color:var(--text);font:700 var(--text-sm) var(--mono)}.key-observations{padding:13px 15px;border-left:2px solid var(--accent);background:rgb(var(--accent-rgb) / .04)}.key-observations h4{margin:0;font:700 var(--text-sm) var(--mono)}.key-observations ol{margin:9px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.key-observations li+li{margin-top:5px}.lookup-handoff{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)}.lookup-handoff>div{min-width:0}.lookup-handoff .eyebrow{margin:0}.lookup-handoff strong,.lookup-handoff span{display:block}.lookup-handoff>div>strong{margin-top:4px;font:700 var(--text-sm) var(--mono)}.lookup-handoff>div>span{margin-top:4px;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.lookup-handoff button,.profile-handoff button{flex:0 0 auto;color:var(--primary-text);background:linear-gradient(135deg,var(--primary-start),var(--primary-end))}
  .demo-result-section{margin-top:30px;scroll-margin-top:92px}.demo-result-section>h3{display:flex;gap:8px;align-items:center;margin:0;padding-bottom:9px;border-bottom:1px solid var(--border);font:700 var(--text-lg) var(--mono)}.demo-result-section>h3::before{content:'//';color:var(--muted)}.section-copy{max-width:76ch;margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .lookup-family-stack{display:grid;gap:12px;margin-top:30px}.lookup-family{min-width:0;scroll-margin-top:24px}.lookup-family>h3{margin:0 0 7px;font:700 var(--text-sm) var(--mono)}.family-details{padding:clamp(14px,2.5vw,22px);border-top:0;border-top-left-radius:0;border-top-right-radius:0}.family-intro{max-width:78ch;margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.coverage-note{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-top:14px;padding:12px 13px;border:1px dashed var(--border);color:var(--muted);font-size:var(--text-xs);line-height:1.5}.coverage-note strong{color:var(--text);font-family:var(--mono)}.coverage-note span{text-align:right}.console-depth-note{display:grid;grid-template-columns:minmax(260px,.6fr) minmax(0,1fr);gap:22px;align-items:start;margin-top:24px;padding:var(--card-pad);border-style:dashed}.console-depth-note h3{margin:2px 0 0;font:700 var(--text-sm) var(--mono)}.console-depth-note>p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .demo-visual-switcher{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:13px;padding:5px}.demo-visual-switcher button{display:flex;min-width:0;min-height:44px;align-items:center;justify-content:center;gap:8px;padding:7px 10px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:650 var(--text-xs) var(--mono)}.demo-visual-switcher button span{display:grid;min-width:21px;height:21px;place-items:center;padding:0 5px;border:1px solid var(--border);border-radius:999px;background:var(--panel-raised);color:var(--text);font-size:var(--text-2xs)}.demo-visual-switcher button.active{border-color:var(--accent);background:rgb(var(--accent-rgb) / .07);color:var(--accent)}.demo-visual-panel{min-width:0;margin-top:10px}
  .filter-bar{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 12px}.filter-bar button.active{border-color:var(--accent2);color:var(--accent2);background:rgb(var(--accent2-rgb) / .08)}.candidate-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.candidate{display:flex;min-width:0;flex-direction:column;padding:18px}.candidate>div{display:flex;align-items:flex-start;flex-direction:column;gap:8px}.candidate code{overflow-wrap:anywhere;font-size:.9rem}.candidate span{color:var(--amber);font:700 var(--text-xs) var(--mono)}.candidate span.high{color:var(--danger)}.candidate ul{padding-left:19px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.candidate details{margin-bottom:12px}.candidate summary{color:var(--accent);cursor:pointer;font-size:var(--text-xs)}.candidate .provenance{padding:9px;border-left:2px solid var(--border);font-size:var(--text-2xs)}.candidate button{width:100%;margin-top:auto;color:var(--text)}
  .limitation{margin:20px 0;padding:14px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .04)}.limitation.info{border-left-color:var(--accent)}.limitation p{margin:5px 0 0;color:var(--muted)}
  .case-grid{display:grid;grid-template-columns:minmax(180px,.45fr) minmax(0,1fr);gap:12px;margin-top:22px}.demo-panel label{display:block;color:var(--muted);font-size:var(--text-xs)}.demo-panel select,.demo-panel textarea{display:block;margin-top:7px;padding:10px}.demo-panel textarea{min-height:110px;resize:vertical}.follow-up{margin-top:22px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.follow-up p{margin:0 0 10px}.case-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.case-actions .primary{color:var(--primary-text);background:linear-gradient(135deg,var(--primary-start),var(--primary-end))}
  .retained-case{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.8fr);gap:18px;margin-top:18px;padding:var(--card-pad)}.retained-case h3,.change-review h3{margin:2px 0 0;font:700 var(--text-md) var(--mono)}.retained-case>div>p:not(.eyebrow){max-width:62ch;margin:7px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.retained-case dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:0;padding:1px;background:var(--border)}.retained-case dl div{padding:10px;border:0;background:var(--panel-raised)}.change-review{margin-top:18px;padding:var(--card-pad)}.change-review>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.change-review>header>span{padding:6px 9px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:700 var(--text-2xs) var(--mono)}.change-list{display:grid;gap:9px;margin-top:14px}.change-list>article{padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.change-list>article>div{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.change-list time{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.change-list article>p{margin:9px 0 0;color:var(--muted);font-size:var(--text-xs)}.change-list dl{display:grid;gap:7px;margin:10px 0 0}.change-list dl div{padding:9px 10px;border:1px solid var(--border);background:var(--panel)}.change-list dd{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px;align-items:center;margin-top:5px;font-size:var(--text-xs)}.change-list dd b{color:var(--accent)}.change-list dd span{overflow-wrap:anywhere}
  .demo-footer{display:flex;justify-content:space-between;gap:20px;margin-top:45px;padding-top:18px;border-top:1px solid var(--border);color:var(--muted);font-size:var(--text-2xs)}.demo-footer>div{display:flex;align-items:center;gap:10px}.demo-footer p{margin:0}.demo-footer a{color:var(--accent)}
  @media(max-width:900px){.decision-layout,.console-depth-note,.retained-case{grid-template-columns:minmax(0,1fr)}}
  @media(max-width:840px){.demo-steps{grid-template-columns:repeat(3,minmax(0,1fr))}.demo-steps button::after{display:none}.candidate-grid,.discover-candidates{grid-template-columns:1fr}.dashboard-summary,.configuration-grid{grid-template-columns:1fr}}
  @media(max-width:760px){
    .demo-hero h1{font-size:1.65rem;line-height:1.14}.demo-hero.started{display:flex;align-items:baseline;gap:9px}.demo-hero.started .eyebrow{flex:0 0 auto;margin:0}.demo-hero.started h1{margin:0;font-size:var(--text-md);letter-spacing:-.025em}.demo-hero.started .hero-full-title,.demo-hero.started>p:not(.eyebrow),.demo-hero.started .synthetic-flag{display:none}.demo-hero.started .hero-compact-title{display:inline}
    .demo-steps{display:flex;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:thin;margin:14px 0 6px}.demo-steps button{flex:0 0 154px;grid-template-columns:27px minmax(0,1fr);min-height:46px;scroll-snap-align:center}
    .demo-stage-summary{gap:7px;margin-bottom:7px;padding:6px 9px}.demo-stage-summary span{display:none}.demo-actions{min-height:0;align-items:center;flex-direction:row;gap:9px;margin-bottom:9px}.demo-actions button{flex:0 0 auto;padding:7px 9px}.demo-actions span{line-height:1.35}
    .stage-guidance{display:none}.mobile-stage-guidance{display:block;margin-bottom:8px;padding:0}.mobile-stage-guidance summary{display:flex;min-height:44px;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;color:var(--text);cursor:pointer;list-style-position:inside}.mobile-stage-guidance summary strong{font:700 var(--text-xs) var(--mono)}.mobile-stage-guidance summary span{color:var(--muted);font-size:var(--text-2xs)}.mobile-stage-guidance>div{display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px;padding:9px 11px;border-top:1px solid var(--border)}.mobile-stage-guidance>div>strong{color:var(--accent);font:700 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}.mobile-stage-guidance p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
    .demo-panel{min-height:0;padding:16px}.demo-panel:not(.card){padding-inline:0}.demo-panel>h2{font-size:1.35rem}.demo-panel dl,.case-grid{grid-template-columns:1fr}.dashboard-summary,.configuration-grid{grid-template-columns:minmax(0,1fr);gap:1px;margin:16px 0;padding:1px;background:var(--border)}.dashboard-summary article,.configuration-grid article{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 11px;border:0;border-radius:0;background:var(--panel)}.dashboard-summary strong,.configuration-grid strong{margin-top:0;text-align:right}.tool-preview{display:none}
    .demo-footer,.demo-footer>div,.handoff-row{align-items:flex-start;flex-direction:column}.demo-decision-brief header,.coverage-note{align-items:flex-start;flex-direction:column}.coverage-note span{text-align:left}.demo-decision-brief{padding:14px}.demo-decision-brief dl,.retained-case dl{grid-template-columns:repeat(2,minmax(0,1fr))}.decision-layout{gap:10px}.lookup-handoff{align-items:stretch;flex-direction:column;gap:10px}.lookup-handoff button,.profile-handoff button{width:100%}.lookup-family-stack{gap:9px;margin-top:22px}.lookup-family>h3{margin-bottom:5px}.lookup-family :global(.family-summary){align-items:center;flex-direction:row;gap:8px;padding:10px 11px}.lookup-family :global(.metrics){display:none}.lookup-family :global(.section-toggle){font-size:.55rem}.change-list dd{grid-template-columns:minmax(0,1fr)}.change-list dd b{transform:rotate(90deg)}
  }
  @media(max-width:460px){.demo-visual-switcher{grid-template-columns:minmax(0,1fr)}}
</style>
