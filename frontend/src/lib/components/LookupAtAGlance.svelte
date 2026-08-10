<script lang="ts">
  import type {
    LookupDecisionSupport,
    LookupEvidenceQualityMatrix,
  } from '$lib/analysis/lookup-decision-support.ts';
  import { projectLookupNextActions } from '$lib/analysis/lookup-decision-support.ts';
  import type { LookupSummarySignal } from '$lib/analysis/lookup-summary-model.ts';

  type GlanceMetricItem = Readonly<{
    id: string;
    label: string;
    detail: string;
    href: string;
  }>;

  type GlanceMetric = Readonly<{
    id: string;
    count: number;
    label: string;
    explanation: string;
    empty: string;
    attention: boolean;
    items: readonly GlanceMetricItem[];
  }>;

  let {
    support,
    quality,
    signals,
  }: {
    support: LookupDecisionSupport;
    quality: LookupEvidenceQualityMatrix;
    signals: readonly LookupSummarySignal[];
  } = $props();

  const notableSignals = $derived.by(() => {
    const priority = signals.filter((signal) => signal.tone !== 'neutral');
    return (priority.length ? priority : signals).slice(0, 4);
  });
  const nextActions = $derived(projectLookupNextActions(support.actions, support.guidance.task));
  const metricGroups = $derived.by((): GlanceMetric[] => [
    {
      id: 'complete',
      count: quality.completeCount,
      label: `evidence check${quality.completeCount === 1 ? '' : 's'} complete`,
      explanation: 'These collectors or derived checks returned a complete usable result. Complete describes evidence collection, not whether the domain is safe.',
      empty: 'No evidence check returned a complete usable result.',
      attention: false,
      items: quality.entries
        .filter((entry) => entry.state === 'complete')
        .map((entry) => ({
          id: entry.id,
          label: entry.label,
          detail: `${entry.statusLabel} · ${entry.endpointClass}`,
          href: '#source-quality',
        })),
    },
    {
      id: 'limited',
      count: quality.limitedCount,
      label: `evidence check${quality.limitedCount === 1 ? '' : 's'} limited`,
      explanation: 'These checks are partial, unavailable, or unknown. Their limitations may constrain a downstream conclusion.',
      empty: 'No evidence check is currently partial, unavailable, or unknown.',
      attention: quality.limitedCount > 0,
      items: quality.entries
        .filter((entry) => entry.state === 'partial' || entry.state === 'unavailable' || entry.state === 'unknown')
        .map((entry) => ({
          id: entry.id,
          label: entry.label,
          detail: `${entry.statusLabel} · ${entry.limitations[0] || entry.description}`,
          href: '#source-quality',
        })),
    },
    {
      id: 'conflicts',
      count: support.counts.conflicts,
      label: `source disagreement${support.counts.conflicts === 1 ? '' : 's'}`,
      explanation: 'These separately attributed sources report different values. Source order does not resolve a disagreement automatically.',
      empty: 'No retained source comparison currently reports a disagreement.',
      attention: support.counts.conflicts > 0,
      items: support.entries
        .filter((entry) => entry.state === 'conflict')
        .map((entry) => ({
          id: entry.id,
          label: entry.title,
          detail: `${entry.sources.join(' · ')} · ${entry.detail}`,
          href: entry.href,
        })),
    },
    {
      id: 'uncertainties',
      count: support.counts.uncertainties,
      label: `unresolved item${support.counts.uncertainties === 1 ? '' : 's'}`,
      explanation: 'These comparisons remain incomplete or indeterminate. Open an item to review the evidence that still needs interpretation.',
      empty: 'No retained comparison is currently marked incomplete or indeterminate.',
      attention: support.counts.uncertainties > 0,
      items: support.entries
        .filter((entry) => entry.state === 'uncertain')
        .map((entry) => ({
          id: entry.id,
          label: entry.title,
          detail: `${entry.sources.join(' · ')} · ${entry.detail}`,
          href: entry.href,
        })),
    },
  ]);
</script>

