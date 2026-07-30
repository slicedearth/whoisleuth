<script lang="ts">
  import {
    buildDnsChangeRehearsal,
    type DnssecChange,
  } from '$lib/analysis/dns-change-rehearsal.ts';

  let {
    domain,
    currentNameservers,
    registryNameservers,
    evidenceComplete,
  }: {
    domain: string;
    currentNameservers: readonly string[];
    registryNameservers: readonly string[];
    evidenceComplete: boolean;
  } = $props();

  let proposedNameservers = $state('');
  let proposedGlue = $state('');
  let dnssecChange = $state<DnssecChange>('unchanged');
  let ttlLowered = $state(false);
  let zonePrepublished = $state(false);
  let evaluated = $state(false);
  const result = $derived(buildDnsChangeRehearsal({
    domain,
    currentNameservers,
    registryNameservers,
    proposedNameservers,
    proposedGlue,
    dnssecChange,
    ttlLowered,
    zonePrepublished,
    currentEvidenceComplete: evidenceComplete,
  }));
</script>

<details class="rehearsal">
  <summary>Plan a DNS change</summary>
  <div class="rehearsal-body">
    <p>Rehearse the order of a proposed delegation change using this retained evidence and your entered plan. Nothing is submitted or changed.</p>
    <div class="form-grid">
      <label class="field">
        Intended nameservers
        <textarea bind:value={proposedNameservers} rows="3" placeholder="ns1.example.net&#10;ns2.example.net"></textarea>
        <small>Enter the complete intended set, one per line or separated by spaces.</small>
      </label>
      <label class="field">
        Proposed in-bailiwick glue
        <textarea bind:value={proposedGlue} rows="3" placeholder="ns1.example.test 192.0.2.53"></textarea>
        <small>Optional. Enter one nameserver followed by up to two public addresses per line.</small>
      </label>
      <label class="field">
        DNSSEC change
        <select bind:value={dnssecChange}>
          <option value="unchanged">No change</option>
          <option value="enable">Enable</option>
          <option value="rotate">Rotate keys or DS</option>
          <option value="disable">Disable</option>
        </select>
      </label>
      <fieldset>
        <legend>Readiness confirmations</legend>
        <label><input type="checkbox" bind:checked={ttlLowered}> Relevant TTL preparation is complete</label>
        <label><input type="checkbox" bind:checked={zonePrepublished}> Proposed authorities already serve the intended zone</label>
      </fieldset>
    </div>
    <button class="btn" type="button" onclick={() => evaluated = true}>Evaluate rehearsal</button>
    {#if evaluated}
      <section class="result" aria-live="polite">
        <div class="result-head">
          <strong>{result.ready ? 'Plan is ready for procedural review' : 'Plan has unresolved gates'}</strong>
          <span class:ready={result.ready}>{result.ready ? 'ready' : 'review'}</span>
        </div>
        <div class="findings">
          {#each result.findings as finding}
            <article class={`state-${finding.state}`}>
              <strong>{finding.label}</strong>
              <p>{finding.detail}</p>
            </article>
          {/each}
        </div>
        <details><summary>Proposed sequence</summary><ol>{#each result.sequence as step}<li>{step}</li>{/each}</ol></details>
        <details><summary>Rollback preparation</summary><ol>{#each result.rollback as step}<li>{step}</li>{/each}</ol></details>
        {#each result.limitations as limitation}<p class="limitation">{limitation}</p>{/each}
      </section>
    {/if}
  </div>
</details>

<style>
  .rehearsal{margin-top:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .rehearsal>summary{padding:9px 11px;cursor:pointer;font:600 var(--text-xs) var(--mono)}
  .rehearsal-body{padding:0 11px 11px}
  .rehearsal-body>p,.limitation{color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
  .form-grid fieldset{display:grid;align-content:start;gap:7px;min-width:0;margin:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .form-grid fieldset label{display:flex;align-items:flex-start;gap:7px;font-size:var(--text-xs);line-height:1.45}
  .field small{display:block;margin-top:4px;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  textarea{resize:vertical}
  .result{margin-top:12px}
  .result-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .result-head span{color:var(--amber);font:700 var(--text-2xs) var(--mono);letter-spacing:.04em;text-transform:uppercase}
  .result-head span.ready{color:var(--success)}
  .findings{display:grid;gap:7px;margin-top:9px}
  .findings article{padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .findings article.state-blocked{border-color:color-mix(in srgb,var(--danger) 55%,var(--border))}
  .findings article.state-review,.findings article.state-unknown{border-color:color-mix(in srgb,var(--amber) 55%,var(--border))}
  .findings article.state-ready{border-color:color-mix(in srgb,var(--success) 42%,var(--border))}
  .findings p{margin:4px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .result details{margin-top:8px}
  .result details summary{font:600 var(--text-xs) var(--mono)}
  .result ol{margin:8px 0 0;padding-left:21px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  @media(max-width:680px){.form-grid{grid-template-columns:1fr}}
</style>
