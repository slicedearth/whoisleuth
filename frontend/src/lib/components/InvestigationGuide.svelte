<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { loadLocalInvestigationProjection } from '$lib/investigation-search';
  import {
    approveInvestigationGuideCollection,
    clearInvestigationGuide,
    downloadInvestigationGuideSummary,
    INVESTIGATION_GUIDE_EVENT,
    investigationGuideHref,
    investigationGuideRecipe,
    investigationGuideStageForPath,
    investigationGuideStagesForRecipe,
    loadInvestigationGuide,
    pauseInvestigationGuide,
    recordInvestigationGuideVisit,
    restartStoredInvestigationGuide,
    resumeInvestigationGuide,
    updateInvestigationGuideOutcome,
    type InvestigationGuide,
    type InvestigationGuideOutcome,
  } from '$lib/investigation-guide';

  const outcomeOptions: Array<{ value: InvestigationGuideOutcome; label: string }> = [
    { value: 'pending', label: 'Pending' },
    { value: 'complete', label: 'Complete' },
    { value: 'partial', label: 'Partial' },
    { value: 'skipped', label: 'Skipped' },
  ];

  let guide = $state<InvestigationGuide | null>(null);
  let mounted = $state(false);
  let restartPending = $state(false);
  let exportPending = $state(false);
  let exportError = $state('');
  let evidence = $state({ observations: 0, relationships: 0, partial: false, truncated: false });
  const recipe = $derived(guide ? investigationGuideRecipe(guide.recipeId) : null);
  const stages = $derived(guide ? investigationGuideStagesForRecipe(guide.recipeId) : []);
  const currentStage = $derived(guide ? investigationGuideStageForPath(page.url.pathname, guide.recipeId) : null);
  const nextStageId = $derived(guide?.stages.find((stage) => stage.outcome === 'pending')?.id || null);

  function refresh() {
    guide = loadInvestigationGuide();
    refreshEvidence();
  }

  function refreshEvidence() {
    if (!guide) {
      evidence = { observations: 0, relationships: 0, partial: false, truncated: false };
      return;
    }
    const projection = loadLocalInvestigationProjection();
    const domainEntity = projection.entities.find((entity) => entity.type === 'domain' && entity.canonical === guide?.domain);
    if (!domainEntity) {
      evidence = { observations: 0, relationships: 0, partial: false, truncated: projection.truncated };
      return;
    }
    const observationIds = new Set(domainEntity.observationIds);
    const observations = projection.observations.filter((observation) => observationIds.has(observation.id));
    const relationships = projection.relationships.filter((relationship) => relationship.from === domainEntity.id || relationship.to === domainEntity.id);
    evidence = {
      observations: observations.length,
      relationships: relationships.length,
      partial: observations.some((observation) => observation.status === 'partial' || observation.complete !== true),
      truncated: projection.truncated || domainEntity.observationsTruncated
        || observations.some((observation) => observation.truncated === true || observation.entityReferencesTruncated)
        || relationships.some((relationship) => relationship.truncated === true || relationship.sourceObservationsTruncated),
    };
  }

  function endGuide() {
    clearInvestigationGuide();
    guide = null;
  }

  function togglePause() {
    guide = guide?.status === 'paused' ? resumeInvestigationGuide() : pauseInvestigationGuide();
  }

  function approve(stageId: string) {
    guide = approveInvestigationGuideCollection(stageId);
  }

  function setOutcome(stageId: string, event: Event) {
    const outcome = (event.currentTarget as HTMLSelectElement).value as InvestigationGuideOutcome;
    guide = updateInvestigationGuideOutcome(stageId, outcome);
  }

  function restart() {
    if (!restartPending) {
      restartPending = true;
      return;
    }
    guide = restartStoredInvestigationGuide();
    restartPending = false;
  }

  function exportSummary() {
    if (!exportPending) {
      exportPending = true;
      return;
    }
    exportError = '';
    try {
      downloadInvestigationGuideSummary();
      exportPending = false;
    } catch (cause) {
      exportError = cause instanceof Error ? cause.message : 'Could not export the guided investigation.';
    }
  }

  onMount(() => {
    mounted = true;
    refresh();
    window.addEventListener(INVESTIGATION_GUIDE_EVENT, refresh);
    return () => window.removeEventListener(INVESTIGATION_GUIDE_EVENT, refresh);
  });

  $effect(() => {
    const pathname = page.url.pathname;
    if (mounted) guide = recordInvestigationGuideVisit(pathname);
  });