<section class="at-a-glance card" aria-labelledby="lookup-at-a-glance-title">
  <header class="glance-header">
    <div class="glance-intro">
      <p class="eyebrow">Start here</p>
      <h4 id="lookup-at-a-glance-title">At a glance</h4>
      <p>Review the strongest observations and unresolved evidence before opening source detail.</p>
    </div>
    <div class="metrics" role="group" aria-label="Evidence coverage and review cues">
      {#each metricGroups as metric (metric.id)}
        <details class:attention={metric.attention}>
          <summary>
            <span><strong>{metric.count}</strong> {metric.label}</span>
            <small>Show what this count includes</small>
          </summary>
          <div class="metric-detail">
            <p>{metric.explanation}</p>
            {#if metric.items.length}
              <ul>
                {#each metric.items as item (item.id)}
                  <li>
                    <a href={item.href}>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </a>
                  </li>
                {/each}
              </ul>
            {:else}
              <p>{metric.empty}</p>
            {/if}
          </div>
        </details>
      {/each}
      <small class="metric-note">Limited means partial, unavailable, or unknown. Expected unsupported, skipped, and not-found checks remain in Source quality without increasing this count. A complete check can still contain a disagreement, and neither state establishes safety.</small>
    </div>
  </header>

  <div class="glance-grid">
    <section aria-labelledby="lookup-key-findings-title">
      <h5 id="lookup-key-findings-title">Key observations</h5>
      {#if notableSignals.length}
        <ul class="signals">
          {#each notableSignals as signal}
            <li class={`tone-${signal.tone}`}>
              <span aria-hidden="true"></span>
              <div><strong>{signal.label}</strong>{#if signal.detail}<small>{signal.detail}</small>{/if}</div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">No compact observation is available. Review the source-quality section before drawing a conclusion.</p>
      {/if}
    </section>

    <section aria-labelledby="lookup-next-review-title">
      <h5 id="lookup-next-review-title">Recommended next reviews</h5>
      {#if nextActions.length}
        <div class="next-actions">
          {#each nextActions as nextAction (nextAction.id)}
            <a class="next-action" href={nextAction.href}>
              <strong>{nextAction.label}</strong>
              <span>{nextAction.reason}</span>
              <small>{nextAction.expectedOutcome}</small>
            </a>
          {/each}
        </div>
      {:else}
        <p class="empty">No contextual action is available from the settled evidence. Review source coverage and freshness next.</p>
      {/if}
    </section>
  </div>
</section>

<style>
  .at-a-glance{container-type:inline-size;min-width:0;padding:var(--card-pad)}
  .glance-header{display:grid;grid-template-columns:minmax(240px,.7fr) minmax(0,2fr);align-items:start;gap:18px}
  .glance-intro{min-width:0}
  h4{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  .glance-header p:not(.eyebrow){max-width:660px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;min-width:0;width:100%}
  .metrics details{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .metrics details[open]{grid-column:1/-1;border-color:var(--border-strong)}
  .metrics summary{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;cursor:pointer;list-style:none;overflow-wrap:anywhere}
  .metrics summary::-webkit-details-marker{display:none}
  .metrics summary::after{content:'+';flex:0 0 auto;color:var(--accent);font-size:var(--text-sm)}
  .metrics details[open] summary::after{content:'−'}
  .metrics summary>span{min-width:0}
  .metrics summary>small{max-width:94px;color:var(--muted);font:var(--text-2xs) var(--sans);line-height:1.3;text-align:right}
  .metrics strong{color:var(--text);font-size:var(--text-sm)}
  .metrics .attention summary>span strong{color:var(--amber)}
  .metric-detail{padding:0 9px 9px;border-top:1px solid var(--border)}
  .metric-detail p{margin:8px 0 0;color:var(--muted);font:var(--text-2xs) var(--sans);line-height:1.5}
  .metric-detail ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:8px 0 0;padding:0;list-style:none}
  .metric-detail a{display:grid;gap:3px;min-width:0;padding:8px;border-left:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,transparent);text-decoration:none}
  .metric-detail a strong,.metric-detail a small{overflow-wrap:anywhere}
  .metric-detail a strong{font-size:var(--text-xs)}
  .metric-detail a small{color:var(--muted);font:var(--text-2xs) var(--sans);line-height:1.4}
  .metric-note{grid-column:1/-1;max-width:none;color:var(--muted);font-size:var(--text-2xs);line-height:1.45;text-align:right;overflow-wrap:anywhere}
  .glance-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr);gap:9px;margin-top:14px}
  .glance-grid>section{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  h5{margin:0 0 9px;font:700 var(--text-xs) var(--mono)}
  .signals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}
  .signals li{display:grid;grid-template-columns:8px minmax(0,1fr);gap:8px;min-width:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .signals li>span{width:7px;height:7px;margin-top:4px;border:2px solid var(--muted);border-radius:50%}
  .signals .tone-danger>span{border-color:var(--danger)}
  .signals .tone-warn>span{border-color:var(--amber)}
  .signals .tone-good>span{border-color:var(--accent2)}
  .signals strong,.signals small{display:block;overflow-wrap:anywhere}
  .signals strong{color:var(--text);font-size:var(--text-xs)}
  .signals small{margin-top:2px;color:var(--muted)}
  .next-action{display:grid;gap:4px;padding:10px;border-left:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 5%,transparent)}
  .next-actions{display:grid;gap:7px}
  .next-action strong{color:var(--text);font:700 var(--text-xs) var(--mono)}
  .next-action span,.next-action small{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .next-action small{color:var(--text)}
  .empty{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @container(min-width:1000px){
    .metrics{grid-template-columns:repeat(4,minmax(0,1fr))}
  }
  @container(max-width:760px){
    .glance-header{grid-template-columns:minmax(0,1fr)}
    .metric-note{text-align:left}
  }
  @media(max-width:840px){
    .glance-grid{grid-template-columns:minmax(0,1fr)}
  }
  @media(max-width:520px){
    .signals{grid-template-columns:minmax(0,1fr)}
    .metric-detail ul{grid-template-columns:minmax(0,1fr)}
  }
</style>
