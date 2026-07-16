<script lang="ts">
  let {
    facts,
    diagnostics,
    hasAssessment,
  }: {
    facts: Array<{ label: string; value: string; detail: string }>;
    diagnostics: Array<{ source: string; status: string; label: string; detail: string }>;
    hasAssessment: boolean;
  } = $props();
</script>

<div class="summaries stat-grid" class:with-top={hasAssessment}>
  {#each facts as fact}
    <article><small>{fact.label}</small><strong>{fact.value}</strong><p>{fact.detail}</p></article>
  {/each}
</div>

<div class="diagnostics stat-grid" aria-label="Source diagnostics">
  {#each diagnostics as diagnostic}
    <article>
      <small>{diagnostic.source}</small>
      <strong class:error-state={diagnostic.status === 'error'} class:limited-state={diagnostic.status === 'disabled'}>{diagnostic.label}</strong>
      <p>{diagnostic.detail}</p>
    </article>
  {/each}
</div>

<style>
  .summaries.with-top,.diagnostics{margin-top:12px}
  .diagnostics strong{text-transform:capitalize;color:var(--accent)}
  .diagnostics .error-state{color:var(--danger)}
  .diagnostics .limited-state{color:var(--amber)}
</style>
