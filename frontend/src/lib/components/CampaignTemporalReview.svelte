<script lang="ts">
  import {
    buildCampaignTemporalExport,
    type CampaignTemporalLayer,
    type CampaignTemporalReview,
  } from '$lib/analysis/campaign-temporal-review.ts';
  import type { CampaignRecord } from '$lib/campaigns';

  let { campaign, review, onmessage }:{
    campaign: CampaignRecord;
    review: CampaignTemporalReview;
    onmessage?: (message: string) => void;
  } = $props();

  const layers: readonly Readonly<{ id: CampaignTemporalLayer; label: string }>[] = [
    { id: 'registration', label: 'Registration' },
    { id: 'ct', label: 'Certificate publication' },
    { id: 'dns', label: 'DNS' },
    { id: 'tls', label: 'TLS' },
    { id: 'web', label: 'Website' },
    { id: 'mail', label: 'Mail' },
  ];

  function formatDate(value: string | null): string {
    if (!value) return 'Not retained';
    return new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
  }

  function labelFor(layer: CampaignTemporalLayer): string {
    return layers.find((item) => item.id === layer)?.label ?? layer;
  }

  async function download(): Promise<void> {
    try {
      const payload = await buildCampaignTemporalExport(campaign, review);
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `whoisleuth-campaign-source-sequence-${campaign.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      onmessage?.('Exported the retained campaign source sequence.');
    } catch (cause) {
      onmessage?.(cause instanceof Error ? cause.message : 'Could not export the retained campaign source sequence.');
    }
  }
</script>

<section class="temporal-review" aria-labelledby={`campaign-sequence-${campaign.id}`}>
  <header>
    <div>
      <p class="eyebrow">Source-qualified case evidence</p>
      <h3 id={`campaign-sequence-${campaign.id}`}>Retained source sequence</h3>
    </div>
    <button class="btn small" type="button" onclick={download} disabled={!review.events.length}>Export review</button>
  </header>
  <p class="qualification">The dates below are first and last retained observations or publication times. They are not global first-seen or service-activation dates.</p>

  <div class="coverage" aria-label="Retained source coverage by evidence family">
    {#each layers as layer}
      {@const item = review.layerCoverage[layer.id]}
      <article>
        <strong>{layer.label}</strong>
        <span>{item.observed}/{review.memberCount} observed</span>
        {#if item.unavailable}<small>{item.unavailable} without retained evidence</small>{/if}
      </article>
    {/each}
  </div>

  {#if review.events.length}
    <ol class="sequence">
      {#each review.events as event}
        <li>
          <span class={`marker layer-${event.layer}`} aria-hidden="true"></span>
          <div>
            <div class="event-head"><strong>{event.domain}</strong><span>{labelFor(event.layer)}</span></div>
            <p>{formatDate(event.firstObservedAt)}{#if event.lastObservedAt !== event.firstObservedAt} – {formatDate(event.lastObservedAt)}{/if} · {event.observationCount} retained observation{event.observationCount === 1 ? '' : 's'}</p>
            <small>{event.sources.join(', ')} · {event.completeness}{event.truncated ? ' · truncated' : ''}</small>
          </div>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">No source-qualified pins or sightings are retained for these campaign members yet. Save a relevant Lookup fact or reviewed sighting to a case before using this sequence.</p>
  {/if}

  <details>
    <summary>Interpretation limits</summary>
    <ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  </details>
</section>

<style>
  .temporal-review{min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
  h3{margin:0;font-size:var(--text-md)}
  .qualification,.empty{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .coverage{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}
  .coverage article{display:grid;min-width:0;gap:3px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .coverage strong{font-size:var(--text-xs)}
  .coverage span,.coverage small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  .sequence{display:grid;gap:0;margin:14px 0 0;padding:0;list-style:none}
  .sequence li{position:relative;display:grid;grid-template-columns:14px minmax(0,1fr);gap:9px;padding:0 0 13px}
  .sequence li:not(:last-child)::before{content:'';position:absolute;top:11px;bottom:-1px;left:5px;width:1px;background:var(--border-strong)}
  .marker{z-index:1;width:11px;height:11px;margin-top:4px;border:2px solid var(--panel);border-radius:50%;background:var(--muted)}
  .layer-registration{background:#b26dff}.layer-ct{background:#ff73c6}.layer-dns{background:#40b8d0}.layer-tls{background:#8c9cff}.layer-web{background:#d59955}.layer-mail{background:#76a54b}
  .event-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:5px 10px}.event-head strong{overflow-wrap:anywhere;font-size:var(--text-xs)}.event-head span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .sequence p{margin:3px 0;color:var(--muted);font-size:var(--text-2xs)}.sequence small{display:block;color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}
  details{margin-top:8px}summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}ul{margin:7px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  @media(max-width:700px){header{align-items:stretch;flex-direction:column}header button{width:100%}.coverage{grid-template-columns:minmax(0,1fr)}.event-head{display:grid}}
</style>
