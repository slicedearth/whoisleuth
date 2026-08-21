<script lang="ts">
  import type { DecisionFact } from '../../../../packages/evidence/decision-fact.mts';
  import { buildLookupDecisionReviewModel } from '$lib/analysis/lookup-decision-review-model.ts';
  import type { LookupDecisionSupport } from '$lib/analysis/lookup-decision-support.ts';

  let {
    support,
    facts,
    onbriefcopy = null,
    onbriefhandoff = null,
    actionBusy = false,
  }: {
    support: LookupDecisionSupport;
    facts: readonly DecisionFact[];
    onbriefcopy?: (() => void | Promise<void>) | null;
    onbriefhandoff?: (() => void | Promise<void>) | null;
    actionBusy?: boolean;
  } = $props();

  const model = $derived(buildLookupDecisionReviewModel({ support, facts }));
</script>

<section class="decision-support card" aria-labelledby="decision-support-title">
  <header class="support-header">
    <div>
      <p class="eyebrow">Investigation lens</p>
      <h4 id="decision-support-title">{model.guidance.label}</h4>
      <p>{model.guidance.summary}</p>
    </div>
    <div class="counts" role="group" aria-label="Decision-support summary">
      {#each model.groups as group (group.id)}
        <span
          class:attention={group.total > 0}
          data-review-group-summary={group.id}
          data-count={group.total}
        ><strong>{group.total}</strong> {group.countLabel}</span>
      {/each}
    </div>
  </header>

  <section class="task-questions" aria-labelledby="task-questions-title">
    <h5 id="task-questions-title">Questions to answer</h5>
    <ol class="questions">
      {#each model.guidance.questions as question}<li>{question}</li>{/each}
    </ol>
  </section>
  {#if onbriefcopy || onbriefhandoff}
    <div class="brief-actions" role="group" aria-label="Investigation brief actions">
      {#if onbriefcopy}<button class="btn small" type="button" onclick={onbriefcopy}>Copy current brief</button>{/if}
      {#if onbriefhandoff}<button class="btn small" type="button" onclick={onbriefhandoff} disabled={actionBusy}>Record brief handoff</button>{/if}
    </div>
  {/if}

  {#if model.total > 0}
    <details class="decision-records">
      <summary>Review {model.total} decision comparison record{model.total === 1 ? '' : 's'}</summary>
      <div class="decision-groups">
        {#each model.groups as group (group.id)}
          <section
            class="decision-group tone-{group.presentation.tone}"
            aria-labelledby={`decision-group-${group.id}`}
            data-review-group={group.id}
            data-consistency={group.consistency}
            data-total={group.total}
            data-displayed-count={group.displayedEntries.length}
            data-omitted-count={group.omittedCount}
            data-contributing-fact-ids={group.contributingFactIds.join(',')}
          >
            <header class="group-header">
              <div>
                <h5 id={`decision-group-${group.id}`}>{group.label}</h5>
                <p>{group.explanation}</p>
              </div>
              <span aria-label={`${group.total} ${group.countLabel}. ${group.presentation.label}. ${group.presentation.assistiveText}`}>
                <span class="presentation-icon" data-icon={group.presentation.icon} aria-hidden="true"></span>
                <strong>{group.total}</strong>
              </span>
            </header>

            {#if group.displayedEntries.length}
              <ul class="decision-list">
                {#each group.displayedEntries as entry (entry.factId)}
                  <li
                    class="decision-entry tone-{entry.consistencyPresentation.tone}"
                    data-entry-id={entry.id}
                    data-fact-id={entry.factId}
                  >
                    <div class="entry-head">
                      <span
                        class="presentation-label consistency tone-{entry.consistencyPresentation.tone}"
                        data-consistency={entry.consistency}
                        data-tone={entry.consistencyPresentation.tone}
                        aria-label={`${entry.consistencyPresentation.label}. ${entry.consistencyPresentation.assistiveText}`}
                      >
                        <span class="presentation-icon" data-icon={entry.consistencyPresentation.icon} aria-hidden="true"></span>
                        <span>{entry.consistencyPresentation.label}</span>
                      </span>
                      <span class="importance">{entry.importanceLabel} relevance</span>
                    </div>
                    <strong class="entry-title">{entry.title}</strong>
                    <p class="conclusion">{entry.detail}</p>
                    <p class="fact-id"><span>Decision Fact</span><code>{entry.factId}</code></p>

                    <div class="fact-state" role="group" aria-label={`Canonical state for ${entry.title}`}>
                      <span
                        class="presentation-label tone-{entry.evidencePresentation.tone}"
                        data-evidence-state={entry.evidenceState}
                        data-tone={entry.evidencePresentation.tone}
                        aria-label={`${entry.evidencePresentation.label}. ${entry.evidencePresentation.assistiveText}`}
                      >
                        <span class="presentation-icon" data-icon={entry.evidencePresentation.icon} aria-hidden="true"></span>
                        <span>{entry.evidencePresentation.label}</span>
                      </span>
                      <span
                        class="presentation-label tone-{entry.freshnessPresentation.tone}"
                        data-freshness={entry.freshness}
                        data-tone={entry.freshnessPresentation.tone}
                        aria-label={`${entry.freshnessPresentation.label}. ${entry.freshnessPresentation.assistiveText}`}
                      >
                        <span class="presentation-icon" data-icon={entry.freshnessPresentation.icon} aria-hidden="true"></span>
                        <span>{entry.freshnessPresentation.label}</span>
                      </span>
                    </div>

                    {#if entry.contradictions.length}
                      <section class="qualifier contradictions" aria-label={`Contradictions for ${entry.title}`}>
                        <h6>Contradictions</h6>
                        <ul>{#each entry.contradictions as contradiction}<li>{contradiction}</li>{/each}</ul>
                      </section>
                    {/if}
                    {#if entry.unattributedLimitations.length}
                      <section class="qualifier fact-limitations" aria-label={`Canonical limitations for ${entry.title}`}>
                        <h6>Conclusion limitations</h6>
                        <ul>{#each entry.unattributedLimitations as limitation}<li>{limitation}</li>{/each}</ul>
                      </section>
                    {/if}

                    <section class="contributors-section" aria-label={`Contributors for ${entry.title}`}>
                      <h6>Attributed contributors</h6>
                      <ul class="contributors">
                        {#each entry.contributors as contributor (contributor.id)}
                          <li
                            data-contributor-id={contributor.id}
                            data-provenance={contributor.provenance}
                            data-evidence-state={contributor.evidenceState}
                          >
                            <strong>{contributor.label}</strong>
                            <div class="contributor-state">
                              <span
                                class="presentation-label tone-{contributor.provenancePresentation.tone}"
                                aria-label={`${contributor.provenancePresentation.label}. ${contributor.provenancePresentation.assistiveText}`}
                              >
                                <span class="presentation-icon" data-icon={contributor.provenancePresentation.icon} aria-hidden="true"></span>
                                <span>{contributor.provenancePresentation.label}</span>
                              </span>
                              <span
                                class="presentation-label tone-{contributor.evidencePresentation.tone}"
                                aria-label={`${contributor.evidencePresentation.label}. ${contributor.evidencePresentation.assistiveText}`}
                              >
                                <span class="presentation-icon" data-icon={contributor.evidencePresentation.icon} aria-hidden="true"></span>
                                <span>{contributor.evidencePresentation.label}</span>
                              </span>
                            </div>
                            {#if contributor.observedAt}<small>Observed {contributor.observedAt}</small>{/if}
                            {#if contributor.limitations.length}
                              <section class="contributor-limitations" aria-label={`Limitations from ${contributor.label}`}>
                                <h6>{contributor.label} limitations</h6>
                                <ul>{#each contributor.limitations as limitation}<li>{limitation}</li>{/each}</ul>
                              </section>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    </section>

                    {#if entry.nextActions.length}
                      <section class="fact-actions" aria-label={`Next reviews for ${entry.title}`}>
                        <h6>Fact-specific next reviews</h6>
                        <div>
                          {#each entry.nextActions as action (action.id)}
                            <a class="fact-action" href={action.href} data-action-id={action.id}>
                              <strong>{action.label}</strong>
                              <span>{action.reason}</span>
                              <small>{action.importanceLabel} priority · {action.expectedOutcome}</small>
                            </a>
                          {/each}
                        </div>
                      </section>
                    {/if}

                    <footer>
                      <span>Source order is stable and does not assign authority.</span>
                      <a class="evidence-link" href={entry.destination}>Open evidence</a>
                    </footer>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="empty">{group.emptyMessage}</p>
            {/if}
            {#if group.omittedCount > 0}
              <p class="omitted"><strong>{group.omittedCount}</strong> additional decision record{group.omittedCount === 1 ? ' is' : 's are'} omitted from this bounded display.</p>
            {/if}
          </section>
        {/each}
      </div>
      <p class="note">Unavailable, partial, stale, truncated, and unknown evidence remains qualified. It is not converted into absence, agreement, safety, ownership, or authority.</p>
    </details>
  {/if}
</section>

<style>
  .decision-support{container-type:inline-size;min-width:0;padding:var(--card-pad)}
  .support-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  .support-header h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  .support-header p:not(.eyebrow){max-width:760px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .counts{display:flex;flex:0 0 auto;gap:7px}
  .counts span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .counts strong{color:var(--text);font-size:var(--text-sm)}
  .counts .attention strong{color:var(--amber)}
  .task-questions{max-width:820px;margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .brief-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
  h5,h6{font-family:var(--mono)}
  h5{margin:0 0 8px;font-size:var(--text-xs)}
  h6{margin:0;font-size:var(--text-2xs)}
  .questions{margin:0;padding-left:20px}
  .questions li{margin:5px 0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .decision-records{margin-top:12px;border-top:1px solid var(--border)}
  .decision-records>summary{padding:12px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  .decision-records>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .decision-groups{display:grid;gap:10px}
  .decision-group{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-md);background:color-mix(in srgb,var(--panel-raised) 86%,transparent)}
  .decision-group.tone-conflict{border-color:color-mix(in srgb,var(--danger) 38%,var(--border))}
  .group-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .group-header h5{margin:0}
  .group-header p{max-width:760px;margin:4px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .group-header>span{display:flex;align-items:center;gap:6px;flex:0 0 auto;color:var(--text);font:var(--text-xs) var(--mono)}
  .decision-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0 0;padding:0;list-style:none}
  .decision-entry{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .decision-entry.tone-conflict{border-color:color-mix(in srgb,var(--danger) 42%,var(--border))}
  .entry-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
  .presentation-label{display:inline-flex;width:max-content;max-width:100%;align-items:center;gap:5px;padding:3px 6px;border:1px solid var(--border-strong);border-radius:999px;color:var(--text);font:650 var(--text-2xs) var(--mono);overflow-wrap:anywhere}
  .presentation-label.tone-caution{border-color:var(--amber);border-style:dashed;color:var(--amber)}
  .presentation-label.tone-conflict{border-color:var(--danger);border-style:dashed;color:var(--danger)}
  .presentation-icon{display:grid;flex:0 0 auto;width:14px;height:14px;place-items:center;border:1px solid currentColor;border-radius:50%;font:700 9px/1 var(--mono)}
  .presentation-icon::before{content:'•'}
  .presentation-icon[data-icon='evidence-observed']::before,.presentation-icon[data-icon='observation-current']::before{content:'●';font-size:6px}
  .presentation-icon[data-icon='bounded-non-observation']::before{content:'○'}
  .presentation-icon[data-icon='collection-not-run']::before,.presentation-icon[data-icon='state-not-applicable']::before{content:'−'}
  .presentation-icon[data-icon='evidence-limited']::before{content:'◐'}
  .presentation-icon[data-icon='source-unsupported']::before{content:'×'}
  .presentation-icon[data-icon='source-unavailable']::before,.presentation-icon[data-icon='observation-stale']::before{content:'!'}
  .presentation-icon[data-icon='state-unknown']::before{content:'?'}
  .presentation-icon[data-icon='source-agreement']::before{content:'='}
  .presentation-icon[data-icon='source-disagreement']::before{content:'≠'}
  .presentation-icon[data-icon='evidence-direct']::before{content:'D'}
  .presentation-icon[data-icon='evidence-reported']::before{content:'P'}
  .presentation-icon[data-icon='evidence-analyst-supplied']::before{content:'A'}
  .presentation-icon[data-icon='evidence-derived']::before{content:'ƒ'}
  .importance{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .entry-title{display:block;font-size:var(--text-xs);line-height:1.4;overflow-wrap:anywhere}
  .conclusion{margin:5px 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5;overflow-wrap:anywhere}
  .fact-id{display:flex;flex-wrap:wrap;gap:4px 7px;margin:7px 0 0;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .fact-id code{color:var(--text);overflow-wrap:anywhere}
  .fact-state,.contributor-state{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
  .qualifier{margin-top:8px;padding:8px;border-left:2px solid var(--amber);background:color-mix(in srgb,var(--amber) 5%,transparent)}
  .qualifier.contradictions{border-left-color:var(--danger);background:color-mix(in srgb,var(--danger) 5%,transparent)}
  .qualifier ul,.contributor-limitations ul{margin:4px 0 0;padding-left:17px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .contributors-section{margin-top:9px;padding-top:8px;border-top:1px solid var(--border)}
  .contributors{display:grid;gap:6px;margin:6px 0 0;padding:0;list-style:none}
  .contributors>li{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:color-mix(in srgb,var(--panel) 60%,transparent)}
  .contributors>li>strong,.contributors>li>small{display:block;overflow-wrap:anywhere}
  .contributors>li>strong{font-size:var(--text-2xs)}
  .contributors>li>small{margin-top:5px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .contributor-state{margin-top:5px}
  .contributor-limitations{margin-top:7px;padding-top:7px;border-top:1px solid var(--border)}
  .fact-actions{margin-top:9px;padding-top:8px;border-top:1px solid var(--border)}
  .fact-actions>div{display:grid;gap:6px;margin-top:6px}
  .fact-action{display:grid;gap:3px;min-width:0;padding:8px;border-left:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,transparent);text-decoration:none}
  .fact-action strong,.fact-action span,.fact-action small{overflow-wrap:anywhere}
  .fact-action strong{font:650 var(--text-2xs) var(--mono)}
  .fact-action span,.fact-action small{color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .fact-action small{color:var(--text)}
  .decision-entry footer{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:9px;color:var(--muted);font-size:var(--text-2xs)}
  .decision-entry footer span{overflow-wrap:anywhere}
  .decision-entry footer a{flex:0 0 auto;font:650 var(--text-2xs) var(--mono)}
  .empty,.omitted,.note{margin:9px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @container(max-width:760px){
    .support-header{display:grid}
    .counts{width:100%}
    .counts span{flex:1}
    .decision-list{grid-template-columns:minmax(0,1fr)}
  }
  @media(max-width:480px){
    .group-header,.entry-head,.decision-entry footer{align-items:flex-start;flex-direction:column}
    .decision-entry footer a{flex:initial}
  }
</style>
