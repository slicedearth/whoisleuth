<script lang="ts">
  import { untrack } from 'svelte';
  import type { BrandProfile } from '$lib/analysis/brand-profile-model.ts';
  import {
    buildCampaignCohortReview,
    type CampaignCohortRationaleKind,
    type CampaignCohortSourceState,
  } from '$lib/analysis/campaign-cohort-review.ts';
  import type { CaseRecord } from '$lib/cases';
  import type { CaseRelationshipSummary } from '$lib/analysis/case-relationships.ts';
  import type { CampaignRecord } from '$lib/campaigns';

  let {
    campaign,
    records,
    profiles,
    relationshipSummary,
    sourceStates,
    onselect,
  }: {
    campaign: CampaignRecord;
    records: CaseRecord[];
    profiles: BrandProfile[];
    relationshipSummary: CaseRelationshipSummary;
    sourceStates: {
      cases: CampaignCohortSourceState;
      profiles: CampaignCohortSourceState;
      relationships: CampaignCohortSourceState;
    };
    onselect: ((record: CaseRecord) => void) | undefined;
  } = $props();

  let selectedProfileId = $state('');
  let appliedCampaignId = $state('');
  const review = $derived(buildCampaignCohortReview({
    domains: campaign.domains,
    cases: records,
    profiles,
    relationshipSummary,
    selectedBrandProfileId: selectedProfileId,
    sourceStates,
  }));
  const recordsById = $derived(new Map(records.map((record) => [record.id, record])));
  const omissionCount = $derived(Object.values(review.omissions).reduce((total, value) => total + value, 0));
  const cohortCountsComplete = $derived(review.sources.relationships === 'ready'
    && !review.upstreamRelationshipTruncated
    && review.omissions.campaignMembers === 0
    && review.omissions.caseInputs === 0
    && review.omissions.relationshipGroups === 0
    && review.omissions.relationshipMembers === 0
    && review.omissions.rationales === 0
    && review.omissions.cohorts === 0);
  const kinds: readonly Readonly<{ id: CampaignCohortRationaleKind; label: string; shape: string }>[] = [
    { id: 'exact_link', label: 'Exact link', shape: 'Square' },
    { id: 'bounded_similarity', label: 'Bounded similarity', shape: 'Circle' },
    { id: 'temporal_cooccurrence', label: 'Temporal co-occurrence', shape: 'Diamond' },
    { id: 'common_infrastructure', label: 'Common infrastructure', shape: 'Striped square' },
  ];

  $effect(() => {
    const id = campaign.id;
    if (id === appliedCampaignId) return;
    untrack(() => {
      selectedProfileId = '';
      appliedCampaignId = id;
    });
  });
  $effect(() => {
    const selected = selectedProfileId;
    const available = review.scopeOptions.some((option) => option.id === selected);
    if (selected && !available) untrack(() => { selectedProfileId = ''; });
  });

  function kindLabel(kind: CampaignCohortRationaleKind): string {
    return kinds.find((item) => item.id === kind)?.label ?? kind;
  }

  function scopeLabel(option: typeof review.scopeOptions[number]): string {
    const name = option.name
      ?? (option.state === 'unresolved' ? `Unavailable saved profile reference ${option.id}` : `Profile details unavailable ${option.id}`);
    return `${name} · ${option.memberCount} associated case${option.memberCount === 1 ? '' : 's'}`;
  }

  function formatDay(value: string | null): string {
    if (!value) return 'Not retained';
    return new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
  }

  function openCase(caseId: string): void {
    const record = recordsById.get(caseId);
    if (record) onselect?.(record);
  }
</script>

