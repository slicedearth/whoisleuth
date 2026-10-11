<script lang="ts">
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import type { buildLookupEvidenceScope } from '#lib/analysis/lookup-evidence-scope.ts';

  let { scope }: { scope: ReturnType<typeof buildLookupEvidenceScope> } = $props();
</script>

{#if scope.sources.length}
  <details class="scope-disclosure">
    <summary>What each source describes</summary>
    <p>Identities and times from this completed result. Changing the query field does not change this evidence.</p>
    <div class="scope-context">
      <h5>Request context</h5>
      <dl>{#each scope.context as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}</dl>
    </div>
    <div class="scope-sources">
      {#each scope.sources as source (source.id)}
        <section aria-label={`${source.label} scope`}>
          <h5>{source.label}</h5>
          <p class="source-clock">{source.state} · {formatEvidenceDate(source.observedAt, 'Observation time unavailable')}</p>
          <dl>{#each source.rows as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}</dl>
          <p class="note">{source.note}</p>
        </section>
      {/each}
    </div>
  </details>
{/if}

<style>
  details{margin-top:12px;border-top:1px solid var(--border)}
  summary{padding:12px 0;color:var(--text);font:680 var(--text-xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .scope-sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px;align-items:start;margin:16px 0}
  .scope-sources section,.scope-context{min-width:0;overflow-wrap:anywhere}
  .scope-sources section{border-top:1px solid var(--border);padding-top:12px}
  h5{margin:0 0 6px;font-size:var(--text-sm)}
  p{font-size:var(--text-xs);line-height:1.5}
  .source-clock{color:var(--muted);margin:0 0 10px}
  dl{display:grid;gap:8px;margin:0}
  dt{color:var(--muted);font-size:var(--text-2xs)}
  dd{margin:2px 0 0;font:var(--text-xs)/1.5 var(--mono);overflow-wrap:anywhere}
  .note{margin:9px 0 0;color:var(--muted);line-height:1.5}
</style>
