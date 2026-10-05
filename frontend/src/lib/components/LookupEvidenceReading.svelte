<script lang="ts">
  import type { LookupEvidenceReplay } from '#lib/analysis/lookup-evidence-replay.ts';
  import { evidenceStatusChipClass } from '#lib/analysis/evidence-status-tone.ts';
  import { availabilityStatusDisplay } from '#lib/analysis/availability-status-display.ts';
  import LookupAssetGraph from './LookupAssetGraph.svelte';
  import LookupMetadataDisclosure from './LookupMetadataDisclosure.svelte';
  let { replay, headingId = 'replay-title', digestDescription = 'verified against supplied checksum' }: {
    replay: LookupEvidenceReplay; headingId?: string; digestDescription?: string;
  } = $props();
  const id = $derived(headingId.replace(/-title$/u, ''));
  const replayAvailability = $derived(availabilityStatusDisplay(replay.availability));
</script>

<div class="lookup-evidence-reading">
        <header>
          <div>
            <p class="eyebrow">Offline evidence</p>
            <h2 id={headingId}>{replay.target}</h2>
            <p>Exported {replay.exportedAt} · {replay.targetType} · schema {replay.schemaVersion}{replay.generatorVersion ? ` · WHOISleuth ${replay.generatorVersion}` : ''}</p>
          </div>
          <span class="chip {replayAvailability.className}">{replayAvailability.label}</span>
        </header>

        <div class="digest">
          <small>File SHA-256 · {replay.digestVerified ? digestDescription : 'calculated locally; no expected checksum supplied'}</small>
          <code>{replay.digestSha256}</code>
        </div>

        <div class="source-grid" role="group" aria-label="Replayed source health">
          {#each replay.sources as source (source.id)}
            <article>
              <strong>{source.label}</strong>
              <span class="chip {evidenceStatusChipClass(source.state, source.complete === null ? {} : { complete: source.complete })}">{source.state}</span>
              <small>{source.observedAt ? `Observed ${source.observedAt}` : 'Observation time not reported'}</small>
            </article>
          {/each}
        </div>

        {#if replay.facts.length}
          <h3>Normalised facts</h3>
          <dl>
            {#each replay.facts as fact}
              <div><dt>{fact.label}</dt><dd>{fact.value}<small>{fact.source} · {fact.sourceState}{fact.sourceComplete === false ? ' · incomplete' : ''}</small></dd></div>
            {/each}
          </dl>
        {/if}

        {#if replay.pagePublicationMetadata || replay.httpDeliveryMetadata}
          <section class="retained-homepage-metadata" aria-labelledby={`${id}-homepage-metadata-title`}>
            <h3 id={`${id}-homepage-metadata-title`}>Retained homepage metadata</h3>
            <p class="note">These bounded values came from the exported observation. No source was contacted during replay.</p>
            {#if replay.pagePublicationMetadata}<LookupMetadataDisclosure label="Publication metadata" metadata={replay.pagePublicationMetadata} />{/if}
            {#if replay.httpDeliveryMetadata}<LookupMetadataDisclosure label="Delivery and cache metadata" metadata={replay.httpDeliveryMetadata} />{/if}
          </section>
        {/if}

        {#if replay.contradictions.length}
          <aside class="contradictions" data-tone="danger">
            <strong>Contradictory registration evidence</strong>
            <ul>{#each replay.contradictions as contradiction}<li>{contradiction}</li>{/each}</ul>
          </aside>
        {/if}

        <section class="brief" aria-labelledby={`${id}-brief-title`}>
          <h3 id={`${id}-brief-title`}>Historical review brief</h3>
          <div>
            <article>
              <strong>Retained normalised facts</strong>
              <p>{replay.facts.length} normalised fact{replay.facts.length === 1 ? '' : 's'} retained with source labels.</p>
            </article>
            <article>
              <strong>Unknown or incomplete</strong>
              {#if replay.unknowns.length}<ul>{#each replay.unknowns as unknown}<li>{unknown}</li>{/each}</ul>{:else}<p>No incomplete replay source was identified.</p>{/if}
            </article>
            <article>
              <strong>Next manual steps</strong>
              <ol>{#each replay.recommendedSteps as step}<li>{step}</li>{/each}</ol>
            </article>
          </div>
        </section>

        <LookupAssetGraph graph={replay.graph} headingId={`${id}-asset-graph-title`} evidenceLinks={false} />

        <details class="limits">
          <summary>Replay limitations</summary>
          <ul>{#each replay.limitations as limitation}<li>{limitation}</li>{/each}</ul>
        </details>
</div>

<style>
  header>.chip{justify-self:start}
  .lookup-evidence-reading{display:grid;gap:12px;min-width:0;overflow-wrap:anywhere}header{display:flex;align-items:start;justify-content:space-between;gap:12px}h2{margin:2px 0 0;font-size:var(--text-lg)}header p:not(.eyebrow){margin:5px 0 0;color:var(--muted);font-size:var(--text-xs)}h3{margin:2px 0;font-size:var(--text-sm)}
  .digest{display:grid;gap:4px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.digest small{color:var(--muted)}.digest code{font-size:var(--text-2xs);overflow-wrap:anywhere}
  .source-grid,.brief>div{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:start;gap:7px}.source-grid article,.brief article{display:grid;gap:3px;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.source-grid strong,.brief strong{font-size:var(--text-xs)}.source-grid span{width:max-content;max-width:100%;font-size:var(--text-2xs);text-transform:capitalize}.source-grid small{color:var(--muted);font-size:var(--text-2xs)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:7px;margin:0}dl div{display:grid;gap:3px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}dt{color:var(--muted);font-size:var(--text-2xs)}dd{margin:0;font-size:var(--text-xs)}dd small{display:block;margin-top:3px;color:var(--muted)}
  aside{padding:10px;border:1px solid color-mix(in srgb,var(--danger) 52%,var(--border));border-radius:var(--radius-sm);background:rgb(var(--danger-rgb)/.08)}aside ul,.limits ul{margin:7px 0 0;padding-left:18px;font-size:var(--text-xs);line-height:1.5}.brief{display:grid;gap:8px}.brief p,.brief ul,.brief ol{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}.brief ul,.brief ol{padding-left:17px}
  .retained-homepage-metadata{display:grid;gap:8px;min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.note{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.limits{border-top:1px solid var(--border)}.limits>summary{padding:10px 0;min-height:44px;font:680 var(--text-xs) var(--mono)}
  @media(max-width:760px){.source-grid,dl,.brief>div{grid-template-columns:minmax(0,1fr)}header{display:grid}}
</style>