</script>

{#if guide && recipe}
  <section class="guide card" aria-labelledby="investigation-guide-title">
    <div class="guide-heading">
      <div>
        <p class="eyebrow">Guided investigation</p>
        <strong class="guide-title" id="investigation-guide-title">{recipe.label}: {guide.domain}</strong>
        <p class="recipe-summary">{recipe.summary}</p>
      </div>
      <span class:paused={guide.status === 'paused'} class="recipe-status">{guide.status === 'paused' ? 'Paused' : 'Active'}</span>
    </div>

    <div class="guide-controls toolbar" aria-label="Recipe controls">
      <button class="btn compact" type="button" onclick={togglePause}>{guide.status === 'paused' ? 'Resume recipe' : 'Pause recipe'}</button>
      <button class="btn compact" type="button" onclick={restart}>{restartPending ? 'Confirm restart' : 'Restart recipe'}</button>
      {#if restartPending}<button class="btn compact" type="button" onclick={() => restartPending = false}>Cancel restart</button>{/if}
      <button class="btn compact" type="button" onclick={exportSummary}>{exportPending ? 'Confirm export' : 'Export summary'}</button>
      {#if exportPending}<button class="btn compact" type="button" onclick={() => exportPending = false}>Cancel export</button>{/if}
      <button class="btn compact" type="button" onclick={endGuide}>End recipe</button>
    </div>
    {#if exportError}<p class="error" role="alert">{exportError}</p>{/if}
    <p class="evidence-checkpoint">
      <strong>Local evidence checkpoint.</strong>
      {#if evidence.observations || evidence.relationships}
        The typed local projection currently links {evidence.observations} retained observation{evidence.observations === 1 ? '' : 's'} and {evidence.relationships} relationship{evidence.relationships === 1 ? '' : 's'} to this domain.{evidence.partial ? ' Some retained evidence is partial.' : ''}{evidence.truncated ? ' A projection or source limit was reached.' : ''}
      {:else}
        No retained local observation currently links to this domain. This does not establish that evidence is absent elsewhere.{evidence.truncated ? ' A projection or source limit was reached.' : ''}
      {/if}
    </p>

    <ol aria-label="Investigation recipe stages">
      {#each stages as stage,index}
        {@const progress = guide.stages.find((candidate) => candidate.id === stage.id)}
        {@const isCurrent = currentStage?.id === stage.id}
        {@const wasOpened = Boolean(progress?.openedAt)}
        {@const approved = !stage.requiresApproval || Boolean(progress?.approvedAt)}
        <li class:current={isCurrent} class:opened={wasOpened} class:partial={progress?.outcome === 'partial'} class:complete={progress?.outcome === 'complete'} class:skipped={progress?.outcome === 'skipped'}>
          <details open={isCurrent || (!currentStage && stage.id === nextStageId)}>
            <summary>
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span class="stage-heading"><strong>{stage.label}</strong><small>{stage.detail}</small></span>
              <span class="stage-state">{isCurrent ? progress?.outcome === 'complete' ? 'Current · Complete' : progress?.outcome === 'partial' ? 'Current · Partial' : progress?.outcome === 'skipped' ? 'Current · Skipped' : 'Current' : progress?.outcome === 'complete' ? 'Complete' : progress?.outcome === 'partial' ? 'Partial' : progress?.outcome === 'skipped' ? 'Skipped' : wasOpened ? 'Opened' : 'Not opened'}</span>
            </summary>
            <div class="stage-body">
              <dl>
                <div><dt>Expected evidence</dt><dd>{stage.expectedEvidence}</dd></div>
                <div><dt>Request and cost</dt><dd>{stage.requestImpact}</dd></div>
                <div><dt>Prerequisite</dt><dd>{stage.prerequisite}</dd></div>
                <div><dt>Completion</dt><dd>{stage.completionCriteria}</dd></div>
              </dl>
              <div class="stage-actions">
                {#if stage.requiresApproval && !approved}
                  <button class="btn compact" type="button" onclick={() => approve(stage.id)} disabled={guide.status === 'paused'}>Approve collection stage</button>
                  <small>Approval records that you reviewed the request implications. Opening the workspace still does not start collection.</small>
                {:else if guide.status === 'paused'}
                  <span class="disabled-action">Resume the recipe to open this stage.</span>
                {:else}
                  <a class="btn compact" href={investigationGuideHref(stage.id, guide.domain, guide.recipeId)}>Open {stage.workspace}</a>
                {/if}
                <label>
                  <span>Outcome</span>
                  <select value={progress?.outcome || 'pending'} onchange={(event) => setOutcome(stage.id, event)} disabled={guide.status === 'paused'} aria-label={`Outcome for ${stage.label}`}>
                    {#each outcomeOptions as option}
                      <option value={option.value} disabled={(option.value === 'complete' || option.value === 'partial') && !wasOpened}>{option.label}</option>
                    {/each}
                  </select>
                </label>
              </div>
            </div>
          </details>
        </li>
      {/each}
    </ol>
    <p class="boundary">Recipe progress is tab-local workflow metadata. It never starts a scan, submits a target, exports evidence, changes Risk, or decides a case disposition. Shared infrastructure remains a lead, not proof of control or intent.</p>
  </section>
{/if}

<style>
  .guide{margin:0 0 24px;padding:16px}
  .guide-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .guide-title{display:block;margin:3px 0 0;overflow-wrap:anywhere;font:700 var(--text-md) var(--mono)}
  .recipe-summary{max-width:850px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .recipe-status{flex:none;padding:5px 8px;border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:999px;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .recipe-status.paused{border-color:var(--border);color:var(--muted)}
  .guide-controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}
  .compact{flex:none;padding:7px 10px;font-size:var(--text-2xs)}
  .error{margin:9px 0 0}
  .evidence-checkpoint{margin:11px 0 0;padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);font-size:var(--text-2xs);line-height:1.5}
  .evidence-checkpoint strong{font-family:var(--mono)}
  ol{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0 0;padding:0;list-style:none}
  li{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2)}
  summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:6px 9px;align-items:start;padding:12px;cursor:pointer;list-style:none}
  summary::-webkit-details-marker{display:none}
  summary::after{content:'+';color:var(--muted);font:700 var(--text-sm) var(--mono);line-height:1}
  details[open] summary::after{content:'−'}
  summary>span:first-child{color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .stage-heading{min-width:0}
  li strong,li small{display:block}
  li strong{font:700 var(--text-xs) var(--mono)}
  li small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .stage-state{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-align:right}
  li.opened{border-color:color-mix(in srgb,var(--accent2) 38%,var(--border))}
  li.current{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
  li.current .stage-state,li.complete .stage-state{color:var(--accent)}
  li.partial .stage-state{color:var(--warning)}
  li.skipped .stage-state{color:var(--muted)}
  .stage-body{padding:0 12px 12px}
  dl{display:grid;gap:7px;margin:0 0 12px;padding-top:12px;border-top:1px solid var(--border)}
  dl div{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px}
  dt{color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  dd{margin:0;font-size:var(--text-2xs);line-height:1.45}
  .stage-actions{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;padding-top:10px;border-top:1px solid var(--border)}
  .stage-actions>small{max-width:340px;margin:0}
  .stage-actions label{display:grid;gap:4px;min-width:112px;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .stage-actions select{min-width:0;width:100%;padding:7px 28px 7px 8px;font-size:var(--text-2xs)}
  .disabled-action{color:var(--muted);font-size:var(--text-2xs)}
  .boundary{margin:11px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:900px){ol{grid-template-columns:1fr}}
  @media(max-width:560px){.guide-heading{flex-wrap:wrap}.guide-controls{display:grid;grid-template-columns:1fr 1fr}.guide-controls .btn{width:100%}.stage-actions{align-items:stretch;flex-direction:column}.stage-actions .btn,.stage-actions label{width:100%}dl div{grid-template-columns:1fr;gap:2px}}
  @media(max-width:360px){.guide-controls{grid-template-columns:1fr}summary{grid-template-columns:auto minmax(0,1fr) auto}.stage-state{grid-column:2;text-align:left}summary::after{grid-column:3;grid-row:1}}
</style>