<section class="cohort-review" aria-labelledby={`campaign-cohorts-${campaign.id}`}>
  <header class="review-heading">
    <div>
      <p class="eyebrow">Explicit Brand Profile scope</p>
      <h3 id={`campaign-cohorts-${campaign.id}`}>Brand campaign cohorts</h3>
    </div>
    {#if review.selectedScope}<span class="state-chip">{review.state}</span>{/if}
  </header>
  <p class="qualification">Choose an exact Case association to review retained cross-case rationale. This view does not change campaign membership or make a new request.</p>

  {#if review.sources.cases === 'loading'}
    <p class="source-state" role="status">Case associations are still loading. No cohort count is available yet.</p>
  {:else if review.sources.cases === 'unavailable'}
    <p class="source-state unavailable" role="alert">Cases could not be read. Cohort membership and counts are unavailable; reload to retry browser-local storage.</p>
  {:else if !review.scopeOptions.length}
    <p class="source-state">No campaign member Case has an explicit Brand Profile association. Add associations in Monitor Cases before reviewing a Brand scope.</p>
  {:else}
    <label class="scope-control" for={`campaign-cohort-scope-${campaign.id}`}>
      <span>Brand Profile scope</span>
      <select id={`campaign-cohort-scope-${campaign.id}`} bind:value={selectedProfileId}>
        <option value="">Choose an exact Case association</option>
        {#each review.scopeOptions as option (option.id)}
          <option value={option.id}>{scopeLabel(option)}</option>
        {/each}
      </select>
    </label>
  {/if}

  {#if review.sources.profiles === 'loading'}
    <p class="source-state" role="status">Brand Profile details are still loading. Cohort results remain paused.</p>
  {:else if review.sources.profiles === 'unavailable' && review.scopeOptions.length}
    <p class="source-state unavailable" role="alert">Brand Profile details could not be read. Exact Case-held identifiers remain selectable, but their names and deletion state are unavailable.</p>
  {/if}

  {#if review.state === 'unselected' && review.scopeOptions.length}
    <p class="empty">Select a Brand Profile scope to derive cohorts. No selection is inferred from the active profile.</p>
  {:else if review.selectedScope && review.state !== 'loading'}
    {#if review.selectedScope.state === 'unresolved'}
      <p class="source-state unavailable" role="status">This exact identifier is retained by Cases, but no matching saved Brand Profile is available in this browser.</p>
    {/if}
    {#if review.sources.relationships === 'unavailable'}
      <p class="source-state unavailable" role="alert">Retained relationship observations could not be read. Case-derived links remain reviewable, but these results are partial.</p>
    {:else if review.sources.relationships === 'loading'}
      <p class="source-state" role="status">Retained relationship observations are still loading. Any visible registrar-only results are partial until that read settles.</p>
    {/if}

    <div class="metrics" role="list" aria-label="Selected cohort review summary">
      <article role="listitem"><strong>{review.scopedCaseCount}</strong><span>explicitly scoped cases in this bounded view</span></article>
      <article role="listitem"><strong>{cohortCountsComplete ? review.cohorts.length : '—'}</strong><span>{cohortCountsComplete ? 'connected cohorts' : 'connected cohort count incomplete'}</span></article>
      <article role="listitem"><strong>{cohortCountsComplete ? review.ungroupedMembers.length : '—'}</strong><span>{cohortCountsComplete ? 'without visible retained cohort rationale' : 'ungrouped count incomplete'}</span></article>
      <article role="listitem"><strong>{review.omissions.assertions ? `≥ ${review.assertions.length}` : review.assertions.length}</strong><span>separate analyst assertions</span></article>
    </div>

    <div class="legend" role="list" aria-label="Cohort rationale legend">
      {#each kinds as kind}
        <span role="listitem"><i class={`marker marker-${kind.id}`} aria-hidden="true"></i>{kind.label}<small>{kind.shape}</small></span>
      {/each}
    </div>

    {#if review.cohorts.length}
      <div class="cohorts">
        {#each review.cohorts as cohort, index (cohort.id)}
          <details class="cohort">
            <summary>
              <span><strong>Cohort {index + 1}</strong><small>{cohort.members.length} cases · {cohort.rationales.length} retained rationales</small></span>
              <span class="kind-matrix" role="list" aria-label={`Rationale counts for cohort ${index + 1}`}>
                {#each kinds as kind}
                  <span role="listitem" title={kind.label}><i class={`marker marker-${kind.id}`} aria-hidden="true"></i><b>{cohort.rationaleCounts[kind.id]}</b><span class="sr-only"> {kind.label}</span></span>
                {/each}
              </span>
            </summary>
            <div class="cohort-body">
              <section aria-label={`Cases in cohort ${index + 1}`}>
                <h4>Cases</h4>
                <ul class="members">
                  {#each cohort.members as item (item.caseId)}
                    <li><strong>{item.domain}</strong><button class="btn small" type="button" aria-label={`Open case ${item.domain}`} onclick={() => openCase(item.caseId)}>Open case</button></li>
                  {/each}
                </ul>
              </section>
              <section aria-label={`Rationales in cohort ${index + 1}`}>
                <h4>Membership rationale</h4>
                <ol class="rationales">
                  {#each cohort.rationales as rationale (rationale.id)}
                    <li class={`kind-${rationale.kind}`}>
                      <header><span><i class={`marker marker-${rationale.kind}`} aria-hidden="true"></i>{kindLabel(rationale.kind)}</span><span>{rationale.completeness}</span></header>
                      <strong>{rationale.label}</strong>
                      <p>{rationale.method}</p>
                      <dl><div><dt>Retained value</dt><dd>{rationale.value || 'Not retained'}</dd></div><div><dt>Cases</dt><dd>{rationale.members.map((item) => item.domain).join(', ')}</dd></div><div><dt>Sources</dt><dd>{rationale.sources.join(', ') || 'Source detail not retained'}</dd></div>{#if rationale.firstPublishedAt}<div><dt>Publication window</dt><dd>{formatDay(rationale.firstPublishedAt)} – {formatDay(rationale.lastPublishedAt)} · {rationale.spanDays} day span</dd></div>{/if}</dl>
                      {#if rationale.limitations.length}<ul class="limitations">{#each rationale.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
                    </li>
                  {/each}
                </ol>
              </section>
            </div>
          </details>
        {/each}
      </div>
    {:else}
      <p class="empty">{cohortCountsComplete ? 'No connected cohort can be derived within this bounded view for the exact scope from retained relationship, registrar, and creation-publication evidence.' : 'No connected cohort is visible in the currently readable bounded evidence; missing or omitted relationship evidence prevents a complete cohort count.'} This is not a negative finding.</p>
    {/if}

    {#if review.ungroupedMembers.length}
      <details class="context-panel"><summary>{review.ungroupedMembers.length} scoped case{review.ungroupedMembers.length === 1 ? '' : 's'} without {cohortCountsComplete ? 'retained cohort rationale' : 'a visible rationale in currently readable evidence · count incomplete'}</summary><ul>{#each review.ungroupedMembers as item}<li>{item.domain}</li>{/each}</ul></details>
    {/if}
    <details class="context-panel">
      <summary>Analyst assertions · not used for cohort membership ({review.assertions.length})</summary>
      {#if review.assertions.length}<ol>{#each review.assertions as assertion (assertion.id)}<li><strong>{assertion.domain} · {assertion.kind.replaceAll('_', ' ')} · {assertion.state}</strong><p>{assertion.statement}</p><small>{assertion.supports} supporting · {assertion.contradicts} contradicting · {assertion.unresolved} unresolved evidence relationships</small></li>{/each}</ol>{:else}<p>No analyst assertions are retained for the selected Cases. This does not affect cohort membership.</p>{/if}
    </details>
    <details class="context-panel"><summary>Interpretation limits{review.truncated ? omissionCount ? ` · bounded view (${omissionCount} locally omitted${review.upstreamRelationshipTruncated ? '; upstream count unavailable' : ''})` : ' · bounded source (upstream omission count unavailable)' : ''}</summary><ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
  {/if}
</section>

<style>
  .cohort-review{min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .review-heading{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;min-width:0}.review-heading>div{min-width:0}.review-heading h3{margin:0;font-size:var(--text-md);overflow-wrap:anywhere}.state-chip{padding:4px 7px;border:1px solid var(--border);border-radius:99px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .qualification,.empty,.source-state{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}.source-state{padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.source-state.unavailable{border-color:color-mix(in srgb,var(--amber) 45%,var(--border));color:var(--text)}
  .scope-control{display:grid;gap:5px;margin-top:12px;max-width:680px}.scope-control>span{font:650 var(--text-xs) var(--mono)}.scope-control select{min-width:0;min-height:44px;max-width:100%}
  .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.metrics article{display:grid;min-width:0;gap:3px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.metrics strong{color:var(--accent);font:700 var(--text-lg) var(--mono)}.metrics span{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.legend>span{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 8px;border:1px solid var(--border);border-radius:99px;font-size:var(--text-2xs)}.legend small{color:var(--muted)}
  .marker{display:inline-block;flex:0 0 auto;width:10px;height:10px;border:2px solid var(--visual-dns-stroke);background:transparent}.marker-bounded_similarity{border-color:var(--visual-web-stroke);border-radius:50%}.marker-temporal_cooccurrence{border-color:var(--visual-registration-stroke);transform:rotate(45deg)}.marker-common_infrastructure{border-color:var(--visual-certificate-stroke);background:repeating-linear-gradient(135deg,transparent 0 2px,var(--visual-certificate-stroke) 2px 3px)}
  .cohorts{display:grid;gap:9px;margin-top:12px}.cohort{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.cohort>summary{display:flex;justify-content:space-between;gap:12px;align-items:center;min-height:44px;padding:10px;cursor:pointer}.cohort>summary>span:first-child{display:grid;gap:2px;min-width:0}.cohort>summary strong,.cohort>summary small{overflow-wrap:anywhere}.cohort>summary small{color:var(--muted);font-size:var(--text-2xs)}
  .kind-matrix{display:grid;grid-template-columns:repeat(4,minmax(34px,auto));gap:4px}.kind-matrix>span{display:flex;align-items:center;justify-content:center;gap:4px;min-height:30px;padding:3px 5px;border:1px solid var(--border);border-radius:var(--radius-sm)}.kind-matrix b{font:650 var(--text-2xs) var(--mono)}
  .cohort-body{display:grid;gap:12px;padding:0 10px 10px;border-top:1px solid var(--border)}.cohort-body section{min-width:0}.cohort-body h4{margin:12px 0 7px;font-size:var(--text-sm)}
  .members{display:grid;gap:6px;margin:0;padding:0;list-style:none}.members li{display:flex;justify-content:space-between;gap:8px;align-items:center;min-width:0;padding:7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.members strong{min-width:0;overflow-wrap:anywhere;font-size:var(--text-xs)}.members button{min-height:44px}
  .rationales{display:grid;gap:8px;margin:0;padding:0;list-style:none}.rationales>li{min-width:0;padding:10px;border:1px solid var(--border);border-left:3px solid var(--visual-dns-stroke);border-radius:var(--radius-sm);background:var(--panel)}.rationales>li.kind-bounded_similarity{border-left-color:var(--visual-web-stroke)}.rationales>li.kind-temporal_cooccurrence{border-left-color:var(--visual-registration-stroke)}.rationales>li.kind-common_infrastructure{border-left-color:var(--visual-certificate-stroke)}.rationales header{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}.rationales header>span:first-child{display:flex;align-items:center;gap:6px}.rationales>li>strong,.rationales p,.rationales dd,.limitations li{overflow-wrap:anywhere}.rationales>li>strong{font-size:var(--text-xs)}.rationales p{margin:5px 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.rationales dl{display:grid;gap:4px;margin:8px 0 0}.rationales dl>div{display:grid;grid-template-columns:minmax(110px,0.3fr) minmax(0,1fr);gap:8px}.rationales dt{color:var(--muted);font-size:var(--text-2xs)}.rationales dd{margin:0;font-size:var(--text-2xs)}.limitations{margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .context-panel{margin-top:10px;min-width:0}.context-panel>summary{min-height:44px;color:var(--muted);cursor:pointer;font-size:var(--text-xs)}.context-panel ul,.context-panel ol{margin:6px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.context-panel li,.context-panel p,.context-panel strong,.context-panel small{overflow-wrap:anywhere}.context-panel p{color:var(--muted);font-size:var(--text-xs)}.context-panel ol p{margin:3px 0}.context-panel ol small{display:block;color:var(--muted);font-size:var(--text-2xs)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}
  @media(max-width:700px){.review-heading,.cohort>summary,.members li,.rationales header{align-items:stretch;flex-direction:column}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.kind-matrix{width:100%;grid-template-columns:repeat(4,minmax(0,1fr))}.members button{width:100%}.rationales dl>div{grid-template-columns:minmax(0,1fr);gap:2px}.legend>span{flex:1 1 145px}}
  @media(max-width:390px){.metrics{grid-template-columns:minmax(0,1fr)}.legend>span{flex-basis:100%}.kind-matrix{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
