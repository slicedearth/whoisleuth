<script lang="ts">
  let {
    facts,
    diagnostics,
    hasAssessment,
  }: {
    facts: Array<{
      label: string;
      value: string;
      detail: string;
      provenance: {
        sources: readonly string[];
        observedAt: string;
        fieldFamilies: readonly string[];
        normalization: string;
        completeness: string;
        limitations: readonly string[];
        conflicts: readonly string[];
        decisionImpact: string;
      };
    }>;
    diagnostics: Array<{
      source: string;
      status: string;
      label: string;
      detail: string;
      endpoint: string;
      route: string;
      observedAt: string;
      conformance: readonly string[];
      limitations: readonly string[];
      attempts: readonly { endpoint: string; outcome: string; detail: string }[];
    }>;
    hasAssessment: boolean;
  } = $props();
</script>

<div class="summaries stat-grid" class:with-top={hasAssessment}>
  {#each facts as fact}
    <article>
      <small>{fact.label}</small>
      <strong>{fact.value}</strong>
      <p>{fact.detail}</p>
      <details class="fact-inspector">
        <summary>Inspect evidence</summary>
        <dl>
          <div><dt>Source</dt><dd>{fact.provenance.sources.join(', ')}</dd></div>
          <div><dt>Observed</dt><dd>{fact.provenance.observedAt}</dd></div>
          <div><dt>Coverage</dt><dd>{fact.provenance.completeness}</dd></div>
          <div><dt>Field families</dt><dd>{fact.provenance.fieldFamilies.join(', ')}</dd></div>
          <div><dt>Normalisation</dt><dd>{fact.provenance.normalization}</dd></div>
          <div><dt>Decision use</dt><dd>{fact.provenance.decisionImpact}</dd></div>
        </dl>
        {#if fact.provenance.conflicts.length}
          <section class="inspector-note conflict"><h5>Conflicting publications</h5><ul>{#each fact.provenance.conflicts as conflict}<li>{conflict}</li>{/each}</ul></section>
        {/if}
        {#if fact.provenance.limitations.length}
          <section class="inspector-note"><h5>Limitations</h5><ul>{#each fact.provenance.limitations as limitation}<li>{limitation}</li>{/each}</ul></section>
        {/if}
      </details>
    </article>
  {/each}
</div>

<div class="diagnostics stat-grid" role="group" aria-label="Source diagnostics">
  {#each diagnostics as diagnostic}
    <article>
      <small>{diagnostic.source}</small>
      <strong class:error-state={diagnostic.status === 'error'} class:limited-state={diagnostic.status === 'disabled'}>{diagnostic.label}</strong>
      <p>{diagnostic.detail}</p>
      <details class="source-inspector">
        <summary>Inspect source route</summary>
        <dl>
          <div><dt>Collection route</dt><dd>{diagnostic.route}</dd></div>
          <div><dt>Observed</dt><dd>{diagnostic.observedAt}</dd></div>
          {#if diagnostic.endpoint}<div><dt>Selected endpoint</dt><dd>{diagnostic.endpoint}</dd></div>{/if}
          {#if diagnostic.conformance.length}<div><dt>RDAP conformance</dt><dd>{diagnostic.conformance.join(', ')}</dd></div>{/if}
        </dl>
        {#if diagnostic.attempts.length}
          <ol class="attempts">
            {#each diagnostic.attempts as attempt}
              <li><strong>{attempt.outcome}</strong><span>{attempt.endpoint}</span><small>{attempt.detail}</small></li>
            {/each}
          </ol>
        {/if}
        {#if diagnostic.limitations.length}
          <section class="inspector-note"><h5>Limitations</h5><ul>{#each diagnostic.limitations as limitation}<li>{limitation}</li>{/each}</ul></section>
        {/if}
      </details>
    </article>
  {/each}
</div>

<style>
  .summaries.with-top,.diagnostics{margin-top:12px}
  .summaries article,.diagnostics article{min-width:0}
  .diagnostics strong{text-transform:capitalize;color:var(--accent)}
  .diagnostics .error-state{color:var(--danger)}
  .diagnostics .limited-state{color:var(--amber)}
  .fact-inspector,.source-inspector{margin-top:9px;border-top:1px solid var(--border)}
  .fact-inspector>summary,.source-inspector>summary{min-height:32px;padding:8px 0;box-sizing:border-box;color:var(--accent);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  .fact-inspector>summary:focus-visible,.source-inspector>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  dl{display:grid;gap:6px;margin:9px 0 0}
  dl div{min-width:0}
  dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  dd{margin:2px 0 0;color:var(--text);font-size:var(--text-2xs);line-height:1.5;overflow-wrap:anywhere}
  .inspector-note{margin-top:9px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .inspector-note.conflict{border-color:color-mix(in srgb,var(--danger) 42%,var(--border))}
  .inspector-note h5{margin:0;font:700 var(--text-2xs) var(--mono)}
  .inspector-note ul{margin:5px 0 0;padding-left:16px;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .attempts{display:grid;gap:6px;margin:9px 0 0;padding:0;list-style:none}
  .attempts li{min-width:0;padding:7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .attempts strong,.attempts span,.attempts small{display:block;overflow-wrap:anywhere}
  .attempts strong{color:var(--accent);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
  .attempts span{margin-top:3px;font-size:var(--text-2xs)}
  .attempts small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
</style>
